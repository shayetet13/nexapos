import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BotControl } from "../src/bot-control.js";
import { MemoryStore } from "../src/store.js";
import { SecretVault } from "../src/secret-vault.js";

const cleanup: Array<() => void> = [];

afterEach(() => {
	for (const run of cleanup.splice(0)) run();
});

function createContext() {
	const dir = mkdtempSync(join(tmpdir(), "linebot-control-"));
	const stateDir = join(dir, "linejs");
	process.env.LINEJS_STORAGE_DIR = stateDir;
	const store = new MemoryStore(join(dir, "store.sqlite3"));
	const vault = new SecretVault("test-key", join(dir, "store.sqlite3"));
	cleanup.push(() => {
		store.close();
		vault.close();
		delete process.env.LINEJS_STORAGE_DIR;
		rmSync(dir, { recursive: true, force: true });
	});
	const bot = store.createBot({
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
	return { store, vault, bot, stateDir };
}

describe("BotControl adapter config", () => {
	it("claims the secondary-device slot so a desktop LINE session is not evicted", () => {
		const { store, vault, bot } = createContext();
		vault.set(bot.id, "linejs", { authToken: "a".repeat(40), device: "ANDROIDSECONDARY" });
		const registered: Array<Record<string, unknown>> = [];
		const supervisor = {
			list: () => [],
			register: (config: { adapter: Record<string, unknown> }) => registered.push(config.adapter),
			prewarm: () => {},
			on: () => {},
		};

		const control = new BotControl(store, vault, supervisor as never);
		cleanup.push(() => void control.shutdown("immediate").catch(() => undefined));
		control.prewarmQr(bot.id);

		expect(registered).toHaveLength(1);
		// DESKTOPWIN would take the slot the operator's own PC client holds.
		expect(registered[0]?.device).toBe("ANDROIDSECONDARY");
	});

	it("builds every worker config from the persisted fleet-wide settings, not hardcoded constants", () => {
		const { store, vault, bot } = createContext();
		vault.set(bot.id, "linejs", { authToken: "a".repeat(40), device: "ANDROIDSECONDARY" });
		store.updateSettings({ firstResponseWindowMs: 9_000, gracefulDrainTimeoutMs: 45_000 });
		const registered: Array<Record<string, unknown>> = [];
		const supervisor = {
			list: () => [],
			register: (config: Record<string, unknown>) => registered.push(config),
			prewarm: () => {},
			on: () => {},
		};

		const control = new BotControl(store, vault, supervisor as never);
		cleanup.push(() => void control.shutdown("immediate").catch(() => undefined));
		control.prewarmQr(bot.id);

		expect(registered[0]?.firstResponseWindowMs).toBe(9_000);
		expect(registered[0]?.gracefulStopTimeoutMs).toBe(45_000);
	});
});

describe("BotControl credential migration", () => {
	it("retires a token minted for the desktop slot and clears its LINEJS state", async () => {
		const { store, vault, bot, stateDir } = createContext();
		// A token stored before the slot change carries no device marker.
		vault.set(bot.id, "linejs", { authToken: "a".repeat(40) });
		mkdirSync(stateDir, { recursive: true });
		const statePath = join(stateDir, `${bot.id}.enc`);
		writeFileSync(statePath, "stale-encrypted-state");

		const control = new BotControl(store, vault);
		cleanup.push(() => void control.shutdown("immediate"));
		await control.reconcileOnStartup();

		expect(vault.status(bot.id).configured).toBe(false);
		expect(store.getBot(bot.id)?.status).toBe("auth_required");
		expect(store.auditLog.some((entry) => entry.action === "bot.credentials_retired")).toBe(true);
		expect(existsSync(statePath)).toBe(false);
	});

	it("keeps a token that already matches the current slot", async () => {
		const { store, vault, bot } = createContext();
		vault.set(bot.id, "linejs", { authToken: "a".repeat(40), device: "ANDROIDSECONDARY" });

		const control = new BotControl(store, vault);
		cleanup.push(() => void control.shutdown("immediate"));
		await control.reconcileOnStartup();

		expect(vault.status(bot.id).configured).toBe(true);
		expect(store.auditLog.some((entry) => entry.action === "bot.credentials_retired")).toBe(false);
	});
});
