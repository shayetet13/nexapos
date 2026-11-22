export type AdapterType = "official" | "linejs";
export type BotStatus =
	| "draft"
	| "auth_required"
	| "starting"
	| "online"
	| "degraded"
	| "paused"
	| "stopping"
	| "stopped"
	| "error";
export type SpeedProfile = "safe" | "balanced" | "max_compliant" | "extreme" | "custom";
export type TargetType = "group" | "openchat" | "room" | "user";

export interface BotRecord {
	id: string;
	name: string;
	description: string;
	adapter: AdapterType;
	status: BotStatus;
	desiredStatus: BotStatus;
	enabled: boolean;
	speedProfile: SpeedProfile;
	maxMessagesPerSecond: number;
	burst: number;
	timezone: string;
	riskAcknowledgedAt: string | null;
	createdAt: string;
	updatedAt: string;
	lastHeartbeatAt: string | null;
}

export type SenderRole = "member" | "admin";

export interface SenderRecord {
	id: string;
	botId: string;
	role: SenderRole;
	firstSeenAt: string;
	lastSeenAt: string;
	messageCount: number;
}

export interface TargetRecord {
	id: string;
	botId: string;
	externalId: string;
	type: TargetType;
	name: string;
	enabled: boolean;
	consentConfirmedAt: string | null;
	createdAt: string;
	memberCount?: number;
}

export type TriggerType = "message_received" | "member_joined" | "schedule" | "external_event" | "queue_state_changed";
export type ConditionType = "target" | "text" | "message_match" | "user" | "sender_role" | "time_window" | "cooldown" | "queue_state";
export type ActionType = "send_text" | "reply_text" | "queue_join" | "queue_status" | "queue_cancel" | "queue_next" | "queue_call_next" | "set_variable" | "webhook" | "delay" | "stop_processing";

export interface RuleRecord {
	id: string;
	botId: string;
	name: string;
	description: string;
	enabled: boolean;
	priority: number;
	trigger: { type: TriggerType; config: Record<string, unknown> };
	conditions: Array<{ id: string; type: ConditionType; config: Record<string, unknown> }>;
	actions: Array<{ id: string; type: ActionType; config: Record<string, unknown> }>;
	stopProcessing: boolean;
	version: number;
	createdAt: string;
	updatedAt: string;
}

export interface BotMetrics {
	botId: string;
	status: BotStatus;
	uptimeSeconds: number;
	queueDepth: number;
	messagesReceived: number;
	messagesSent: number;
	messagesFailed: number;
	messagesPerSecond: number;
	successRate: number;
	firstResponseWins: number;
	firstResponseLosses: number;
	firstResponseUnknown: number;
	firstResponseRate: number;
	latencyP50Ms: number;
	latencyP95Ms: number;
	latencyP99Ms: number;
	cpuPercent: number;
	memoryMb: number;
	rateUtilization: number;
	loadLevel: "low" | "medium" | "high";
	lastEventAt: string | null;
	lastSendAt: string | null;
	updatedAt: string;
}

export interface MetricPoint {
	botId: string;
	timestamp: string;
	latencyMs: number;
	messagesPerSecond: number;
	successRate: number;
	queueDepth: number;
}

export interface QueueTicket {
	id: string;
	botId: string;
	targetId: string;
	userId: string;
	displayName: string;
	number: number;
	status: "waiting" | "called" | "completed" | "cancelled" | "skipped";
	createdAt: string;
	calledAt: string | null;
	completedAt: string | null;
}

export interface DeliveryRecord {
	id: string;
	botId: string;
	targetId: string;
	text: string;
	status: "queued" | "sending" | "sent" | "failed" | "cancelled";
	priority: "reply" | "greeting" | "api" | "scheduled";
	createdAt: string;
	sentAt: string | null;
	error: string | null;
}

