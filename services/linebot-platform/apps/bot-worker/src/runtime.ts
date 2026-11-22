import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { createAdapter } from "./adapters/index.ts";
import type {
	AdapterAuthEvent,
	BotAdapter,
	BotConfig,
	BotSnapshot,
	BotState,
	DeliveryEvent,
	NormalizedInboundEvent,
	SendTextRequest,
	SendTextResult,
} from "./contracts.ts";
import {
	DELIVERY_PRIORITY,
	sanitizeError,
	validateBotConfig,
} from "./contracts.ts";
import { FirstResponseTracker } from "./first-response-tracker.ts";
import { RuntimeMetrics } from "./metrics.ts";
import { PriorityOutgoingQueue, QueueClosedError } from "./priority-queue.ts";
import { TokenBucketRateLimiter } from "./rate-limiter.ts";

export interface BotRuntimeEvents {
	status: [snapshot: BotSnapshot];
	inbound: [event: NormalizedInboundEvent & { botId: string }];
	delivery: [event: DeliveryEvent];
	auth: [event: AdapterAuthEvent & { botId: string }];
	firstResponse: [payload: {
		botId: string;
		outcome: "win" | "loss" | "unknown";
		eventId: string;
		latencyMs?: number;
	}];
}

export class BotRuntime extends EventEmitter<BotRuntimeEvents> {
	readonly botId: string;
	readonly adapter: BotAdapter;
	#config: Readonly<BotConfig>;
	#state: BotState = "stopped";
	#startedAt: number | null = null;
	#lastHeartbeatAt = Date.now();
	#lastError?: string;
	#metrics = new RuntimeMetrics();
	#firstResponse: FirstResponseTracker;
	#limiter: TokenBucketRateLimiter;
	#queue: PriorityOutgoingQueue<SendTextRequest, SendTextResult>;
	#abort = new AbortController();
	#unsubscribe?: () => void;
	#unsubscribeAuth?: () => void;

