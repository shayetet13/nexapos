import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import type {
	BotConfig,
	BotMetricsSnapshot,
	BotSnapshot,
	BotState,
	BotTarget,
	NormalizedInboundEvent,
	SendTextRequest,
	SendTextResult,
	SupervisorToWorkerMessage,
	WorkerToSupervisorMessage,
} from "../../bot-worker/src/index.ts";

export type StopMode = "graceful" | "immediate";

export interface SupervisorOptions {
	workerEntry?: string | URL;
	requestTimeoutMs?: number;
	startTimeoutMs?: number;
	gracefulStopTimeoutMs?: number;
	heartbeatTimeoutMs?: number;
	maxRestarts?: number;
	restartBaseDelayMs?: number;
}

export interface RegisteredBot {
	botId: string;
	adapterKind: BotConfig["adapter"]["kind"];
	state: BotState;
}

type RequestWithoutId = SupervisorToWorkerMessage extends infer Message
	? Message extends { requestId: string }
		? Omit<Message, "requestId">
		: never
	: never;

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
	timer: NodeJS.Timeout;
}

interface WorkerHandle {
	child: ChildProcess;
	pending: Map<string, PendingRequest>;
	ready: Promise<void>;
	resolveReady: () => void;
	rejectReady: (error: unknown) => void;
	lastHeartbeatAt: number;
	bootstrapped: boolean;
	bootstrapFailed: boolean;
}

interface BotRecord {
	config: BotConfig;
	snapshot: BotSnapshot;
	desiredRunning: boolean;
	restartAttempts: number;
	startPromise?: Promise<BotSnapshot>;
	restartTimer?: NodeJS.Timeout;
}

export class SupervisorError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SupervisorError";
	}
}

export class BotNotFoundError extends SupervisorError {
	constructor(botId: string) {
		super(`Bot '${botId}' is not registered`);
		this.name = "BotNotFoundError";
	}
}

/**
 * In-process control plane used by the API. Each registered bot gets exactly
 * one child process, and all messages are validated against that process's
 * immutable botId before being exposed to consumers.
 */
/**
 * How long an unused pre-warmed worker is kept before being reaped. Long enough
 * to cover an operator opening a bot and deciding to log in, short enough that
 * an abandoned tab does not hold a process forever.
 */
const PREWARM_TTL_MS = 5 * 60_000;

export class Supervisor extends EventEmitter {
	#records = new Map<string, BotRecord>();
	#workers = new Map<string, WorkerHandle>();
	/** Forked-and-idle workers awaiting a bootstrap; see {@link prewarm}. */
	#prewarmed = new Map<string, { handle: WorkerHandle; expiresAt: number }>();
	#options: Required<Omit<SupervisorOptions, "workerEntry">> & { workerEntry: string };
	#monitor: NodeJS.Timeout;
	#lastHeartbeatCheckAt = Date.now();
	readonly #heartbeatCheckIntervalMs: number;

