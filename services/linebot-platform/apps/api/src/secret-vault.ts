import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Persistence } from "./db.js";

interface StoredSecret {
	adapter: "official" | "linejs";
	ciphertext: string;
	updatedAt: string;
}

export interface BotCredentials {
	channelAccessToken?: string;
	channelSecret?: string;
	authToken?: string;
	/**
	 * LINE device slot the auth token was issued for. A token is only valid for
	 * the slot it was minted in, so a change of slot has to invalidate it.
	 */
	device?: string;
}

function resolveKey(input: string): Buffer {
	try {
		const decoded = Buffer.from(input, "base64");
		if (decoded.length === 32) return decoded;
	} catch {
		// Fall through to a deterministic development key.
	}
	return createHash("sha256").update(input).digest();
}

/**
 * Envelope encryption for bot credentials. Only AES-256-GCM ciphertext ever
 * touches disk — `dbPath` defaults to `:memory:` for tests/short-lived
 * instances; the server entrypoint points it at the same SQLite file as
 * MemoryStore so a restart doesn't force re-entering every channel token.
 */
export class SecretVault {
	readonly #key: Buffer;
	readonly #values = new Map<string, StoredSecret>();
	readonly #db: Persistence;

	constructor(masterKey = process.env.ENCRYPTION_KEY ?? "local-development-encryption-key", dbPath = ":memory:") {
		this.#key = resolveKey(masterKey);
		this.#db = new Persistence(dbPath);
		for (const [botId, secret] of this.#db.loadAll<StoredSecret>("secrets")) this.#values.set(botId, secret);
	}

	set(botId: string, adapter: StoredSecret["adapter"], credentials: BotCredentials): void {
		const iv = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
		cipher.setAAD(Buffer.from(`${botId}:${adapter}`));
		const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
		const tag = cipher.getAuthTag();
		const record: StoredSecret = {
			adapter,
			ciphertext: [iv, tag, encrypted].map((value) => value.toString("base64url")).join("."),
			updatedAt: new Date().toISOString(),
		};
		this.#values.set(botId, record);
		this.#db.upsert("secrets", botId, record);
	}

	get(botId: string): BotCredentials | undefined {
		const stored = this.#values.get(botId);
		if (!stored) return undefined;
		const [ivText, tagText, encryptedText] = stored.ciphertext.split(".");
		if (!ivText || !tagText || !encryptedText) throw new Error("Encrypted credential payload is malformed");
		const decipher = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(ivText, "base64url"));
		decipher.setAAD(Buffer.from(`${botId}:${stored.adapter}`));
		decipher.setAuthTag(Buffer.from(tagText, "base64url"));
		const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]);
		return JSON.parse(decrypted.toString("utf8")) as BotCredentials;
	}

	status(botId: string): { configured: boolean; adapter?: StoredSecret["adapter"]; updatedAt?: string } {
		const stored = this.#values.get(botId);
		return stored ? { configured: true, adapter: stored.adapter, updatedAt: stored.updatedAt } : { configured: false };
	}

	delete(botId: string): boolean {
		this.#db.remove("secrets", botId);
		return this.#values.delete(botId);
	}

	close(): void {
		this.#db.close();
	}
}
