import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Generic key-value durability layer over SQLite. Every MemoryStore
 * collection is stored as JSON blobs under its own namespace so the
 * existing in-memory Map-based query logic never has to change — this is
 * a write-through persistence layer, not a query engine. Local single-admin
 * control plane; no concurrent-writer contention to design around.
 */
export class Persistence {
	readonly #db: DatabaseSync;

	constructor(path: string) {
		if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
		this.#db = new DatabaseSync(path);
		// WAL mode lets MemoryStore and SecretVault hold independent connections
		// to the same file without lock contention on concurrent writes.
		if (path !== ":memory:") {
			this.#db.exec("PRAGMA journal_mode = WAL;");
			// NORMAL is the standard safe pairing with WAL (SQLite docs): skips the
			// fsync-per-commit that FULL (the default) does on every single write,
			// while still guaranteeing no corruption -- worst case on a power loss
			// is losing the most recent commit, which the deferred-write batching
			// already treats as an acceptable window.
			this.#db.exec("PRAGMA synchronous = NORMAL;");
		}
		this.#db.exec(`
			CREATE TABLE IF NOT EXISTS records (
				collection TEXT NOT NULL,
				key TEXT NOT NULL,
				value TEXT NOT NULL,
				PRIMARY KEY (collection, key)
			)
		`);
	}

	loadAll<T>(collection: string): Array<[string, T]> {
		const rows = this.#db.prepare("SELECT key, value FROM records WHERE collection = ?").all(collection) as Array<{ key: string; value: string }>;
		return rows.map((row) => [row.key, JSON.parse(row.value) as T]);
	}

	upsert(collection: string, key: string, value: unknown): void {
		this.#db.prepare(
			"INSERT INTO records (collection, key, value) VALUES (?, ?, ?) ON CONFLICT(collection, key) DO UPDATE SET value = excluded.value",
		).run(collection, key, JSON.stringify(value));
	}

	applyBatch(
		upserts: ReadonlyArray<readonly [collection: string, key: string, value: unknown]>,
		deletes: ReadonlyArray<readonly [collection: string, key: string]> = [],
	): void {
		if (!upserts.length && !deletes.length) return;
		const upsert = this.#db.prepare(
			"INSERT INTO records (collection, key, value) VALUES (?, ?, ?) ON CONFLICT(collection, key) DO UPDATE SET value = excluded.value",
		);
		const remove = this.#db.prepare("DELETE FROM records WHERE collection = ? AND key = ?");
		this.#db.exec("BEGIN IMMEDIATE");
		try {
			for (const [collection, key, value] of upserts) upsert.run(collection, key, JSON.stringify(value));
			for (const [collection, key] of deletes) remove.run(collection, key);
			this.#db.exec("COMMIT");
		} catch (error) {
			this.#db.exec("ROLLBACK");
			throw error;
		}
	}

	remove(collection: string, key: string): void {
		this.#db.prepare("DELETE FROM records WHERE collection = ? AND key = ?").run(collection, key);
	}

	close(): void {
		this.#db.close();
	}
}
