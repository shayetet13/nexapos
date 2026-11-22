import { EventEmitter } from "node:events";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type {
	BotConfig,
	BotInboundEvent,
	BotMetricsSnapshot,
	BotSnapshot,
	DeliveryEvent,
	NormalizedInboundEvent,
	SendTextRequest,
} from "@linebot/bot-worker";
import { Supervisor } from "@linebot/supervisor";
import type { SecretVault } from "./secret-vault.js";
import type { MemoryStore } from "./store.js";
import type { BotRecord, BotStatus, TargetRecord } from "./types.js";

/** How often an online LINEJS bot re-syncs its group/OpenChat roster automatically. */
const TARGET_SYNC_INTERVAL_MS = 30 * 60_000;

/** Cadence for the dashboard throughput chart -- one point per bot per minute, matching its "60 minutes" x-axis label. */
const METRIC_POINT_INTERVAL_MS = 60_000;

/**
 * How long a just-emitted login QR is treated as still scannable. A LINE QR
 * lives a few minutes, so a "refresh" within this window returns the same live
 * code instead of tearing down a healthy session (which is slow and can trip
 * LINE's rate limits). Once it lapses, or the session dies, a fresh QR starts.
 */
const QR_REUSE_WINDOW_MS = 150_000;

/**
 * Device slot the bot occupies on the LINE account.
 *
 * LINE allows one session per device slot and evicts the previous holder when a
 * new login claims it. Logging in as `DESKTOPWIN` therefore signs the operator
 * out of LINE on their own PC every time the bot connects. `ANDROIDSECONDARY`
 * is the secondary-device slot -- it supports the v3 (ForSecure) QR login this
 * client uses, and it does not collide with the desktop or the primary phone.
 */
const LINEJS_DEVICE = "ANDROIDSECONDARY" as const;

export type RuntimeAuthEvent = {
	botId: string;
	type: "qr" | "pin" | "authenticated" | "auth-error";
	value?: string;
	authToken?: string;
	timestamp: number;
};

export interface BotControlEvents {
	inbound: [event: BotInboundEvent];
	auth: [event: Omit<RuntimeAuthEvent, "authToken">];
}

/**
 * Bridges the HTTP control plane to the process supervisor. Secrets only exist
 * long enough to build a worker config and are never included in public events.
 */
export class BotControl extends EventEmitter<BotControlEvents> {
	readonly supervisor: Supervisor;
	readonly #store: MemoryStore;
	readonly #vault: SecretVault;
	readonly #syncTimer: NodeJS.Timeout;
	readonly #metricPointTimer: NodeJS.Timeout;
	readonly #targetSyncs = new Map<string, Promise<TargetRecord[]>>();
	/** Last QR event per bot, so a refresh can reuse a still-live code. */
	readonly #lastQr = new Map<string, { event: Omit<RuntimeAuthEvent, "authToken">; at: number }>();
	/** Latest safe auth stage, exposed through short polling instead of SSE. */
	readonly #lastAuth = new Map<string, Omit<RuntimeAuthEvent, "authToken">>();
	/**
	 * Previous CPU-time sample per bot, so consecutive snapshots can be
	 * differenced into a percentage. `process.cpuUsage()` (the source of
	 * cpuUserMicros/cpuSystemMicros) is cumulative since process start, not a
	 * point-in-time reading, so a single snapshot alone can't yield a rate.
	 */
	readonly #lastCpuSample = new Map<string, { atMs: number; totalCpuMicros: number }>();