export interface ApiKeyRecord {
	id: string;
	name: string;
	prefix: string;
	/** SHA-256 of the full secret; the secret itself is shown once at creation and never stored. */
	secretHash: string;
	scopes: string[];
	createdAt: string;
	lastUsedAt: string | null;
	/** Temporary, reversible suspension -- distinct from revokedAt (permanent ban). */
	pausedAt: string | null;
	revokedAt: string | null;
}

export interface AuditRecord {
	id: string;
	action: string;
	botId: string | null;
	actor: string;
	details: Record<string, unknown>;
	createdAt: string;
}

export interface LiveEvent {
	id: string;
	type: string;
	botId?: string;
	payload: unknown;
	createdAt: string;
}

export type PromptPayIdType = "phone" | "national_id" | "ewallet";
export type PromptPayPaymentStatus = "queued" | "pending" | "succeeded" | "ambiguous" | "expired" | "cancelled";
export type PromptPayVerificationIssue = "empty_text" | "unsupported_bank_message" | "kbank_amount_hidden";

export interface PromptPayPayment {
	id: string;
	botId: string;
	sourceTargetId: string;
	promptPayIdType: PromptPayIdType;
	promptPayIdMasked: string;
	amountSatang: number;
	destinationLast4: string | null;
	qrPayload: string;
	status: PromptPayPaymentStatus;
	verificationMethod: "bank_line_oa_notification";
	/** Payment window length, applied from createdAt->expiresAt both when first granted and again when promoted out of the queue. */
	windowSeconds: number;
	/** Monotonic FIFO order for the (sourceTargetId, amountSatang) queue. createdAt alone can tie at millisecond resolution under a real burst, so ordering/tie-breaking always goes through this field instead. */
	queueSeq: number;
	createdAt: string;
	expiresAt: string;
	verifiedAt: string | null;
	bankAlertId: string | null;
	bank: BankCode | null;
	/** Display name of the allowlisted LINE OA that supplied the alert. */
	bankName: string | null;
	verificationIssue: PromptPayVerificationIssue | null;
	/** Copied from the matched BankAlertRecord once verified; null for kbank (its LINE OA card carries no payer identity). */
	payerName: string | null;
	/** Source account shown by the bank card, kept masked as supplied by the OA. */
	sourceAccount: string | null;
	/** Destination account shown by the bank card, kept masked as supplied by the OA. */
	destinationAccount: string | null;
	/** Transaction type such as "เงินโอนเข้า-พร้อมเพย์", when the OA supplies it. */
	transactionType: string | null;
	/** Balance shown by the bank card after the transaction, in satang. */
	availableBalanceSatang: number | null;
	/** The bank's own stated transaction time, copied from the matched BankAlertRecord once verified. */
	transactionAt: string | null;
}

/** Known presentation themes plus `other` for any newly allowlisted bank OA. */
export type BankCode = "kbank" | "ktb" | "scb" | "other";

export interface BankAlertRecord {
	id: string;
	botId: string;
	sourceTargetId: string;
	lineMessageId: string;
	bank: BankCode;
	bankName: string;
	amountSatang: number;
	destinationLast4: string | null;
	destinationAccount: string | null;
	sourceAccount: string | null;
	transactionType: string | null;
	availableBalanceSatang: number | null;
	transactionAt: string | null;
	/** Sender's name (ktb: "ผู้โอน") or full source-account line (scb: "จากบัญชี"); null for kbank, whose card omits payer identity. */
	payerName: string | null;
	receivedAt: string;
	paymentId: string | null;
}

/**
 * Fleet-wide operational defaults, editable from the dashboard's Settings
 * page. `defaultSpeedProfile`/`defaultTimezone` seed the Create Bot form;
 * the two timeouts are applied to every bot's worker config directly (they
 * are not stored per-bot).
 */
export interface SystemSettings {
	defaultSpeedProfile: SpeedProfile;
	defaultTimezone: string;
	gracefulDrainTimeoutMs: number;
	firstResponseWindowMs: number;
	updatedAt: string;
}

export interface ApiEnvelope<T> {
	data: T | null;
	meta?: Record<string, unknown>;
	error: { code: string; message: string; details?: unknown } | null;
	requestId: string;
}