	constructor(options: SupervisorOptions = {}) {
		super();
		this.#options = {
			workerEntry: normalizeWorkerEntry(options.workerEntry),
			requestTimeoutMs: options.requestTimeoutMs ?? 10_000,
			startTimeoutMs: options.startTimeoutMs ?? 5 * 60_000,
			gracefulStopTimeoutMs: options.gracefulStopTimeoutMs ?? 35_000,
			heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 15_000,
			maxRestarts: options.maxRestarts ?? 5,
			restartBaseDelayMs: options.restartBaseDelayMs ?? 500,
		};
		this.#heartbeatCheckIntervalMs = Math.max(250, Math.floor(this.#options.heartbeatTimeoutMs / 2));
		this.#monitor = setInterval(
			() => this.#checkHeartbeats(),
			this.#heartbeatCheckIntervalMs,
		);
		this.#monitor.unref();
	}

	register(config: BotConfig): RegisteredBot {
		validateConfigShape(config);
		if (this.#records.has(config.botId)) {
			throw new SupervisorError(`Bot '${config.botId}' is already registered`);
		}
		const cloned = structuredClone(config);
		const snapshot = stoppedSnapshot(cloned);
		this.#records.set(config.botId, {
			config: cloned,
			snapshot,
			desiredRunning: false,
			restartAttempts: 0,
		});
		return summarize(snapshot);
	}

	create(config: BotConfig): RegisteredBot {
		return this.register(config);
	}

	createBot(config: BotConfig): RegisteredBot {
		return this.register(config);
	}

	updateConfig(botId: string, config: BotConfig): RegisteredBot {
		const record = this.#requireRecord(botId);
		if (this.#workers.has(botId) || record.snapshot.state !== "stopped") {
			throw new SupervisorError("Bot config can only be changed while stopped");
		}
		if (config.botId !== botId) throw new SupervisorError("botId is immutable");
		validateConfigShape(config);
		record.config = structuredClone(config);
		record.snapshot = stoppedSnapshot(record.config);
		return summarize(record.snapshot);
	}

	async start(botId: string): Promise<BotSnapshot> {
		const record = this.#requireRecord(botId);
		const existing = this.#workers.get(botId);
		if (existing?.bootstrapped) return structuredClone(record.snapshot);
		if (record.startPromise) return await record.startPromise;
		record.desiredRunning = true;
		record.restartAttempts = 0;
		if (record.restartTimer) clearTimeout(record.restartTimer);
		record.startPromise = this.#spawn(record, false).finally(() => {
			record.startPromise = undefined;
		});
		return await record.startPromise;
	}

	async pause(botId: string): Promise<BotSnapshot> {
		return await this.#control(botId, "pause");
	}

	async resume(botId: string): Promise<BotSnapshot> {
		return await this.#control(botId, "resume");
	}

	async stop(botId: string, mode: StopMode = "graceful"): Promise<BotSnapshot> {
		const record = this.#requireRecord(botId);
		record.desiredRunning = false;
		if (record.restartTimer) {
			clearTimeout(record.restartTimer);
			record.restartTimer = undefined;
		}
		const handle = this.#workers.get(botId);
		if (!handle) {
			record.snapshot = { ...record.snapshot, state: "stopped", adapterHealth: {
				connected: false,
				detail: "not running",
				checkedAt: Date.now(),
			} };
			return structuredClone(record.snapshot);
		}

		if (mode === "immediate") {
			await this.#request(handle, {
				type: "command",
				command: "stop-immediate",
			}, 750).catch(() => undefined);
			if (handle.child.exitCode === null) handle.child.kill("SIGKILL");
		} else {
			await this.#request(handle, {
				type: "command",
				command: "stop-graceful",
			}, this.#options.gracefulStopTimeoutMs).catch((error) => {
				this.emit("log", { botId, stream: "supervisor", message: String(error) });
				if (handle.child.exitCode === null) handle.child.kill("SIGKILL");
			});
			await waitForExit(handle.child, 1000).catch(() => {
				if (handle.child.exitCode === null) handle.child.kill("SIGKILL");
			});
		}
		record.snapshot = {
			...record.snapshot,
			state: "stopped",
			lastHeartbeatAt: Date.now(),
			adapterHealth: { connected: false, detail: "stopped", checkedAt: Date.now() },
		};
		this.emit("status", structuredClone(record.snapshot));
		return structuredClone(record.snapshot);
	}

	status(botId: string): BotSnapshot {
		return structuredClone(this.#requireRecord(botId).snapshot);
	}

	getStatus(botId: string): BotSnapshot {
		return this.status(botId);
	}

	list(): BotSnapshot[] {
		return [...this.#records.values()].map((record) => structuredClone(record.snapshot));
	}

	metrics(botId: string): BotMetricsSnapshot {
		return structuredClone(this.#requireRecord(botId).snapshot.metrics);
	}

	getMetrics(botId: string): BotMetricsSnapshot {
		return this.metrics(botId);
	}

	async refresh(botId: string): Promise<BotSnapshot> {
		const record = this.#requireRecord(botId);
		const handle = this.#requireWorker(botId);
		const snapshot = await this.#request(handle, { type: "snapshot" }) as BotSnapshot;
		this.#acceptSnapshot(record, snapshot);
		return structuredClone(record.snapshot);
	}

	async sendText(botId: string, request: SendTextRequest): Promise<SendTextResult> {
		const handle = this.#requireWorker(botId);
		return await this.#request(handle, { type: "send-text", request }) as SendTextResult;
	}

	/**
	 * Returns a delivery id immediately for HTTP 202-style APIs. Final outcome is
	 * published through the `delivery` event; `sendText` remains the await-result API.
	 */
	async enqueueText(
		botId: string,
		request: SendTextRequest,
	): Promise<{ deliveryId: string }> {
		const handle = this.#requireWorker(botId);
		const deliveryId = request.deliveryId ?? randomUUID();
		return await this.#request(handle, {
			type: "enqueue-text",
			request: { ...request, deliveryId },
		}) as { deliveryId: string };
	}

	async ingestEvent(botId: string, event: NormalizedInboundEvent): Promise<void> {
		const record = this.#requireRecord(botId);
		if (event.source !== record.config.adapter.kind) {
			throw new SupervisorError(
				`Event source '${event.source}' does not match bot adapter '${record.config.adapter.kind}'`,
			);
		}
		const handle = this.#requireWorker(botId);
		await this.#request(handle, { type: "ingest-event", event });
	}

	async watchTarget(botId: string, targetId: string, durationMs: number): Promise<void> {
		const handle = this.#requireWorker(botId);
		await this.#request(handle, { type: "watch-target", targetId, durationMs }, 15_000);
	}

	async listTargets(botId: string): Promise<BotTarget[]> {
		const handle = this.#requireWorker(botId);
		// Discovery fans out to LINE's servers (roster fetch per joined
		// OpenChat), so it needs more headroom than a normal control request.
		return await this.#request(handle, { type: "list-targets" }, 40_000) as BotTarget[];
	}

	async shutdown(mode: StopMode = "graceful"): Promise<void> {
		clearInterval(this.#monitor);
		for (const [botId] of this.#prewarmed) this.#reapPrewarmed(botId);
		await Promise.allSettled(this.list().map((bot) => this.stop(bot.botId, mode)));
	}

	#reapPrewarmed(botId: string): void {
		const warm = this.#prewarmed.get(botId);
		if (!warm) return;
		this.#prewarmed.delete(botId);
		if (warm.handle.child.exitCode === null) warm.handle.child.kill("SIGKILL");
	}

	async #control(botId: string, command: "pause" | "resume"): Promise<BotSnapshot> {
		const record = this.#requireRecord(botId);
		const handle = this.#requireWorker(botId);
		const snapshot = await this.#request(handle, { type: "command", command }) as BotSnapshot;
		this.#acceptSnapshot(record, snapshot);
		return structuredClone(record.snapshot);
	}

	/**
	 * Forks a worker for `botId` ahead of time and holds it at the pre-bootstrap
	 * point, so a later {@link start} skips the process spawn and module load.
	 *
	 * That startup work is ~300-500ms of the wait before a login QR can appear.
	 * Pre-warming moves it off the operator's click. Safe to call repeatedly:
	 * an existing warm or running worker short-circuits, and an unclaimed
	 * worker is reaped after {@link PREWARM_TTL_MS}.
	 */
	prewarm(botId: string): void {
		this.#requireRecord(botId);
		if (this.#workers.has(botId) || this.#prewarmed.has(botId)) return;
		const handle = this.#createWorker(botId);
		this.#prewarmed.set(botId, { handle, expiresAt: Date.now() + PREWARM_TTL_MS });
		handle.child.once("exit", () => {
			if (this.#prewarmed.get(botId)?.handle === handle) this.#prewarmed.delete(botId);
		});
		// A pre-warm that nobody claims must not keep a process (or an unhandled
		// rejection) alive.
		handle.ready.catch(() => undefined);
	}

	#createWorker(botId: string): WorkerHandle {
		const child = fork(this.#options.workerEntry, [], {
			stdio: ["ignore", "pipe", "pipe", "ipc"],
			serialization: "advanced",
			execArgv: [],
			env: { ...process.env, LINEBOT_WORKER_ID: botId },
		});
		let resolveReady!: () => void;
		let rejectReady!: (error: unknown) => void;
		const ready = new Promise<void>((resolve, reject) => {
			resolveReady = resolve;
			rejectReady = reject;
		});
		const handle: WorkerHandle = {
			child,
			pending: new Map(),
			ready,
			resolveReady,
			rejectReady,
			lastHeartbeatAt: Date.now(),
			bootstrapped: false,
			bootstrapFailed: false,
		};
		// The worker announces readiness before anyone claims it, so this
		// listener has to exist from the moment it is forked.
		child.on("message", (message: unknown) => {
			if ((message as { type?: string } | null)?.type === "ready") handle.resolveReady();
		});
		return handle;
	}

	/** Returns a usable pre-warmed worker for `botId`, if one is still healthy. */
	#claimPrewarmed(botId: string): WorkerHandle | undefined {
		const warm = this.#prewarmed.get(botId);
		if (!warm) return undefined;
		this.#prewarmed.delete(botId);
		const usable = warm.expiresAt > Date.now() &&
			warm.handle.child.connected &&
			warm.handle.child.exitCode === null;
		if (usable) return warm.handle;
		if (warm.handle.child.exitCode === null) warm.handle.child.kill("SIGKILL");
		return undefined;
	}

	async #spawn(record: BotRecord, automatic: boolean): Promise<BotSnapshot> {
		const botId = record.config.botId;
		if (this.#workers.has(botId)) throw new SupervisorError(`Bot '${botId}' already has a worker`);
		const handle = this.#claimPrewarmed(botId) ?? this.#createWorker(botId);
		const child = handle.child;
		this.#workers.set(botId, handle);
		record.snapshot = { ...record.snapshot, state: "starting", lastHeartbeatAt: Date.now() };
		this.emit("status", structuredClone(record.snapshot));
		child.on("message", (message: unknown) => this.#onMessage(record, handle, message));
		child.once("error", (error) => handle.rejectReady(error));
		child.once("exit", (code, signal) => this.#onExit(record, handle, code, signal));
		child.stdout?.on("data", (chunk) => this.#emitWorkerLog(record, "stdout", chunk));
		child.stderr?.on("data", (chunk) => this.#emitWorkerLog(record, "stderr", chunk));

		try {
			await withTimeout(handle.ready, 5000, "Worker did not become IPC-ready");
			const snapshot = await this.#request(handle, {
				type: "bootstrap",
				config: structuredClone(record.config),
			}, this.#options.startTimeoutMs) as BotSnapshot;
			handle.bootstrapped = true;
			this.#acceptSnapshot(record, snapshot);
			if (!automatic) this.emit("status", structuredClone(record.snapshot));
			return structuredClone(record.snapshot);
		} catch (error) {
			handle.bootstrapFailed = true;
			record.desiredRunning = false;
			record.snapshot = {
				...record.snapshot,
				state: "error",
				lastError: error instanceof Error ? error.message : String(error),
			};
			// Remove the handle synchronously instead of waiting on the killed
			// child's async "exit" event -- otherwise a retry that lands inside
			// that window sees a stale entry and fails with "already has a
			// worker" even though nothing is actually running.
			if (this.#workers.get(botId) === handle) this.#workers.delete(botId);
			if (child.exitCode === null) child.kill("SIGKILL");
			if (!automatic) this.emit("status", structuredClone(record.snapshot));
			throw error;
		}
	}

	#onMessage(record: BotRecord, handle: WorkerHandle, value: unknown): void {
		if (!value || typeof value !== "object" || !("type" in value)) return;
		const message = value as WorkerToSupervisorMessage;
		if (message.type === "ready") {
			handle.resolveReady();
			return;
		}
		if (message.type === "response") {
			const pending = handle.pending.get(message.requestId);
			if (!pending) return;
			clearTimeout(pending.timer);
			handle.pending.delete(message.requestId);
			if (message.ok) pending.resolve(message.data);
			else pending.reject(new SupervisorError(message.error));
			return;
		}
		if (message.type === "heartbeat") {
			if (!this.#isBotPayload(record, message.snapshot)) return;
			handle.lastHeartbeatAt = Date.now();
			this.#acceptSnapshot(record, message.snapshot);
			this.emit("heartbeat", structuredClone(message.snapshot));
			this.emit("metrics", {
				botId: record.config.botId,
				metrics: structuredClone(message.snapshot.metrics),
			});
			return;
		}
		if (message.type === "event") {
			const payload = message.event.payload as { botId?: string };
			if (!this.#isBotPayload(record, payload)) return;
			if (message.event.name === "status") {
				this.#acceptSnapshot(record, message.event.payload);
				// runtime.start() transitions to "online" (and emits this event)
				// synchronously, before it returns and the worker sends the
				// bootstrap response -- so this can arrive here before
				// `handle.bootstrapped` is set. Forwarding it early lets
				// consumers like the auto-sync-on-connect race #requireWorker's
				// bootstrapped gate and fail with "is not running". The snapshot
				// is still recorded above; the bootstrap success path (or the
				// next heartbeat) re-emits "status" once bootstrapped is true.
				if (!handle.bootstrapped) return;
			}
			const publicName = message.event.name === "inbound" ? "bot-event" : message.event.name;
			this.emit(publicName, structuredClone(message.event.payload));
			return;
		}
		if (message.type === "fatal") {
			record.snapshot = { ...record.snapshot, state: "error", lastError: message.error };
			this.emit("status", structuredClone(record.snapshot));
		}
	}

	#onExit(
		record: BotRecord,
		handle: WorkerHandle,
		code: number | null,
		signal: NodeJS.Signals | null,
	): void {
		if (this.#workers.get(record.config.botId) !== handle) return;
		this.#workers.delete(record.config.botId);
		handle.rejectReady(new SupervisorError("Worker exited before ready"));
		for (const request of handle.pending.values()) {
			clearTimeout(request.timer);
			request.reject(new SupervisorError(`Worker exited (code=${code}, signal=${signal})`));
		}
		handle.pending.clear();
		const unexpected = record.desiredRunning && !handle.bootstrapFailed;
		record.snapshot = {
			...record.snapshot,
			state: unexpected ? "error" : "stopped",
			lastError: unexpected ? `Worker exited unexpectedly (code=${code}, signal=${signal})` : record.snapshot.lastError,
			lastHeartbeatAt: Date.now(),
			adapterHealth: { connected: false, detail: "worker process exited", checkedAt: Date.now() },
		};
		this.emit("status", structuredClone(record.snapshot));
		this.emit("crash", {
			botId: record.config.botId,
			unexpected,
			code,
			signal,
			restartAttempt: unexpected ? record.restartAttempts + 1 : 0,
		});
		if (unexpected) this.#scheduleRestart(record);
	}

	#scheduleRestart(record: BotRecord): void {
		if (record.restartAttempts >= this.#options.maxRestarts) {
			record.desiredRunning = false;
			record.snapshot.lastError = `Restart limit (${this.#options.maxRestarts}) reached`;
			this.emit("status", structuredClone(record.snapshot));
			return;
		}
		record.restartAttempts++;
		const delay = Math.min(
			30_000,
			this.#options.restartBaseDelayMs * 2 ** (record.restartAttempts - 1),
		);
		record.restartTimer = setTimeout(() => {
			record.restartTimer = undefined;
			if (!record.desiredRunning) return;
			void this.#spawn(record, true).catch(() => undefined);
		}, delay);
		record.restartTimer.unref();
	}

	#request(
		handle: WorkerHandle,
		message: RequestWithoutId,
		timeoutMs = this.#options.requestTimeoutMs,
	): Promise<unknown> {
		if (!handle.child.connected) return Promise.reject(new SupervisorError("Worker IPC is closed"));
		const requestId = randomUUID();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				handle.pending.delete(requestId);
				reject(new SupervisorError(`Worker request '${message.type}' timed out`));
			}, timeoutMs);
			handle.pending.set(requestId, { resolve, reject, timer });
			handle.child.send({ ...message, requestId }, (error) => {
				if (!error) return;
				const pending = handle.pending.get(requestId);
				if (!pending) return;
				clearTimeout(pending.timer);
				handle.pending.delete(requestId);
				reject(error);
			});
		});
	}

	#acceptSnapshot(record: BotRecord, snapshot: BotSnapshot): void {
		if (!this.#isBotPayload(record, snapshot)) return;
		record.snapshot = structuredClone(snapshot);
	}

	#isBotPayload(record: BotRecord, payload: { botId?: string }): boolean {
		if (payload.botId === record.config.botId) return true;
		const handle = this.#workers.get(record.config.botId);
		if (handle?.child.exitCode === null) handle.child.kill("SIGKILL");
		record.snapshot = {
			...record.snapshot,
			state: "error",
			lastError: "Worker isolation violation: mismatched botId",
		};
		this.emit("status", structuredClone(record.snapshot));
		return false;
	}

	#checkHeartbeats(): void {
		const now = Date.now();
		const monitorLagMs = now - this.#lastHeartbeatCheckAt - this.#heartbeatCheckIntervalMs;
		this.#lastHeartbeatCheckAt = now;
		for (const [botId, warm] of this.#prewarmed) {
			if (warm.expiresAt <= now) this.#reapPrewarmed(botId);
		}
		// If the control-plane event loop itself was blocked, IPC heartbeats may
		// already be queued but not processed. Give them one tick to drain instead
		// of killing a healthy worker based on a false stale timestamp.
		if (monitorLagMs > this.#options.heartbeatTimeoutMs) return;
		for (const [botId, handle] of this.#workers) {
			if (now - handle.lastHeartbeatAt <= this.#options.heartbeatTimeoutMs) continue;
			const record = this.#records.get(botId);
			if (record) {
				record.snapshot = {
					...record.snapshot,
					state: "degraded",
					lastError: "Worker heartbeat timed out",
				};
				this.emit("status", structuredClone(record.snapshot));
			}
			handle.child.kill("SIGKILL");
		}
	}

	#emitWorkerLog(record: BotRecord, stream: "stdout" | "stderr", chunk: unknown): void {
		this.emit("log", {
			botId: record.config.botId,
			stream,
			message: redact(String(chunk), record.config),
		});
	}

	#requireRecord(botId: string): BotRecord {
		const record = this.#records.get(botId);
		if (!record) throw new BotNotFoundError(botId);
		return record;
	}

	#requireWorker(botId: string): WorkerHandle {
		this.#requireRecord(botId);
		const worker = this.#workers.get(botId);
		if (!worker?.bootstrapped) throw new SupervisorError(`Bot '${botId}' is not running`);
		return worker;
	}
}

