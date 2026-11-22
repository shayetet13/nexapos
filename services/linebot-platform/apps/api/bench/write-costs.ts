/**
 * Measures the synchronous disk writes that used to sit in front of every
 * reply, so the saving from deferring them is a number rather than a claim.
 *
 * Per inbound message the old path performed: one sender upsert, and one audit
 * insert per matched rule action (plus one per diagnostic). Per outgoing
 * message the worker additionally re-encrypted and rewrote its whole LINEJS
 * storage file, because the client bumps a `reqseq` counter on every send.
 *
 * Usage: pnpm --filter @linebot/api exec tsx bench/write-costs.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedFileStorage } from "../../bot-worker/src/adapters/linejs-storage.ts";
import { Persistence } from "../src/db.js";

const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 300);
const dir = mkdtempSync(join(tmpdir(), "linebot-writecost-"));

function measure(label: string, run: (index: number) => void): void {
	for (let index = 0; index < 20; index++) run(index); // warm up
	const samples: number[] = [];
	for (let index = 0; index < ITERATIONS; index++) {
		const startedAt = performance.now();
		run(index);
		samples.push(performance.now() - startedAt);
	}
	samples.sort((a, b) => a - b);
	const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
	const p95 = samples[Math.floor(samples.length * 0.95)]!;
	console.log(`${label.padEnd(38)} mean ${mean.toFixed(3)} ms   p95 ${p95.toFixed(3)} ms`);
}

try {
	const db = new Persistence(join(dir, "bench.sqlite3"));
	const auditRow = {
		id: "audit_x",
		action: "rule.action_completed",
		botId: "bot_1",
		actor: "local-admin",
		details: { ruleId: "rule_1", action: "reply_text" },
		createdAt: new Date().toISOString(),
	};

	console.log(`\n=== Synchronous write costs (n=${ITERATIONS}) ===`);
	measure("SQLite upsert (audit or sender row)", (index) => {
		db.upsert("auditLog", `audit_${index}`, auditRow);
	});

	const storage = new EncryptedFileStorage(join(dir, "storage.enc"), "bench-key");
	// Seed it to a realistic size: E2EE self key, group keys, cert, token.
	for (let index = 0; index < 30; index++) {
		void storage.set(`e2eeGroupKeys:c${index}`, JSON.stringify({ privKey: "x".repeat(44), keyId: index }));
	}
	storage.flush();

	measure("LINEJS storage write-through (old)", (index) => {
		void storage.set("e2eeKeys:forced-sync", JSON.stringify({ seq: index }));
	});
	measure("LINEJS storage write-behind (new)", (index) => {
		void storage.set("reqseq", JSON.stringify({ talk: index }));
	});

	db.close();
	storage.close();
	console.log(
		"\nPer reply the old path paid ~2 SQLite writes (sender + action audit);" +
		"\nper outgoing message the worker paid one storage write-through.",
	);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
