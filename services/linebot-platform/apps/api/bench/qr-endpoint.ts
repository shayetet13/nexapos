/**
 * Measures the real "click → QR on screen" latency: an HTTP POST to
 * /v1/bots/:botId/auth/qr, served by the actual supervisor, which forks a bot
 * worker and drives a genuine LINE QR login.
 *
 * Requires network access to LINE. Nothing is scanned, so no session is
 * created on the account -- the QR simply expires.
 *
 * Usage: pnpm --filter @linebot/api exec tsx bench/qr-endpoint.ts
 */
import { rmSync } from "node:fs";
import { createApp } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import { SecretVault } from "../src/secret-vault.js";

const DB_PATH = "./data/bench-qr.sqlite3";
const RUNS = Number(process.env.BENCH_RUNS ?? 2);

for (const suffix of ["", "-wal", "-shm"]) {
	try {
		rmSync(`${DB_PATH}${suffix}`);
	} catch {
		// First run: nothing to clean up.
	}
}

const store = new MemoryStore(DB_PATH);
const vault = new SecretVault("bench-key", DB_PATH);
const { app, shutdown } = createApp({ store, vault });

function createBot(name: string) {
	return store.createBot({
		name,
		adapter: "linejs",
		accent: "blue",
		timezone: "Asia/Bangkok",
		speedProfile: "custom",
		maxMessagesPerSecond: 3,
		burst: 5,
	});
}

async function requestQr(botId: string): Promise<{ elapsed: number; outcome: string }> {
	const startedAt = performance.now();
	const response = await app.request(`/v1/bots/${botId}/auth/qr`, { method: "POST" });
	const elapsed = performance.now() - startedAt;
	const body = await response.json() as { data?: { qrUrl?: string }; error?: { message?: string } };
	return {
		elapsed,
		outcome: body.data?.qrUrl ? "qrUrl returned" : `no QR (${body.error?.message ?? "unknown"})`,
	};
}

console.log(`\n=== POST /v1/bots/:botId/auth/qr (${RUNS} runs per scenario) ===`);

for (let run = 1; run <= RUNS; run++) {
	const bot = createBot(`cold-${run}`);
	const { elapsed, outcome } = await requestQr(bot.id);
	console.log(`cold      run ${run}: ${Math.round(elapsed)}ms  ${outcome}`);
}

for (let run = 1; run <= RUNS; run++) {
	const bot = createBot(`warm-${run}`);
	await app.request(`/v1/bots/${bot.id}/auth/qr/prewarm`, { method: "POST" });
	// The dashboard warms the worker when the bot panel opens, seconds before
	// the operator's eyes reach the QR area.
	await new Promise((resolve) => setTimeout(resolve, 1_500));
	const { elapsed, outcome } = await requestQr(bot.id);
	console.log(`prewarmed run ${run}: ${Math.round(elapsed)}ms  ${outcome}`);
}

const cachedBot = createBot("cached");
await requestQr(cachedBot.id);
const cached = await requestQr(cachedBot.id);
console.log(`cached      : ${Math.round(cached.elapsed)}ms  ${cached.outcome}  (dashboard refresh of a live QR)`);

await shutdown();
process.exit(0);
