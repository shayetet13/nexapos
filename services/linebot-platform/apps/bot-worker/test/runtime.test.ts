import assert from "node:assert/strict";
import { test } from "node:test";
import { FirstResponseTracker } from "../src/first-response-tracker.ts";
import { PriorityOutgoingQueue } from "../src/priority-queue.ts";

test("priority queue is stable and prioritizes pending replies", async () => {
	const order: string[] = [];
	let releaseFirst!: () => void;
	const firstGate = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	const queue = new PriorityOutgoingQueue<string, string>(async (value) => {
		if (value === "running") await firstGate;
		order.push(value);
		return value;
	});
	const running = queue.enqueue("running", 3);
	await new Promise((resolve) => setImmediate(resolve));
	const scheduled = queue.enqueue("scheduled", 3);
	const replyOne = queue.enqueue("reply-one", 0);
	const replyTwo = queue.enqueue("reply-two", 0);
	releaseFirst();
	await Promise.all([running, scheduled, replyOne, replyTwo]);
	assert.deepEqual(order, ["running", "reply-one", "reply-two", "scheduled"]);
});

test("first-response metrics distinguish win and human-first loss", async () => {
	const tracker = new FirstResponseTracker(1000);
	tracker.observe(inbound("event-1"));
	assert.equal(tracker.markSent("event-1"), true);
	tracker.observe(inbound("event-2"));
	tracker.observe(inbound("event-3"));
	const snapshot = tracker.snapshot();
	assert.equal(snapshot.wins, 1);
	assert.equal(snapshot.losses, 1);
	assert.equal(snapshot.pending, 1);
	assert.equal(snapshot.winRate, 0.5);
	tracker.markAllUnknown();
});

test("Node runtime can load the real LINEJS package boundary", async () => {
	const linejs = await import("@evex/linejs");
	assert.equal(typeof linejs.loginWithAuthToken, "function");
	assert.equal(typeof linejs.loginWithQR, "function");
});

function inbound(eventId: string) {
	return {
		eventId,
		targetId: "group-a",
		targetKind: "group" as const,
		senderId: "user-a",
		text: "ping",
		timestamp: Date.now(),
		source: "official" as const,
	};
}
