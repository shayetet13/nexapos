/**
 * Measures the control-plane share of reply latency: the time between an
 * inbound LINE message reaching the API and the outgoing reply being handed to
 * the bot worker. Everything after that point is network time to LINE.
 *
 * The bot worker is stubbed so the number isolates our own work — target
 * lookup, rule evaluation, template rendering, delivery bookkeeping — with no
 * network in the measurement.
 *
 * Usage: pnpm --filter @linebot/api exec tsx bench/reply-path.ts
 */
import { EventEmitter } from "node:events";
import { rmSync } from "node:fs";
import type { BotInboundEvent, SendTextRequest } from "@linebot/bot-worker";
import { createApp } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import { SecretVault } from "../src/secret-vault.js";
import type { BotControl } from "../src/bot-control.js";

const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 500);
const WARMUP = 50;
const DB_PATH = "./data/bench-reply-path.sqlite3";

for (const suffix of ["", "-wal", "-shm"]) {
	try {
		rmSync(`${DB_PATH}${suffix}`);
	} catch {
		// First run: nothing to clean up.
	}
}

/** Stands in for the supervisor: records when the reply was handed off. */
class StubControl extends EventEmitter {
	handoffAt = 0;
	// deno-lint-ignore require-await
	async enqueueText(_botId: string, request: SendTextRequest): Promise<{ deliveryId: string }> {
		this.handoffAt = performance.now();
		return { deliveryId: request.deliveryId ?? "bench" };
	}
	async shutdown(): Promise<void> {}
}

const control = new StubControl();
const store = new MemoryStore(DB_PATH);
const vault = new SecretVault("bench-key", DB_PATH);
const { automation, shutdown } = createApp({
	store,
	vault,
	control: control as unknown as BotControl,
});

const bot = store.createBot({
	name: "bench",
	adapter: "linejs",
	accent: "blue",
	timezone: "Asia/Bangkok",
	speedProfile: "custom",
	maxMessagesPerSecond: 3,
	burst: 5,
});

// A realistic allowlist: one enabled group among many discovered ones, which is
// what the target lookup has to sift through on every message.
for (let index = 0; index < 75; index++) {
	store.upsertTarget({
		botId: bot.id,
		externalId: `c${index.toString().padStart(32, "0")}`,
		type: "group",
		name: `group-${index}`,
		enabled: index === 0,
		consentConfirmedAt: index === 0 ? new Date().toISOString() : null,
	});
}
const target = store.listTargets(bot.id)[0]!;

store.upsertRule({
	botId: bot.id,
	name: "auto reply",
	enabled: true,
	priority: 10,
	trigger: { type: "message_received", config: { mode: "exact", match: "มาแว้ว" } },
	conditions: [],
	actions: [{ id: "a1", type: "reply_text", config: { text: "รับทราบ" } }],
	stopProcessing: false,
});

function inbound(index: number): BotInboundEvent {
	return {
		botId: bot.id,
		eventId: `evt-${index}`,
		targetId: target.externalId,
		targetKind: "group",
		senderId: `u${index % 20}`.padEnd(33, "0"),
		text: "มาแว้ว",
		timestamp: Date.now(),
		source: "linejs",
		isBot: false,
		rawType: "talk-message",
	};
}

/**
 * Reproduces what the old path charged the reply for: the target was found by
 * scanning the bot's whole allowlist, and the sender row plus the action audit
 * were written to SQLite synchronously before the reply was handed over.
 */
function legacyOverhead(index: number): void {
	store.listTargets(bot.id).find((candidate) =>
		candidate.externalId === target.externalId || candidate.id === target.externalId
	);
	store.observeSender(bot.id, `u${index % 20}`.padEnd(33, "0"));
	// Flushing here writes the sender row and the action audit that the rule
	// engine already produced -- exactly the two rows the old path wrote
	// synchronously, with no extra row invented for the benchmark.
	store.flushDeferredWrites();
}

async function run(label: string, legacy: boolean): Promise<void> {
	const samples: number[] = [];
	for (let index = 0; index < WARMUP + ITERATIONS; index++) {
		const startedAt = performance.now();
		control.handoffAt = 0;
		await automation.handleInbound(inbound(index));
		if (legacy) legacyOverhead(index);
		if (!control.handoffAt) throw new Error("Rule did not produce a reply");
		const elapsed = (legacy ? performance.now() : control.handoffAt) - startedAt;
		if (index >= WARMUP) samples.push(elapsed);
	}
	samples.sort((a, b) => a - b);
	const percentile = (p: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))]!;
	const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
	console.log(
		`${label.padEnd(30)} mean ${mean.toFixed(3)} ms   p50 ${percentile(0.5).toFixed(3)} ms   ` +
		`p95 ${percentile(0.95).toFixed(3)} ms   p99 ${percentile(0.99).toFixed(3)} ms`,
	);
}

console.log(`\n=== API reply path (inbound → handed to worker), n=${ITERATIONS} ===`);
await run("old (scan + sync writes)", true);
await run("new (indexed + deferred)", false);

await shutdown();
