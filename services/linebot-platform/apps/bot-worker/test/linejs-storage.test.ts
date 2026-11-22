import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EncryptedFileStorage } from "../src/adapters/linejs-storage.ts";

function tempPath(): string {
	return join(mkdtempSync(join(tmpdir(), "linejs-store-")), "store.enc");
}

test("encrypted storage persists values across a simulated restart", async () => {
	const path = tempPath();
	try {
		const first = new EncryptedFileStorage(path, "secret");
		await first.set("e2eeKeys:u1", { keyId: 7, privKey: "priv", pubKey: "pub" });
		await first.set("refreshToken", "rt_value");

		// A fresh instance models the worker restarting: the E2EE key must
		// still be readable so token reconnects can send into sealed groups.
		const reopened = new EncryptedFileStorage(path, "secret");
		const key = await reopened.get("e2eeKeys:u1") as { keyId: number; privKey: string };
		assert.equal(key.keyId, 7);
		assert.equal(key.privKey, "priv");
		assert.equal(await reopened.get("refreshToken"), "rt_value");
	} finally {
		rmSync(path, { force: true });
	}
});

test("encrypted storage never writes secrets as plaintext", async () => {
	const path = tempPath();
	try {
		const storage = new EncryptedFileStorage(path, "secret");
		await storage.set("refreshToken", "super-secret-token");
		const raw = readFileSync(path, "utf-8");
		assert.doesNotMatch(raw, /super-secret-token/);
		assert.ok(existsSync(path));
	} finally {
		rmSync(path, { force: true });
	}
});

test("a wrong key yields an empty store instead of throwing", async () => {
	const path = tempPath();
	try {
		const original = new EncryptedFileStorage(path, "right-key");
		await original.set("refreshToken", "value");

		const wrong = new EncryptedFileStorage(path, "wrong-key");
		assert.equal(await wrong.get("refreshToken"), undefined);
	} finally {
		rmSync(path, { force: true });
	}
});

test("auth material is written through immediately, hot-path keys are deferred", async () => {
	const path = tempPath();
	try {
		const storage = new EncryptedFileStorage(path, "secret");
		// `reqseq` is bumped on every outgoing message, so it must not force a
		// synchronous re-encrypt-and-write in front of each send.
		await storage.set("reqseq", JSON.stringify({ talk: 1 }));
		assert.equal(existsSync(path), false, "hot-path write should not hit disk yet");

		// Losing an E2EE key costs a re-login, so that one is never deferred.
		await storage.set("e2eeKeys:u1", { keyId: 7 });
		const persisted = new EncryptedFileStorage(path, "secret");
		assert.deepEqual(await persisted.get("e2eeKeys:u1"), { keyId: 7 });
		// The flush carries the deferred value along with it.
		assert.equal(await persisted.get("reqseq"), JSON.stringify({ talk: 1 }));
	} finally {
		rmSync(path, { force: true });
	}
});

test("flush persists a deferred write on demand", async () => {
	const path = tempPath();
	try {
		const storage = new EncryptedFileStorage(path, "secret");
		await storage.set("reqseq", "{}");
		storage.flush();
		assert.equal(await new EncryptedFileStorage(path, "secret").get("reqseq"), "{}");
	} finally {
		rmSync(path, { force: true });
	}
});

test("delete and clear remove persisted values", async () => {
	const path = tempPath();
	try {
		const storage = new EncryptedFileStorage(path, "secret");
		await storage.set("a", "1");
		await storage.set("b", "2");
		await storage.delete("a");
		assert.equal(await storage.get("a"), undefined);
		assert.equal(await storage.get("b"), "2");
		await storage.clear();
		assert.equal(await storage.get("b"), undefined);
	} finally {
		rmSync(path, { force: true });
	}
});
