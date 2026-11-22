export const BOT_STATES = [
	"starting",
	"online",
	"paused",
	"stopping",
	"stopped",
	"degraded",
	"error",
	"auth-required",
] as const;

export type BotState = (typeof BOT_STATES)[number];
export type AdapterKind = "official" | "linejs";
export type TargetKind = "user" | "group" | "room" | "openchat";
export type DeliveryPriority = "reply" | "join" | "api" | "scheduled";

export const DELIVERY_PRIORITY: Readonly<Record<DeliveryPriority, number>> = {
	reply: 0,
	join: 1,
	api: 2,
	scheduled: 3,
};

export interface BotTarget {
	id: string;
	kind: TargetKind;
	name?: string;
	memberCount?: number;
}

export interface NormalizedInboundEvent {
	eventId: string;
	targetId: string;
	targetKind: TargetKind;
	senderId: string;
	text: string;
	timestamp: number;
	source: AdapterKind;
	isBot?: boolean;
	replyToken?: string;
	rawType?: string;
}

export interface SendTextRequest {
	deliveryId?: string;
	targetId: string;
	targetKind?: TargetKind;
	text: string;
	priority?: DeliveryPriority;
	relatedEventId?: string;
	relatedMessageId?: string;
	replyToken?: string;
	metadata?: Readonly<Record<string, string>>;
}

export interface SendTextResult {
	deliveryId: string;
	providerMessageId?: string;
	sentAt: number;
	targetId: string;
}

export interface AdapterCapabilities {
	inboundEvents: boolean;
	listTargets: boolean;
	openChat: boolean;
	reply: boolean;
}

export interface AdapterHealth {
	connected: boolean;
	detail?: string;
	checkedAt: number;
}

export interface AdapterAuthEvent {
	type: "qr" | "pin" | "authenticated" | "auth-error";
	value?: string;
	/** Present only after QR authentication; consumers must encrypt it at rest. */
	authToken?: string;
	timestamp: number;
}

export type AdapterEventListener = (
	event: NormalizedInboundEvent,
) => void | Promise<void>;

export interface BotAdapter {
	readonly kind: AdapterKind;
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	sendText(
		request: SendTextRequest,
		signal?: AbortSignal,
	): Promise<SendTextResult>;
	listTargets(): Promise<BotTarget[]>;
	subscribeEvents(listener: AdapterEventListener): () => void;
	health(): Promise<AdapterHealth>;
	capabilities(): AdapterCapabilities;
	subscribeAuthEvents?(listener: (event: AdapterAuthEvent) => void): () => void;
	/**
	 * Temporarily polls a trusted direct chat so a dropped push stream cannot
	 * lose a time-sensitive bank notification.
	 */
	watchTarget?(targetId: string, durationMs: number): Promise<void> | void;
	/** Used by a webhook bridge or the local simulator. */
	ingestEvent?(event: NormalizedInboundEvent): Promise<void> | void;
}

export interface OfficialLineAdapterConfig {
	kind: "official";
	channelAccessToken: string;
	apiBaseUrl?: string;
	targets?: BotTarget[];
}

export interface LineJsAdapterConfig {
	kind: "linejs";
	loginMode?: "token" | "qr";
	authToken?: string;
	device?:
		| "DESKTOPWIN"
		| "DESKTOPMAC"
		| "ANDROID"
		| "ANDROIDSECONDARY"
		| "IOS"
		| "IOSIPAD";
	version?: string;
	endpoint?: string;
	moduleSpecifier?: string;
	enableTalk?: boolean;
	enableSquare?: boolean;
	preferCompactMessages?: boolean;
	/** Internal/testing override; normal payment watches use five seconds. */
	historyPollIntervalMs?: number;
}

export type AdapterConfig =
	| OfficialLineAdapterConfig
	| LineJsAdapterConfig;

export interface RateLimitConfig {
	messagesPerSecond: number;
	burst: number;
}

export interface BotConfig {
	botId: string;
	adapter: AdapterConfig;
	rateLimit?: RateLimitConfig;
	queueLimit?: number;
	heartbeatIntervalMs?: number;
	firstResponseWindowMs?: number;
	gracefulStopTimeoutMs?: number;
}

export interface FirstResponseMetrics {
	wins: number;
	losses: number;
	unknown: number;
	pending: number;
	winRate: number | null;
	averageLatencyMs: number | null;
	p95LatencyMs: number | null;
}

export interface BotMetricsSnapshot {
	received: number;
	enqueued: number;
	sent: number;
	failed: number;
	dropped: number;
	queueDepth: number;
	receivedPerMinute: number;
	sentPerMinute: number;
	averageSendLatencyMs: number | null;
	p95SendLatencyMs: number | null;
	rateLimitPerSecond: number;
	firstResponse: FirstResponseMetrics;
	process: {
		pid: number;
		rssBytes: number;
		heapUsedBytes: number;
		cpuUserMicros: number;
		cpuSystemMicros: number;
	};
}

export interface BotSnapshot {
	botId: string;
	adapterKind: AdapterKind;
	state: BotState;
	startedAt: number | null;
	lastHeartbeatAt: number;
	lastError?: string;
	adapterHealth: AdapterHealth;
	metrics: BotMetricsSnapshot;
}

export interface DeliveryEvent {
	botId: string;
	deliveryId: string;
	status: "sent" | "failed" | "dropped";
	targetId: string;
	timestamp: number;
	result?: SendTextResult;
	error?: string;
}

export interface BotInboundEvent extends NormalizedInboundEvent {
	botId: string;
}

/**
 * Hard ceiling on sustained send rate, shared with every layer that has to
 * agree on it (the API's request schema, the dashboard's client-side
 * validation, and this runtime check). Keeping a single source of truth here
 * is what stops the API from ever accepting a value the worker will then
 * reject at bootstrap.
 */
export const MAX_MESSAGES_PER_SECOND = 1000;

/** Fastest interval between messages the rate limiter can honor. */
export const MIN_MESSAGE_INTERVAL_MS = 1000 / MAX_MESSAGES_PER_SECOND;

export function validateBotConfig(config: BotConfig): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(config.botId)) {
		throw new TypeError(
			"botId must be 1-64 characters using letters, digits, '_' or '-'",
		);
	}
	if (config.rateLimit) {
		if (
			!Number.isFinite(config.rateLimit.messagesPerSecond) ||
			config.rateLimit.messagesPerSecond <= 0 ||
			config.rateLimit.messagesPerSecond > MAX_MESSAGES_PER_SECOND
		) {
			throw new RangeError(`messagesPerSecond must be between 0 and ${MAX_MESSAGES_PER_SECOND}`);
		}
		if (
			!Number.isInteger(config.rateLimit.burst) ||
			config.rateLimit.burst < 1 ||
			config.rateLimit.burst > 1000
		) {
			throw new RangeError("burst must be an integer between 1 and 1000");
		}
	}
	if (config.queueLimit !== undefined && (!Number.isInteger(config.queueLimit) || config.queueLimit < 1)) {
		throw new RangeError("queueLimit must be a positive integer");
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

export function sanitizeError(error: unknown): string {
	if (error instanceof Error) return error.message.slice(0, 500);
	return String(error).slice(0, 500);
}
