import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type StorageValue = string | number | boolean | null | Record<string | number, unknown>;

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
 * Keys whose loss would break authentication (E2EE private keys, login
 * certificates, refresh token). These are written through synchronously; every
 * other key is written behind a short coalescing window.
 */
const DURABLE_KEY_PATTERN = /^(e2ee|cert:|qrCert|refreshToken|expire)/;

/** How long non-critical writes are coalesced before hitting the disk. */
const WRITE_BEHIND_MS = 40;

/**
 * Every live store, so a clean shutdown can flush coalesced writes. One shared
 * process hook rather than one per instance, which would trip Node's listener
 * cap in any process that opens several stores.
 */
const openStores = new Set<EncryptedFileStorage>();
process.once("beforeExit", () => {
	for (const store of openStores) {
		try {
			store.flush();
		} catch (error) {
			// Report it, but never turn a last-gasp write into a crash on the
			// way out -- the process is already leaving.
			console.error(`[linejs-storage] final flush failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
});

/**
 * Persistent, encrypted key/value store for the LINEJS client.
 *
 * LINE registers an E2EE self-key the first time an account logs in and then
 * expects that same private key to still be present on every later reconnect --
 * including token-based reconnects, which never re-run key registration. With
 * the client's default in-memory storage the key is lost the moment the worker
 * process restarts, so the next send to an E2EE-sealed group fails with
 * "E2EE Key has not been saved". Persisting the client storage fixes that.
 *
 * The stored values include E2EE private keys and the refresh token, so the
 * file is encrypted at rest with AES-256-GCM (never plaintext), matching the
 * SecretVault's posture. The whole map is re-encrypted on every mutation --
 * a full rewrite is simpler than per-key envelopes and safe at this size.
 *
 * Writes are split by durability need. Auth material ({@link DURABLE_KEY_PATTERN})
 * is flushed synchronously, because losing it costs a re-login. Everything else
 * -- in practice the `reqseq` counter, which LINEJS bumps on *every outgoing
 * message* -- is coalesced into a single background write, so a send no longer
 * blocks the event loop on an AES re-encrypt plus a synchronous fsync of the
 * whole file. Readers always see the in-memory cache, which is authoritative.
 *
 * The shape intentionally matches the LINEJS `BaseStorage` contract
 * (get/set/delete/clear/migrate, plus getAll) by duck typing, so it can be
 * passed as the client's `storage` without statically importing the library.
 */
export class EncryptedFileStorage {
	readonly #path: string;
	readonly #key: Buffer;
	#cache: Record<string, StorageValue>;
	#pendingWrite?: NodeJS.Timeout;
	#dirty = false;

	constructor(path: string, secret: string) {
		this.#path = path;
		this.#key = resolveKey(secret);
		mkdirSync(dirname(path), { recursive: true });
		this.#cache = this.#load();
		openStores.add(this);
	}

	#load(): Record<string, StorageValue> {
		if (!existsSync(this.#path)) return {};
		try {
			const raw = readFileSync(this.#path, "utf-8");
			if (!raw.trim()) return {};
			const { iv, tag, data } = JSON.parse(raw) as { iv: string; tag: string; data: string };
			const decipher = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(iv, "base64"));
			decipher.setAuthTag(Buffer.from(tag, "base64"));
			const decrypted = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]);
			return JSON.parse(decrypted.toString("utf-8")) as Record<string, StorageValue>;
		} catch {
			// Corrupt file or key mismatch: start clean rather than crash the
			// worker. A fresh login will repopulate what LINE needs.
			return {};
		}
	}

	/** Flushes and stops tracking this store for the process-exit flush. */
	close(): void {
		this.flush();
		openStores.delete(this);
	}

	/** Writes any outstanding mutation to disk immediately. */
	flush(): void {
		if (this.#pendingWrite) {
			clearTimeout(this.#pendingWrite);
			this.#pendingWrite = undefined;
		}
		if (!this.#dirty) return;
		this.#persist();
	}

	#schedulePersist(): void {
		this.#dirty = true;
		if (this.#pendingWrite) return;
		this.#pendingWrite = setTimeout(() => {
			this.#pendingWrite = undefined;
			if (this.#dirty) this.#persist();
		}, WRITE_BEHIND_MS);
		this.#pendingWrite.unref();
	}

	#persist(): void {
		this.#dirty = false;
		const iv = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
		const encrypted = Buffer.concat([cipher.update(JSON.stringify(this.#cache), "utf-8"), cipher.final()]);
		const tag = cipher.getAuthTag();
		writeFileSync(this.#path, JSON.stringify({
			iv: iv.toString("base64"),
			tag: tag.toString("base64"),
			data: encrypted.toString("base64"),
		}), "utf-8");
	}

	// deno-lint-ignore require-await
	async get(key: string): Promise<StorageValue | undefined> {
		return this.#cache[key];
	}

	// deno-lint-ignore require-await
	async set(key: string, value: StorageValue): Promise<void> {
		this.#cache[key] = value;
		this.#dirty = true;
		if (DURABLE_KEY_PATTERN.test(key)) this.flush();
		else this.#schedulePersist();
	}

	// deno-lint-ignore require-await
	async delete(key: string): Promise<void> {
		delete this.#cache[key];
		this.#dirty = true;
		this.flush();
	}

	// deno-lint-ignore require-await
	async clear(): Promise<void> {
		this.#cache = {};
		this.#dirty = true;
		this.flush();
	}

	// deno-lint-ignore require-await
	async getAll(): Promise<Record<string, StorageValue>> {
		return { ...this.#cache };
	}

	async migrate(storage: { set(key: string, value: StorageValue): Promise<void> }): Promise<void> {
		for (const [key, value] of Object.entries(this.#cache)) await storage.set(key, value);
	}
}
