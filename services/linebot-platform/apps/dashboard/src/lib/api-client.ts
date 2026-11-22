import type {
	ApiEnvelope,
	ApiKeyRecord,
	BotSummary,
	ControlCommand,
	CreateBotInput,
	CreatePromptPayPaymentInput,
	CreatedApiKey,
	DashboardData,
	QrAuthSession,
	PromptPayPayment,
	Rule,
	SecurityStatus,
	SenderRole,
	SpeedProfile,
	SystemResources,
	SystemSettings,
} from "../types";

const DEFAULT_TIMEOUT_MS = 12_000;
// Target discovery fans out to LINE's own servers per joined chat (roster
// fetch for every OpenChat), so it legitimately runs longer than a normal
// control call -- give it its own budget instead of racing the default.
const DISCOVER_TARGETS_TIMEOUT_MS = 45_000;

export type ApiMode = "live";

export interface CreateTargetInput {
	externalId: string;
	type: "group" | "openchat" | "room" | "user";
	name: string;
	consentConfirmed: boolean;
}

export interface AuthStatus {
	email: string;
	role: "admin";
	/** True when REQUIRE_AUTH is off server-side -- the API enforces nothing and the dashboard skips login entirely. */
	localMode: boolean;
	authenticated: boolean;
}

export interface AuthEventPayload {
	botId: string;
	type: "qr" | "pin" | "authenticated" | "auth-error";
	value?: string;
	timestamp: number;
}

export interface DashboardApi {
	readonly mode: ApiMode;
	getAuthStatus(): Promise<AuthStatus>;
	login(email: string, password: string): Promise<void>;
	logout(): Promise<void>;
	getSnapshot(): Promise<DashboardData>;
	createBot(input: CreateBotInput): Promise<BotSummary>;
	deleteBot(botId: string): Promise<void>;
	beginQrAuth(botId: string): Promise<QrAuthSession>;
	getLatestAuthEvent(botId: string): Promise<AuthEventPayload | null>;
	/** Warms the bot worker so a following QR request skips process startup. */
	prewarmQrAuth(botId: string): Promise<void>;
	controlBot(botId: string, command: ControlCommand, stopMode?: "graceful" | "immediate"): Promise<void>;
	discoverTargets(botId: string): Promise<void>;
	createTarget(botId: string, input: CreateTargetInput): Promise<void>;
	setTargetAllowed(botId: string, targetId: string, allowed: boolean): Promise<void>;
	setSenderRole(botId: string, senderId: string, role: SenderRole): Promise<void>;
	upsertRule(botId: string, rule: Rule): Promise<Rule>;
	deleteRule(botId: string, ruleId: string): Promise<void>;
	queueAction(botId: string, action: "call_next" | "cancel", ticketId?: string): Promise<void>;
	createApiKey(name: string, scopes: string[]): Promise<CreatedApiKey>;
	revokeApiKey(keyId: string): Promise<void>;
	setApiKeyPaused(keyId: string, paused: boolean): Promise<ApiKeyRecord>;
	emergencyStop(): Promise<void>;
	getSettings(): Promise<SystemSettings>;
	updateSettings(patch: Partial<Omit<SystemSettings, "updatedAt">>): Promise<SystemSettings>;
	getSecurityStatus(): Promise<SecurityStatus>;
	getSystemResources(): Promise<SystemResources>;
	listPromptPayPayments(botId?: string): Promise<PromptPayPayment[]>;
	createPromptPayPayment(input: CreatePromptPayPaymentInput): Promise<PromptPayPayment>;
	getPromptPayPayment(paymentId: string): Promise<PromptPayPayment>;
	cancelPromptPayPayment(paymentId: string): Promise<PromptPayPayment>;
	deletePromptPayPayment(paymentId: string): Promise<void>;
	/** Round-trips /health/live, which is unauthenticated and outside /v1 (no ApiEnvelope), to confirm the configured API base URL is actually reachable. */
	testConnection(): Promise<{ ok: boolean; latencyMs: number }>;
}

export class ApiClientError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly requestId?: string,
		readonly code = "API_ERROR",
	) {
		super(message);
		this.name = "ApiClientError";
	}
}

class LiveDashboardApi implements DashboardApi {
	readonly mode = "live" as const;

	constructor(private readonly baseUrl: string) {}

	getAuthStatus(): Promise<AuthStatus> {
		return this.request<AuthStatus>("/v1/auth/me");
	}

