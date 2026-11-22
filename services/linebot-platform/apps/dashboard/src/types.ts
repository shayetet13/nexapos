export type AdapterType = "official" | "linejs";
export type BotStatus =
	| "online"
	| "starting"
	| "paused"
	| "stopping"
	| "stopped"
	| "degraded"
	| "error"
	| "auth_required";
export type SpeedProfile = "safe" | "balanced" | "max_compliant" | "extreme" | "custom";
export type PageId = "overview" | "bots" | "rules" | "queue" | "payments" | "api-keys" | "settings";

export interface BotSummary {
	id: string;
	name: string;
	description: string;
	adapter: AdapterType;
	status: BotStatus;
	accent: string;
	connectedTargets: number;
	allowedTargets: number;
	throughputPerMinute: number;
	queueDepth: number;
	responseP95Ms: number;
	firstResponseRate: number;
	cpuPercent: number;
	memoryMb: number;
	uptimeSeconds: number;
	lastHeartbeat: string;
	speedProfile: SpeedProfile;
	autoRestart: boolean;
	createdAt: string;
	credentialsConfigured: boolean;
}

export interface MetricPoint {
	timestamp: string;
	messages: number;
	latencyMs: number;
}

export interface BotMetricSeries {
	botId: string;
	points: MetricPoint[];
}

export interface Target {
	id: string;
	botId: string;
	name: string;
	type: "group" | "openchat" | "room" | "user";
	memberCount: number;
	allowed: boolean;
	connection: "healthy" | "slow" | "offline";
	lastEventAt: string;
}

export type SenderRole = "member" | "admin";

export interface Sender {
	id: string;
	botId: string;
	role: SenderRole;
	firstSeenAt: string;
	lastSeenAt: string;
	messageCount: number;
}

export type TriggerType =
	| "message_received"
	| "member_joined"
	| "schedule"
	| "external_event"
	| "queue_state_changed";

export type ConditionType =
	| "target"
	| "message_match"
	| "sender_role"
	| "time_window"
	| "cooldown"
	| "queue_state";

export type ActionType =
	| "reply_text"
	| "send_text"
	| "queue_join"
	| "queue_status"
	| "queue_cancel"
	| "queue_next"
	| "set_variable"
	| "webhook"
	| "delay"
	| "stop_processing";

export interface RuleNode<TType extends string> {
	id: string;
	type: TType;
	config: Record<string, string | number | boolean>;
}

export interface Rule {
	id: string;
	botId: string;
	name: string;
	description: string;
	enabled: boolean;
	priority: number;
	trigger: RuleNode<TriggerType>;
	conditions: Array<RuleNode<ConditionType>>;
	actions: Array<RuleNode<ActionType>>;
	stopProcessing: boolean;
	version: number;
	lastTriggeredAt?: string;
	triggerCount: number;
}

export type QueueTicketStatus = "waiting" | "called" | "serving" | "cancelled";

export interface QueueTicket {
	id: string;
	botId: string;
	targetId: string;
	queueNumber: number;
	displayName: string;
	status: QueueTicketStatus;
	joinedAt: string;
	waitMinutes: number;
}

export interface ApiKeyRecord {
	id: string;
	name: string;
	prefix: string;
	scopes: string[];
	createdAt: string;
	lastUsedAt?: string;
	expiresAt?: string;
	pausedAt: string | null;
	revokedAt: string | null;
}

export interface AuditEntry {
	id: string;
	botId?: string;
	type: "control" | "rule" | "delivery" | "security";
	message: string;
	actor: string;
	createdAt: string;
}

export interface DashboardData {
	bots: BotSummary[];
	metricSeries: BotMetricSeries[];
	targets: Target[];
	senders: Sender[];
	rules: Rule[];
	queueTickets: QueueTicket[];
	apiKeys: ApiKeyRecord[];
	audit: AuditEntry[];
}

export interface CreateBotInput {
	name: string;
	description: string;
	adapter: AdapterType;
	speedProfile: SpeedProfile;
	maxMessagesPerSecond?: number;
	burst?: number;
	timezone?: string;
	credentials?: {
		channelSecret?: string;
		channelAccessToken?: string;
	};
	riskAcknowledged?: boolean;
}

/** Fleet-wide operational defaults, editable from the Settings page. */
export interface SystemSettings {
	defaultSpeedProfile: SpeedProfile;
	defaultTimezone: string;
	gracefulDrainTimeoutMs: number;
	firstResponseWindowMs: number;
	updatedAt: string;
}

export interface SecurityCheck {
	id: string;
	label: string;
	ok: boolean;
}

export interface SecurityStatus {
	score: number;
	checks: SecurityCheck[];
}

export interface SystemResources {
	storage: { path: string; sizeBytes: number; persistent: boolean };
	totalQueueDepth: number;
	totalBots: number;
	activeBots: number;
}

export type ControlCommand = "start" | "pause" | "resume" | "stop";

export interface ApiEnvelope<T> {
	data: T;
	meta?: Record<string, unknown>;
	error?: {
		code: string;
		message: string;
		details?: unknown;
	};
	requestId: string;
}

export interface CreatedApiKey {
	record: ApiKeyRecord;
	secret: string;
}

export interface QrAuthSession {
	sessionId: string;
	status: "pending" | "pin_required" | "authenticated" | "expired";
	qrUrl?: string | null;
	pin?: string;
	expiresInSeconds: number;
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
	windowSeconds: number;
	queueSeq: number;
	createdAt: string;
	expiresAt: string;
	verifiedAt: string | null;
	bankAlertId: string | null;
	bank: "kbank" | "ktb" | "scb" | null;
	verificationIssue: PromptPayVerificationIssue | null;
	payerName: string | null;
	transactionAt: string | null;
}

export interface CreatePromptPayPaymentInput {
	botId: string;
	sourceTargetId: string;
	promptPayIdType: PromptPayIdType;
	promptPayId: string;
	amount: string;
	destinationLast4?: string;
	expiresInSeconds: number;
}
