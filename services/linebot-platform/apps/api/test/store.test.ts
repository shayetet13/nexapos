import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store.js";

const stores: MemoryStore[] = [];
const dirs: string[] = [];

function createStore(): MemoryStore {
	const dir = mkdtempSync(join(tmpdir(), "linebot-store-"));
	dirs.push(dir);
	const store = new MemoryStore(join(dir, "store.sqlite3"));
	stores.push(store);
	return store;
}

function seedBot(store: MemoryStore) {
	return store.createBot({
		name: "bot",
		description: "",
		adapter: "linejs",
		enabled: true,
		timezone: "Asia/Bangkok",
		speedProfile: "custom",
		maxMessagesPerSecond: 3,
		burst: 5,
		riskAcknowledgedAt: new Date().toISOString(),
	});
}

afterEach(() => {
	for (const store of stores.splice(0)) store.close();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("MemoryStore", () => {
	it("finds a target by its adapter id or its own id", () => {
		const store = createStore();
		const bot = seedBot(store);
		const target = store.upsertTarget({
			botId: bot.id,
			externalId: "cgroup1",
			type: "group",
			name: "group",
			enabled: true,
			consentConfirmedAt: null,
		});

		expect(store.findTarget(bot.id, "cgroup1")?.id).toBe(target.id);
		expect(store.findTarget(bot.id, target.id)?.id).toBe(target.id);
		expect(store.findTarget("bot_other", "cgroup1")).toBeUndefined();
		expect(store.findTarget(bot.id, "unknown")).toBeUndefined();
	});

	it("stops resolving a target once it is deleted", () => {
		const store = createStore();
		const bot = seedBot(store);
		const target = store.upsertTarget({
			botId: bot.id,
			externalId: "cgroup1",
			type: "group",
			name: "group",
			enabled: true,
			consentConfirmedAt: null,
		});
		store.deleteTarget(bot.id, target.id);
		expect(store.findTarget(bot.id, "cgroup1")).toBeUndefined();
	});

	it("ignores bookkeeping that lands after the store is closed", async () => {
		const store = createStore();
		const bot = seedBot(store);
		store.close();
		// A rule action finishing during shutdown still records an audit entry;
		// it must not be written to a database that is already closed.
		expect(() => store.addAudit("rule.action_completed", bot.id, {})).not.toThrow();
		await new Promise((resolve) => setImmediate(resolve));
		expect(() => store.flushDeferredWrites()).not.toThrow();
	});

	it("survives a restart with deferred audit and sender writes intact", () => {
		const dir = mkdtempSync(join(tmpdir(), "linebot-store-"));
		dirs.push(dir);
		const path = join(dir, "store.sqlite3");
		const store = new MemoryStore(path);
		const bot = seedBot(store);
		store.addAudit("rule.action_completed", bot.id, { ruleId: "r1" });
		store.observeSender(bot.id, "u1");
		// close() has to drain what the hot path deliberately deferred.
		store.close();

		const reopened = new MemoryStore(path);
		stores.push(reopened);
		expect(reopened.auditLog.some((entry) => entry.action === "rule.action_completed")).toBe(true);
		expect(reopened.listSenders(bot.id)).toHaveLength(1);
		expect(reopened.getSenderRole(bot.id, "u1")).toBe("member");
	});

	it("keeps a queue ticket -- and its status changes -- across a restart", () => {
		const dir = mkdtempSync(join(tmpdir(), "linebot-store-"));
		dirs.push(dir);
		const path = join(dir, "store.sqlite3");
		const store = new MemoryStore(path);
		const bot = seedBot(store);
		const ticket = store.createTicket(bot.id, "target-1", "user-1", "Somchai");
		store.updateTicket(bot.id, ticket.id, "called");
		store.close();

		const reopened = new MemoryStore(path);
		stores.push(reopened);
		const [restored] = reopened.listTickets(bot.id);
		expect(restored?.id).toBe(ticket.id);
		expect(restored?.status).toBe("called");
		expect(restored?.calledAt).not.toBeNull();
	});

	it("removes a bot's queue tickets from disk, not just memory, when the bot is deleted", () => {
		const dir = mkdtempSync(join(tmpdir(), "linebot-store-"));
		dirs.push(dir);
		const path = join(dir, "store.sqlite3");
		const store = new MemoryStore(path);
		const bot = seedBot(store);
		store.createTicket(bot.id, "target-1", "user-1", "Somchai");
		store.deleteBot(bot.id);
		store.close();

		const reopened = new MemoryStore(path);
		stores.push(reopened);
		expect(reopened.listTickets(bot.id)).toHaveLength(0);
	});

	it("keeps fleet-wide settings across a restart, and falls back to defaults before anything is saved", () => {
		const dir = mkdtempSync(join(tmpdir(), "linebot-store-"));
		dirs.push(dir);
		const path = join(dir, "store.sqlite3");
		const fresh = new MemoryStore(path);
		expect(fresh.getSettings().defaultSpeedProfile).toBe("balanced");
		fresh.updateSettings({ defaultSpeedProfile: "extreme", firstResponseWindowMs: 8_000 });
		fresh.close();

		const reopened = new MemoryStore(path);
		stores.push(reopened);
		const settings = reopened.getSettings();
		expect(settings.defaultSpeedProfile).toBe("extreme");
		expect(settings.firstResponseWindowMs).toBe(8_000);
		// A patch to one field must not clobber the others.
		expect(settings.defaultTimezone).toBe("Asia/Bangkok");
	});

	it("reports storage info for a persistent store and a purely in-memory one", () => {
		const dir = mkdtempSync(join(tmpdir(), "linebot-store-"));
		dirs.push(dir);
		const path = join(dir, "store.sqlite3");
		const store = new MemoryStore(path);
		stores.push(store);
		seedBot(store);
		const info = store.getStorageInfo();
		expect(info.persistent).toBe(true);
		expect(info.path).toBe(path);
		expect(info.sizeBytes).toBeGreaterThan(0);

		const ephemeral = new MemoryStore();
		stores.push(ephemeral);
		expect(ephemeral.getStorageInfo()).toEqual({ path: ":memory:", sizeBytes: 0, persistent: false });
	});
});