	constructor(store: MemoryStore, vault: SecretVault, supervisor = new Supervisor()) {
		super();
		this.#store = store;
		this.#vault = vault;
		this.supervisor = supervisor;
		this.#wireEvents();
		this.#syncTimer = setInterval(() => void this.#syncOnlineLineJsBots(), TARGET_SYNC_INTERVAL_MS);
		this.#syncTimer.unref?.();
		this.#metricPointTimer = setInterval(() => {
			for (const bot of this.#store.listBots()) this.#store.recordMetricPoint(bot.id);
		}, METRIC_POINT_INTERVAL_MS);
		this.#metricPointTimer.unref?.();
	}

	async start(botId: string): Promise<BotSnapshot> {
		await this.#ensureRegistered(botId, false);
		this.#store.setStatus(botId, "starting", "online");
		try {
			return await this.supervisor.start(botId);
		} catch (cause) {
			const message = errorMessage(cause);
			this.#store.setStatus(botId, /auth|token|login|credential|pin|qr/i.test(message) ? "auth_required" : "error", "stopped");
			this.#store.addAudit("bot.start_failed", botId, { message });
			throw cause;
		}
	}

	/**
	 * Starts a fresh LINEJS QR login and resolves once the new QR is emitted.
	 *
	 * Every call is a clean restart: LINE invalidates a QR after its short
	 * lifetime (and after a scan), so "refresh QR" must tear down any
	 * in-progress or stale attempt and start a brand new session -- otherwise a
	 * second call races a worker that never re-emits its QR and just times out,
	 * and the user is left scanning a dead code. We resolve only on a real
	 * qr/pin/authenticated event (not a trailing auth-error from the session we
	 * just tore down); a genuinely stuck start is caught by the timeout.
	 */
	/**
	 * Forks the bot's worker ahead of an expected QR login so the process spawn
	 * and module load are already done when the operator asks for a code.
	 * Best-effort: a failure here only means the login pays the usual cost.
	 */
	prewarmQr(botId: string): void {
		const bot = this.#store.getBot(botId);
		if (!bot || bot.adapter !== "linejs") return;
		try {
			if (!this.supervisor.list().some((snapshot) => snapshot.botId === botId)) {
				this.supervisor.register(this.#createConfig(bot, true));
			}
			this.supervisor.prewarm(botId);
		} catch {
			// Racing registration or an already-running bot: nothing to warm.
		}
	}

	getLastAuthEvent(botId: string): Omit<RuntimeAuthEvent, "authToken"> | undefined {
		return this.#lastAuth.get(botId);
	}

	async startQr(botId: string): Promise<Omit<RuntimeAuthEvent, "authToken">> {
		// Reuse a still-live QR from a healthy pending session rather than
		// restarting it -- the code is still scannable and a needless restart is
		// slow and rate-limit-prone. Only start fresh once it lapses or the
		// session is gone (errored/expired, so no longer "auth-required").
		const cached = this.#lastQr.get(botId);
		const pending = this.supervisor.list().some((snapshot) => snapshot.botId === botId && snapshot.state === "auth-required");
		if (cached && pending && Date.now() - cached.at < QR_REUSE_WINDOW_MS) {
			return cached.event;
		}
		this.#lastQr.delete(botId);
		if (this.supervisor.list().some((snapshot) => snapshot.botId === botId)) {
			await this.supervisor.stop(botId, "immediate").catch(() => undefined);
		}
		const firstEvent = new Promise<Omit<RuntimeAuthEvent, "authToken">>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.off("auth", onAuth);
				reject(new Error("Timed out waiting for a fresh LINEJS QR code"));
			}, 20_000);
			const onAuth = (event: Omit<RuntimeAuthEvent, "authToken">) => {
				if (event.botId !== botId || event.type === "auth-error") return;
				clearTimeout(timeout);
				this.off("auth", onAuth);
				resolve(event);
			};
			this.on("auth", onAuth);
		});
		void (async () => {
			await this.#ensureRegistered(botId, true);
			this.#store.setStatus(botId, "auth_required", "online");
			await this.supervisor.start(botId);
		})().catch((cause) => {
			const message = errorMessage(cause);
			this.#store.setStatus(botId, "error", "stopped");
			this.#store.addAudit("bot.qr_start_failed", botId, { message });
			this.#store.publish("bot.auth.error", { message }, botId);
		});
		return await firstEvent;
	}

	async pause(botId: string): Promise<BotSnapshot> {
		return await this.supervisor.pause(botId);
	}

	async resume(botId: string): Promise<BotSnapshot> {
		return await this.supervisor.resume(botId);
	}

	async stop(botId: string, mode: "graceful" | "immediate" = "graceful"): Promise<BotSnapshot | undefined> {
		const registered = this.supervisor.list().some((snapshot) => snapshot.botId === botId);
		if (!registered) {
			this.#store.setStatus(botId, "stopped");
			return undefined;
		}
		this.#store.setStatus(botId, "stopping", "stopped");
		return await this.supervisor.stop(botId, mode);
	}

	async emergencyStop(): Promise<string[]> {
		const affected = this.#store.listBots()
			.filter((bot) => bot.status !== "stopped")
			.map((bot) => bot.id);
		await Promise.allSettled(affected.map((botId) => this.stop(botId, "immediate")));
		for (const botId of affected) this.#store.setStatus(botId, "stopped");
		return affected;
	}

	async enqueueText(botId: string, request: SendTextRequest): Promise<{ deliveryId: string }> {
		return await this.supervisor.enqueueText(botId, request);
	}

	async ingestEvent(botId: string, event: NormalizedInboundEvent): Promise<void> {
		await this.supervisor.ingestEvent(botId, event);
	}

	async watchTarget(botId: string, targetId: string, durationMs: number): Promise<void> {
		await this.supervisor.watchTarget(botId, targetId, durationMs);
	}

	async listTargets(botId: string) {
		return await this.supervisor.listTargets(botId);
	}

	/** Pulls the adapter's live group/OpenChat roster and upserts it into the target allowlist. */
	async syncTargets(botId: string): Promise<TargetRecord[]> {
		const active = this.#targetSyncs.get(botId);
		if (active) return await active;
		const sync = this.#syncTargetsOnce(botId).finally(() => this.#targetSyncs.delete(botId));
		this.#targetSyncs.set(botId, sync);
		return await sync;
	}

	async #syncTargetsOnce(botId: string): Promise<TargetRecord[]> {
		const discovered = await this.supervisor.listTargets(botId);
		const existingByExternalId = new Map(
			this.#store.listTargets(botId).map((target) => [target.externalId, target]),
		);
		for (const item of discovered) {
			const existing = existingByExternalId.get(item.id);
			this.#store.upsertTarget({
				id: existing?.id,
				botId,
				externalId: item.id,
				type: item.kind,
				name: item.name ?? existing?.name ?? item.id,
				enabled: existing?.enabled ?? false,
				consentConfirmedAt: existing?.consentConfirmedAt ?? null,
				memberCount: item.memberCount,
			});
		}
		return this.#store.listTargets(botId);
	}

	async shutdown(mode: "graceful" | "immediate" = "graceful"): Promise<void> {
		clearInterval(this.#syncTimer);
		clearInterval(this.#metricPointTimer);
		await this.supervisor.shutdown(mode);
	}

	/**
	 * A fresh process starts with an empty supervisor, but the store still has
	 * whatever status was last persisted before the restart -- a bot that was
	 * "online" is not actually running anymore. Without this, every action on
	 * it (start, sync, send) fails with a confusing "not registered" error
	 * until someone notices and manually stops/restarts it by hand.
	 */
	async reconcileOnStartup(): Promise<void> {
		this.#retireForeignDeviceCredentials();
		// A LINEJS bot with no stored credentials can only be started by scanning
		// a QR, so its worker is warmed now rather than when the operator asks.
		for (const bot of this.#store.listBots()) {
			if (bot.adapter === "linejs" && !this.#vault.status(bot.id).configured) this.prewarmQr(bot.id);
		}
		const stale = this.#store.listBots()
			.filter((bot) => ["online", "starting", "paused", "degraded", "stopping"].includes(bot.status));
		await Promise.all(stale.map(async (bot) => {
			if (!this.#vault.status(bot.id).configured) {
				this.#store.setStatus(bot.id, "stopped");
				this.#store.addAudit("bot.status_reconciled", bot.id, { from: bot.status, to: "stopped", reason: "credentials not configured" });
				return;
			}
			try {
				await this.start(bot.id);
				this.#store.addAudit("bot.auto_resumed", bot.id, { from: bot.status });
			} catch (cause) {
				this.#store.addAudit("bot.auto_resume_failed", bot.id, { from: bot.status, message: errorMessage(cause) });
			}
		}));
	}

	/**
	 * Drops LINEJS credentials that were issued for a different device slot.
	 *
	 * A token minted while the bot claimed the desktop slot is unusable now that
	 * it logs in as a secondary device -- and worse, reusing it would sign the
	 * operator out of LINE on their own PC, which is the exact behaviour the
	 * slot change exists to prevent. The bot's cached LINEJS state (E2EE keys
	 * for the retired session) goes with it, so the next QR login starts clean.
	 * Runs once per process; afterwards every stored token carries its slot.
	 */
	#retireForeignDeviceCredentials(): void {
		for (const bot of this.#store.listBots()) {
			if (bot.adapter !== "linejs") continue;
			const credentials = this.#vault.get(bot.id);
			if (!credentials?.authToken || credentials.device === LINEJS_DEVICE) continue;
			this.#vault.delete(bot.id);
			this.#clearLineJsState(bot.id);
			this.#store.setStatus(bot.id, "auth_required", "stopped");
			this.#store.addAudit("bot.credentials_retired", bot.id, {
				reason: "device_slot_changed",
				from: credentials.device ?? "DESKTOPWIN",
				to: LINEJS_DEVICE,
			});
		}
	}

	/** Removes a bot's persisted LINEJS client state (E2EE keys, refresh token). */
	#clearLineJsState(botId: string): void {
		const dir = process.env.LINEJS_STORAGE_DIR ?? "./data/linejs";
		try {
			rmSync(join(dir, `${botId}.enc`), { force: true });
		} catch (cause) {
			this.#store.addAudit("bot.state_clear_failed", botId, { message: errorMessage(cause) });
		}
	}

	async #syncOnlineLineJsBots(): Promise<void> {
		const bots = this.#store.listBots().filter((bot) => bot.adapter === "linejs" && bot.status === "online");
		await Promise.all(bots.map((bot) => this.syncTargets(bot.id).catch((cause) => {
			this.#store.addAudit("bot.target_sync_failed", bot.id, { message: errorMessage(cause) });
		})));
	}

	async #ensureRegistered(botId: string, qrMode: boolean): Promise<void> {
		const bot = this.#store.getBot(botId);
		if (!bot) throw new Error(`Bot '${botId}' was not found`);
		const config = this.#createConfig(bot, qrMode);
		const existing = this.supervisor.list().find((snapshot) => snapshot.botId === botId);
		if (!existing) {
			this.supervisor.register(config);
			return;
		}
		if (existing.state === "error") {
			await this.supervisor.stop(botId, "immediate");
			this.supervisor.updateConfig(botId, config);
			return;
		}
		if (existing.state === "stopped") this.supervisor.updateConfig(botId, config);
	}

	#createConfig(bot: BotRecord, qrMode: boolean): BotConfig {
		const targets = this.#store.listTargets(bot.id)
			.filter((target) => target.enabled)
			.map((target) => ({ id: target.externalId, kind: target.type, name: target.name }));
		// Fleet-wide operational defaults from the Settings page -- applied to
		// every bot's worker config at bootstrap, not stored per-bot.
		const settings = this.#store.getSettings();
		const common = {
			botId: bot.id,
			rateLimit: {
				messagesPerSecond: Math.min(1_000, bot.maxMessagesPerSecond),
				burst: bot.burst,
			},
			queueLimit: 10_000,
			heartbeatIntervalMs: 2_000,
			firstResponseWindowMs: settings.firstResponseWindowMs,
			gracefulStopTimeoutMs: settings.gracefulDrainTimeoutMs,
		};
		const credentials = this.#vault.get(bot.id);
		if (bot.adapter === "official") {
			if (!credentials?.channelAccessToken) throw new Error("Official LINE credentials are not configured");
			return {
				...common,
				adapter: { kind: "official", channelAccessToken: credentials.channelAccessToken, targets },
			};
		}
		if (!qrMode && !credentials?.authToken) throw new Error("LINEJS authentication is required");
		return {
			...common,
			adapter: {
				kind: "linejs",
				loginMode: qrMode ? "qr" : "token",
				...(qrMode ? {} : { authToken: credentials?.authToken }),
				device: LINEJS_DEVICE,
				enableTalk: true,
				enableSquare: true,
				preferCompactMessages: true,
			},
		};
	}

	#wireEvents(): void {
		this.supervisor.on("status", (snapshot: BotSnapshot) => this.#applySnapshot(snapshot));
		this.supervisor.on("heartbeat", (snapshot: BotSnapshot) => this.#applySnapshot(snapshot));
		this.supervisor.on("metrics", (payload: { botId: string; metrics: BotMetricsSnapshot }) => {
			const snapshot = this.supervisor.list().find((item) => item.botId === payload.botId);
			if (snapshot) this.#applySnapshot(snapshot);
		});
		this.supervisor.on("delivery", (event: DeliveryEvent) => {
			this.#store.completeDelivery(event.deliveryId, event.status === "sent", event.error);
		});
		this.supervisor.on("bot-event", (event: BotInboundEvent) => {
			// Direct OA chats can be absent from one of LINE's friend-roster
			// APIs. Never lose the operator's ability to allowlist a real sender:
			// the first inbound event teaches the control plane its target ID.
			// It stays disabled until explicitly approved in the dashboard.
			if (event.targetKind === "user" && !this.#store.findTarget(event.botId, event.targetId)) {
				this.#store.upsertTarget({
					botId: event.botId,
					externalId: event.targetId,
					type: "user",
					name: `LINE OA / ${event.targetId.slice(0, 10)}…`,
					enabled: false,
					consentConfirmedAt: null,
					memberCount: 1,
				});
			}
			const current = this.#store.getMetrics(event.botId);
			if (current) this.#store.updateMetrics(event.botId, {
				messagesReceived: current.messagesReceived + 1,
				lastEventAt: new Date(event.timestamp).toISOString(),
			});
			this.#store.publish("bot.event.received", {
				eventId: event.eventId,
				targetId: event.targetId,
				timestamp: event.timestamp,
			}, event.botId);
			this.emit("inbound", event);
		});
		this.supervisor.on("auth", (event: RuntimeAuthEvent) => {
			if (event.authToken) {
				this.#vault.set(event.botId, "linejs", { authToken: event.authToken, device: LINEJS_DEVICE });
				this.#store.addAudit("bot.auth_token_rotated", event.botId, { source: "linejs_qr" });
			}
			const { authToken: _secret, ...safeEvent } = event;
			this.#lastAuth.set(event.botId, safeEvent);
			// Track the live QR so a refresh can reuse it; drop it once the login
			// resolves or fails so the next refresh starts a fresh session.
			if (safeEvent.type === "qr") this.#lastQr.set(event.botId, { event: safeEvent, at: Date.now() });
			else if (safeEvent.type === "authenticated" || safeEvent.type === "auth-error") this.#lastQr.delete(event.botId);
			this.#store.publish(`bot.auth.${event.type}`, safeEvent, event.botId);
			this.emit("auth", safeEvent);
		});
		this.supervisor.on("first-response", (payload: unknown) => {
			const event = payload as { botId: string; outcome: string; eventId: string; latencyMs?: number };
			this.#store.publish("bot.first_response", event, event.botId);
		});
		this.supervisor.on("crash", (payload: unknown) => {
			const event = payload as { botId: string } & Record<string, unknown>;
			this.#store.addAudit("bot.worker_crashed", event.botId, event);
			this.#store.publish("bot.worker.crashed", event, event.botId);
		});
		this.supervisor.on("log", (payload: unknown) => {
			const event = payload as { botId: string; stream: string; message: string };
			this.#store.publish("bot.worker.log", event, event.botId);
		});
	}

	#applySnapshot(snapshot: BotSnapshot): void {
		const bot = this.#store.getBot(snapshot.botId);
		if (!bot) return;
		const status = mapStatus(snapshot.state);
		if (bot.status !== status) {
			this.#store.setStatus(bot.id, status, desiredStatus(status, bot.desiredStatus));
			if (status === "online" && bot.adapter === "linejs") {
				void this.syncTargets(bot.id).catch((cause) => {
					this.#store.addAudit("bot.target_sync_failed", bot.id, { message: errorMessage(cause) });
				});
			}
		} else {
			this.#store.updateBot(bot.id, { lastHeartbeatAt: new Date(snapshot.lastHeartbeatAt).toISOString() });
		}
		const metrics = snapshot.metrics;
		const attempts = metrics.sent + metrics.failed;
		const ratePerMinute = Math.max(1, metrics.rateLimitPerSecond * 60);
		const p95 = metrics.p95SendLatencyMs ?? 0;
		this.#store.updateMetrics(bot.id, {
			status,
			uptimeSeconds: snapshot.startedAt ? Math.max(0, Math.floor((Date.now() - snapshot.startedAt) / 1_000)) : 0,
			queueDepth: metrics.queueDepth,
			messagesReceived: metrics.received,
			messagesSent: metrics.sent,
			messagesFailed: metrics.failed + metrics.dropped,
			messagesPerSecond: metrics.sentPerMinute / 60,
			successRate: attempts ? Math.round(metrics.sent / attempts * 10_000) / 100 : 100,
			firstResponseWins: metrics.firstResponse.wins,
			firstResponseLosses: metrics.firstResponse.losses,
			firstResponseUnknown: metrics.firstResponse.unknown,
			firstResponseRate: Math.round((metrics.firstResponse.winRate ?? 0) * 10_000) / 100,
			latencyP50Ms: Math.round(metrics.averageSendLatencyMs ?? 0),
			latencyP95Ms: Math.round(p95),
			latencyP99Ms: Math.round(p95),
			memoryMb: Math.round(metrics.process.rssBytes / 1_048_576 * 10) / 10,
			cpuPercent: this.#computeCpuPercent(bot.id, snapshot),
			rateUtilization: Math.min(100, Math.round(metrics.sentPerMinute / ratePerMinute * 10_000) / 100),
		});
	}

	/**
	 * `process.cpuUsage()` is cumulative CPU time since the process started, not
	 * a rate -- turning it into a percentage requires differencing two samples
	 * over the wall-clock time between them. A falling total (process restarted
	 * since the last sample -- cpuUsage resets to near-zero) or a non-positive
	 * wall-clock gap both mean there's no valid previous baseline to diff
	 * against, so this reports 0 for that one sample rather than a nonsense
	 * negative or divide-by-zero value; the next heartbeat has a fresh baseline.
	 */
	#computeCpuPercent(botId: string, snapshot: BotSnapshot): number {
		const totalCpuMicros = snapshot.metrics.process.cpuUserMicros + snapshot.metrics.process.cpuSystemMicros;
		const atMs = snapshot.lastHeartbeatAt;
		const previous = this.#lastCpuSample.get(botId);
		this.#lastCpuSample.set(botId, { atMs, totalCpuMicros });
		if (!previous) return 0;
		const deltaWallMs = atMs - previous.atMs;
		const deltaCpuMicros = totalCpuMicros - previous.totalCpuMicros;
		if (deltaWallMs <= 0 || deltaCpuMicros < 0) return 0;
		return Math.min(100, Math.round((deltaCpuMicros / 1_000 / deltaWallMs) * 100 * 10) / 10);
	}
}

function mapStatus(state: BotSnapshot["state"]): BotStatus {
	return state === "auth-required" ? "auth_required" : state;
}

function desiredStatus(status: BotStatus, current: BotStatus): BotStatus {
	if (status === "starting" || status === "online" || status === "paused" || status === "degraded") return "online";
	if (status === "stopping" || status === "stopped") return "stopped";
	return current;
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