function normalizeWorkerEntry(entry?: string | URL): string {
	if (entry instanceof URL) return fileURLToPath(entry);
	if (entry) return entry;
	try {
		return fileURLToPath(import.meta.resolve("@linebot/bot-worker/process-entry"));
	} catch {
		return fileURLToPath(new URL("../../bot-worker/src/process-entry.ts", import.meta.url));
	}
}

function validateConfigShape(config: BotConfig): void {
	if (!config || typeof config !== "object") throw new TypeError("Bot config is required");
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(config.botId)) {
		throw new TypeError("Invalid botId");
	}
	if (!config.adapter || !["official", "linejs"].includes(config.adapter.kind)) {
		throw new TypeError("Invalid adapter config");
	}
	if (config.adapter.kind === "official" && !config.adapter.channelAccessToken) {
		throw new TypeError("Official LINE adapter requires channelAccessToken");
	}
	if (
		config.adapter.kind === "linejs" &&
		(config.adapter.loginMode ?? "token") === "token" &&
		!config.adapter.authToken
	) {
		throw new TypeError("LINEJS token login requires authToken");
	}
}

function stoppedSnapshot(config: BotConfig): BotSnapshot {
	const now = Date.now();
	return {
		botId: config.botId,
		adapterKind: config.adapter.kind,
		state: "stopped",
		startedAt: null,
		lastHeartbeatAt: now,
		adapterHealth: { connected: false, detail: "not started", checkedAt: now },
		metrics: {
			received: 0,
			enqueued: 0,
			sent: 0,
			failed: 0,
			dropped: 0,
			queueDepth: 0,
			receivedPerMinute: 0,
			sentPerMinute: 0,
			averageSendLatencyMs: null,
			p95SendLatencyMs: null,
			rateLimitPerSecond: config.rateLimit?.messagesPerSecond ??
				(config.adapter.kind === "official" ? 10 : 1),
			firstResponse: {
				wins: 0,
				losses: 0,
				unknown: 0,
				pending: 0,
				winRate: null,
				averageLatencyMs: null,
				p95LatencyMs: null,
			},
			process: {
				pid: 0,
				rssBytes: 0,
				heapUsedBytes: 0,
				cpuUserMicros: 0,
				cpuSystemMicros: 0,
			},
		},
	};
}

function summarize(snapshot: BotSnapshot): RegisteredBot {
	return {
		botId: snapshot.botId,
		adapterKind: snapshot.adapterKind,
		state: snapshot.state,
	};
}

function redact(value: string, config: BotConfig): string {
	let result = value.slice(0, 4000);
	const secrets: string[] = [];
	if (config.adapter.kind === "official") secrets.push(config.adapter.channelAccessToken);
	if (config.adapter.kind === "linejs" && config.adapter.authToken) secrets.push(config.adapter.authToken);
	for (const secret of secrets) {
		if (secret) result = result.split(secret).join("[REDACTED]");
	}
	return result;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_resolve, reject) => {
				timer = setTimeout(() => reject(new SupervisorError(message)), ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
	return withTimeout(
		new Promise<void>((resolve) => child.once("exit", () => resolve())),
		timeoutMs,
		"Worker did not exit",
	);
}