	async login(email: string, password: string): Promise<void> {
		await this.request("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
	}

	async logout(): Promise<void> {
		await this.request("/v1/auth/logout", { method: "POST" });
	}

	getSnapshot(): Promise<DashboardData> {
		return this.request<DashboardData>("/v1/dashboard/overview");
	}

	createBot(input: CreateBotInput): Promise<BotSummary> {
		return this.request<BotSummary>("/v1/bots", { method: "POST", body: JSON.stringify(input) });
	}

	async deleteBot(botId: string): Promise<void> {
		await this.request(`/v1/bots/${encodeURIComponent(botId)}`, { method: "DELETE" });
	}

	beginQrAuth(botId: string): Promise<QrAuthSession> {
		return this.request<QrAuthSession>(`/v1/bots/${encodeURIComponent(botId)}/auth/qr`, { method: "POST" });
	}

	getLatestAuthEvent(botId: string): Promise<AuthEventPayload | null> {
		return this.request<AuthEventPayload | null>(`/v1/bots/${encodeURIComponent(botId)}/auth/latest`);
	}

	async prewarmQrAuth(botId: string): Promise<void> {
		await this.request(`/v1/bots/${encodeURIComponent(botId)}/auth/qr/prewarm`, { method: "POST" });
	}

	async controlBot(botId: string, command: ControlCommand, stopMode = "graceful" as const): Promise<void> {
		await this.request(`/v1/bots/${encodeURIComponent(botId)}/control`, {
			method: "POST",
			body: JSON.stringify({ action: command, mode: command === "stop" ? stopMode : undefined }),
			headers: { "Idempotency-Key": crypto.randomUUID() },
		});
	}

	async discoverTargets(botId: string): Promise<void> {
		await this.request(`/v1/bots/${encodeURIComponent(botId)}/targets/discover`, { method: "POST" }, DISCOVER_TARGETS_TIMEOUT_MS);
	}

	async createTarget(botId: string, input: CreateTargetInput): Promise<void> {
		await this.request(`/v1/bots/${encodeURIComponent(botId)}/targets`, {
			method: "POST",
			body: JSON.stringify(input),
			headers: { "Idempotency-Key": crypto.randomUUID() },
		});
	}

	async setTargetAllowed(botId: string, targetId: string, allowed: boolean): Promise<void> {
		await this.request(`/v1/bots/${encodeURIComponent(botId)}/targets/${encodeURIComponent(targetId)}`, {
			method: "PATCH",
			body: JSON.stringify({ allowed }),
			headers: { "Idempotency-Key": crypto.randomUUID() },
		});
	}

	async setSenderRole(botId: string, senderId: string, role: SenderRole): Promise<void> {
		await this.request(`/v1/bots/${encodeURIComponent(botId)}/senders/${encodeURIComponent(senderId)}`, {
			method: "PATCH",
			body: JSON.stringify({ role }),
			headers: { "Idempotency-Key": crypto.randomUUID() },
		});
	}

	upsertRule(botId: string, rule: Rule): Promise<Rule> {
		const existing = !rule.id.startsWith("draft_");
		const path = existing
			? `/v1/bots/${encodeURIComponent(botId)}/rules/${encodeURIComponent(rule.id)}`
			: `/v1/bots/${encodeURIComponent(botId)}/rules`;
		return this.request<Rule>(path, {
			method: existing ? "PUT" : "POST",
			body: JSON.stringify(rule),
			headers: { "Idempotency-Key": crypto.randomUUID() },
		});
	}

	async deleteRule(botId: string, ruleId: string): Promise<void> {
		await this.request(`/v1/bots/${encodeURIComponent(botId)}/rules/${encodeURIComponent(ruleId)}`, {
			method: "DELETE",
			headers: { "Idempotency-Key": crypto.randomUUID() },
		});
	}

	async queueAction(botId: string, action: "call_next" | "cancel", ticketId?: string): Promise<void> {
		await this.request(`/v1/bots/${encodeURIComponent(botId)}/queues/actions`, {
			method: "POST",
			body: JSON.stringify({ action, ticketId }),
			headers: { "Idempotency-Key": crypto.randomUUID() },
		});
	}

	createApiKey(name: string, scopes: string[]): Promise<CreatedApiKey> {
		return this.request<CreatedApiKey>("/v1/api-keys", {
			method: "POST",
			body: JSON.stringify({ name, scopes }),
		});
	}

	async revokeApiKey(keyId: string): Promise<void> {
		await this.request(`/v1/api-keys/${encodeURIComponent(keyId)}`, { method: "DELETE" });
	}

	async setApiKeyPaused(keyId: string, paused: boolean): Promise<ApiKeyRecord> {
		return this.request<ApiKeyRecord>(`/v1/api-keys/${encodeURIComponent(keyId)}/control`, {
			method: "POST",
			body: JSON.stringify({ action: paused ? "pause" : "resume" }),
		});
	}

	async emergencyStop(): Promise<void> {
		await this.request("/v1/control/emergency-stop", {
			method: "POST",
			headers: { "Idempotency-Key": crypto.randomUUID() },
		});
	}

	getSettings(): Promise<SystemSettings> {
		return this.request<SystemSettings>("/v1/settings");
	}

	updateSettings(patch: Partial<Omit<SystemSettings, "updatedAt">>): Promise<SystemSettings> {
		return this.request<SystemSettings>("/v1/settings", { method: "PATCH", body: JSON.stringify(patch) });
	}

	getSecurityStatus(): Promise<SecurityStatus> {
		return this.request<SecurityStatus>("/v1/system/security");
	}

	getSystemResources(): Promise<SystemResources> {
		return this.request<SystemResources>("/v1/system/resources");
	}

	listPromptPayPayments(botId?: string): Promise<PromptPayPayment[]> {
		return this.request<PromptPayPayment[]>(`/v1/promptpay/payments${botId ? `?botId=${encodeURIComponent(botId)}` : ""}`);
	}

	createPromptPayPayment(input: CreatePromptPayPaymentInput): Promise<PromptPayPayment> {
		return this.request<PromptPayPayment>("/v1/promptpay/payments", { method: "POST", body: JSON.stringify(input) });
	}

	getPromptPayPayment(paymentId: string): Promise<PromptPayPayment> {
		return this.request<PromptPayPayment>(`/v1/promptpay/payments/${encodeURIComponent(paymentId)}`);
	}

	cancelPromptPayPayment(paymentId: string): Promise<PromptPayPayment> {
		return this.request<PromptPayPayment>(`/v1/promptpay/payments/${encodeURIComponent(paymentId)}/cancel`, { method: "POST" });
	}

	async deletePromptPayPayment(paymentId: string): Promise<void> {
		await this.request(`/v1/promptpay/payments/${encodeURIComponent(paymentId)}`, { method: "DELETE" });
	}

	async testConnection(): Promise<{ ok: boolean; latencyMs: number }> {
		const startedAt = performance.now();
		const controller = new AbortController();
		const timeout = window.setTimeout(() => controller.abort(), 5_000);
		try {
			const response = await fetch(`${this.baseUrl}/health/live`, { signal: controller.signal });
			return { ok: response.ok, latencyMs: Math.round(performance.now() - startedAt) };
		} catch {
			return { ok: false, latencyMs: Math.round(performance.now() - startedAt) };
		} finally {
			window.clearTimeout(timeout);
		}
	}

	private async request<T = unknown>(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
		const controller = new AbortController();
		const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(`${this.baseUrl}${path}`, {
				...init,
				credentials: "include",
				signal: controller.signal,
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
					...init.headers,
				},
			});
			const payload = (await response.json().catch(() => undefined)) as ApiEnvelope<T> | undefined;
			if (!response.ok || payload?.error) {
				throw new ApiClientError(
					payload?.error?.message ?? `API ตอบกลับด้วยสถานะ ${response.status}`,
					response.status,
					payload?.requestId,
					payload?.error?.code,
				);
			}
			if (!payload || !("data" in payload)) {
				throw new ApiClientError("รูปแบบข้อมูลจาก API ไม่ถูกต้อง", response.status);
			}
			return payload.data;
		} catch (error) {
			if (error instanceof ApiClientError) throw error;
			if (error instanceof DOMException && error.name === "AbortError") {
				throw new ApiClientError("เชื่อมต่อ API เกินเวลาที่กำหนด", 408);
			}
			throw new ApiClientError("ไม่สามารถเชื่อมต่อ backend ได้", 0);
		} finally {
			window.clearTimeout(timeout);
		}
	}
}

export function createDashboardApi(): DashboardApi {
	const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
	return new LiveDashboardApi(baseUrl);
}

export const speedProfileLabels: Record<SpeedProfile, string> = {
	safe: "Safe · 25%",
	balanced: "Balanced · 60%",
	max_compliant: "Max compliant · 90%",
	extreme: "Extreme · 99%",
	custom: "Custom",
};

/**
 * Fastest sustained rate the send queue's rate limiter will accept, mirrored
 * from `MAX_MESSAGES_PER_SECOND` in `@linebot/bot-worker`. Duplicated here
 * (rather than imported) because the dashboard is a browser bundle and that
 * package pulls in Node-only modules through its barrel export; keep the two
 * in sync if the backend limit ever changes.
 */
export const MAX_MESSAGES_PER_SECOND = 1000;

/** Shortest interval between messages the backend can actually honor. */
export const MIN_MESSAGE_INTERVAL_MS = 1000 / MAX_MESSAGES_PER_SECOND;
