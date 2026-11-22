import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Supervisor } from "../src/index.ts";

const supervisor = new Supervisor({
	heartbeatTimeoutMs: 2000,
	requestTimeoutMs: 2000,
	startTimeoutMs: 5000,
});

after(async () => {
	await supervisor.shutdown("immediate");
});

test("supervisor rejects cross-adapter event injection", async () => {
	supervisor.register({ botId: "official-one", adapter: {
		kind: "official",
		channelAccessToken: "test-only-token",
	} });
	await assert.rejects(
		() => supervisor.ingestEvent("official-one", {
			eventId: "wrong-source",
			targetId: "group-1",
			targetKind: "group",
			senderId: "user-1",
			text: "hello",
			timestamp: Date.now(),
			source: "linejs",
		}),
		/does not match bot adapter/,
	);
});

test("retrying start() right after a bootstrap failure does not see a stale worker handle", async () => {
	const hangSupervisor = new Supervisor({
		workerEntry: fileURLToPath(new URL("./fixtures/hang-worker.mjs", import.meta.url)),
		startTimeoutMs: 300,
		requestTimeoutMs: 300,
	});
	try {
		hangSupervisor.register({ botId: "race-bot", adapter: { kind: "official", channelAccessToken: "test-only-token" } });
		await assert.rejects(() => hangSupervisor.start("race-bot"), /timed out/);
		// The killed child's "exit" event may not have been processed yet --
		// this immediate retry must fail with a real error, not the stale
		// "already has a worker" message.
		await assert.rejects(() => hangSupervisor.start("race-bot"), (error: unknown) => {
			assert.ok(error instanceof Error);
			assert.doesNotMatch(error.message, /already has a worker/);
			return true;
		});
	} finally {
		await hangSupervisor.shutdown("immediate");
	}
});