	constructor(config: BotConfig, adapter = createAdapter(config.adapter)) {
		super();
		validateBotConfig(config);
		this.#config = structuredClone(config);
		this.botId = config.botId;
		this.adapter = adapter;
		const rate = config.rateLimit ?? defaultRateLimit(config.adapter.kind);
		this.#limiter = new TokenBucketRateLimiter(rate.messagesPerSecond, rate.burst);
		this.#firstResponse = new FirstResponseTracker(
			config.firstResponseWindowMs ?? 5000,
			(outcome, eventId, latencyMs) => {
				this.emit("firstResponse", { botId: this.botId, outcome, eventId, latencyMs });
			},
		);
		this.#queue = new PriorityOutgoingQueue(
			(request) => this.#deliver(request),
			{
				limit: config.queueLimit ?? 1000,
				onDepth: (depth) => {
					this.#metrics.queueDepth = depth;
				},
			},
		);
	}

	get state(): BotState {
		return this.#state;
	}

	async start(): Promise<BotSnapshot> {
		if (this.#state === "online" || this.#state === "paused") return this.snapshot();
		if (this.#state === "starting" || this.#state === "stopping") {
			throw new Error(`Cannot start bot while state is ${this.#state}`);
		}
		this.#abort = new AbortController();
		this.#transition(
			this.#config.adapter.kind === "linejs" &&
				this.#config.adapter.loginMode === "qr"
				? "auth-required"
				: "starting",
		);
		this.#unsubscribe = this.adapter.subscribeEvents((event) => this.#onInbound(event));
		this.#unsubscribeAuth = this.adapter.subscribeAuthEvents?.((event) => {
			this.emit("auth", { ...event, botId: this.botId });
		});
		try {
			await this.adapter.connect();
			this.#startedAt = Date.now();
			this.#lastError = undefined;
			this.#transition("online");
			return await this.snapshot();
		} catch (error) {
			this.#lastError = sanitizeError(error);
			this.#transition(isAuthenticationError(error) ? "auth-required" : "error");
			throw error;
		}
	}

	async pause(): Promise<BotSnapshot> {
		if (this.#state === "paused") return this.snapshot();
		if (this.#state !== "online") throw new Error(`Cannot pause bot in ${this.#state} state`);
		this.#queue.pause();
		this.#transition("paused");
		return await this.snapshot();
	}

	async resume(): Promise<BotSnapshot> {
		if (this.#state === "online") return this.snapshot();
		if (this.#state !== "paused") throw new Error(`Cannot resume bot in ${this.#state} state`);
		this.#queue.resume();
		this.#transition("online");
		return await this.snapshot();
	}

	async stop(mode: "graceful" | "immediate"): Promise<BotSnapshot> {
		if (this.#state === "stopped") return this.snapshot();
		this.#transition("stopping");
		this.#queue.stopAccepting();
		if (mode === "graceful") {
			this.#queue.resume();
			try {
				await withTimeout(
					this.#queue.drain(),
					this.#config.gracefulStopTimeoutMs ?? 30_000,
					"Graceful queue drain timed out",
				);
			} catch (error) {
				this.#lastError = sanitizeError(error);
				const dropped = this.#queue.cancelPending("Graceful stop timed out");
				this.#metrics.recordDropped(dropped);
				this.#abort.abort();
			}
		} else {
			const dropped = this.#queue.cancelPending("Immediate stop requested");
			this.#metrics.recordDropped(dropped);
			this.#abort.abort();
		}
		this.#firstResponse.markAllUnknown();
		this.#unsubscribe?.();
		this.#unsubscribeAuth?.();
		await withTimeout(
			this.adapter.disconnect(),
			mode === "immediate" ? 500 : 5000,
			"Adapter disconnect timed out",
		).catch((error) => {
			this.#lastError = sanitizeError(error);
		});
		this.#transition("stopped");
		return await this.snapshot();
	}

	async sendText(request: SendTextRequest): Promise<SendTextResult> {
		return await this.queueText(request).completion;
	}

	queueText(request: SendTextRequest): {
		deliveryId: string;
		completion: Promise<SendTextResult>;
	} {
		if (this.#state !== "online") {
			throw new Error(`Bot ${this.botId} is ${this.#state}; outgoing work is disabled`);
		}
		validateSendRequest(request);
		const normalized: SendTextRequest = {
			...structuredClone(request),
			deliveryId: request.deliveryId ?? randomUUID(),
			priority: request.priority ?? "api",
		};
		this.#metrics.recordEnqueued();
		try {
			const completion = this.#queue.enqueue(
				normalized,
				DELIVERY_PRIORITY[normalized.priority ?? "api"],
			);
			return { deliveryId: normalized.deliveryId as string, completion };
		} catch (error) {
			if (error instanceof QueueClosedError) {
				this.#metrics.recordDropped();
				this.emit("delivery", {
					botId: this.botId,
					deliveryId: normalized.deliveryId as string,
					status: "dropped",
					targetId: normalized.targetId,
					timestamp: Date.now(),
					error: sanitizeError(error),
				});
			}
			throw error;
		}
	}

	async ingestEvent(event: NormalizedInboundEvent): Promise<void> {
		if (this.#state !== "online" && this.#state !== "paused") {
			throw new Error(`Cannot ingest event while bot is ${this.#state}`);
		}
		validateInboundEvent(event, this.adapter.kind);
		if (this.adapter.ingestEvent) await this.adapter.ingestEvent(structuredClone(event));
		else await this.#onInbound(structuredClone(event));
	}

	async watchTarget(targetId: string, durationMs: number): Promise<void> {
		if (this.#state !== "online") throw new Error(`Cannot watch target while bot is ${this.#state}`);
		if (!this.adapter.watchTarget) throw new Error("Adapter does not support reliable target watching");
		await this.adapter.watchTarget(targetId, durationMs);
	}

	async listTargets(): Promise<unknown> {
		if (this.#state !== "online" && this.#state !== "paused") {
			throw new Error(`Cannot list targets while bot is ${this.#state}`);
		}
		return await this.adapter.listTargets();
	}

	async snapshot(): Promise<BotSnapshot> {
		this.#lastHeartbeatAt = Date.now();
		let adapterHealth;
		try {
			adapterHealth = await this.adapter.health();
		} catch (error) {
			adapterHealth = {
				connected: false,
				detail: sanitizeError(error),
				checkedAt: Date.now(),
			};
		}
		return {
			botId: this.botId,
			adapterKind: this.adapter.kind,
			state: this.#state,
			startedAt: this.#startedAt,
			lastHeartbeatAt: this.#lastHeartbeatAt,
			lastError: this.#lastError,
			adapterHealth,
			metrics: this.#metrics.snapshot(
				this.#firstResponse.snapshot(),
				this.#limiter.effectiveRate,
			),
		};
	}

	async #onInbound(event: NormalizedInboundEvent): Promise<void> {
		this.#metrics.recordReceived();
		this.#firstResponse.observe(event);
		this.emit("inbound", { ...event, botId: this.botId });
	}

	async #deliver(request: SendTextRequest): Promise<SendTextResult> {
		const startedAt = Date.now();
		try {
			await this.#limiter.take(this.#abort.signal);
			const result = await this.adapter.sendText(request, this.#abort.signal);
			this.#metrics.recordSent(Date.now() - startedAt, result.sentAt);
			if (request.relatedEventId) {
				this.#firstResponse.markSent(request.relatedEventId, result.sentAt);
			}
			this.emit("delivery", {
				botId: this.botId,
				deliveryId: result.deliveryId,
				status: "sent",
				targetId: request.targetId,
				timestamp: result.sentAt,
				result,
			});
			return result;
		} catch (error) {
			this.#metrics.recordFailed();
			if (isThrottleError(error)) this.#limiter.penalize();
			this.emit("delivery", {
				botId: this.botId,
				deliveryId: request.deliveryId as string,
				status: "failed",
				targetId: request.targetId,
				timestamp: Date.now(),
				error: sanitizeError(error),
			});
			throw error;
		}
	}

	#transition(state: BotState): void {
		this.#state = state;
		void this.snapshot().then((snapshot) => this.emit("status", snapshot));
	}
}

function defaultRateLimit(kind: "official" | "linejs") {
	if (kind === "official") return { messagesPerSecond: 10, burst: 10 };
	return { messagesPerSecond: 1, burst: 3 };
}

function validateSendRequest(request: SendTextRequest): void {
	if (!request.targetId?.trim()) throw new TypeError("targetId is required");
	if (!request.text?.trim()) throw new TypeError("text is required");
	if (request.text.length > 5000) throw new RangeError("text exceeds 5000 characters");
}

function validateInboundEvent(event: NormalizedInboundEvent, expectedSource: string): void {
	if (!event.eventId || !event.targetId || !event.senderId) {
		throw new TypeError("Inbound event requires eventId, targetId and senderId");
	}
	if (event.source !== expectedSource) {
		throw new TypeError(`Inbound event source must be '${expectedSource}'`);
	}
}

function isThrottleError(error: unknown): boolean {
	return Boolean(error && typeof error === "object" && "status" in error && error.status === 429);
}

function isAuthenticationError(error: unknown): boolean {
	return /auth|token|login|credential|pin|qr/i.test(sanitizeError(error));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(message)), ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
