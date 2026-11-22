import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { MAX_MESSAGES_PER_SECOND, MIN_MESSAGE_INTERVAL_MS } from "@linebot/bot-worker";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { AutomationService } from "./automation.js";
import { BotControl } from "./bot-control.js";
import { PromptPayService } from "./promptpay.js";
import { MemoryStore } from "./store.js";
import { SecretVault } from "./secret-vault.js";
import type { ApiEnvelope, ApiKeyRecord, LiveEvent, MetricPoint, TargetRecord } from "./types.js";

type Variables = { requestId: string };

const SESSION_COOKIE = "lb_session";
/**
 * Length of an admin session. Long enough that a single operator working a
 * shift isn't asked to re-login mid-task; short enough that a leaked cookie
 * doesn't grant standing access. Not a public multi-tenant service, so there
 * is no refresh-token dance here -- expiry just means "log in again".
 */
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function jwtSecretBytes(): Uint8Array {
	return new TextEncoder().encode(process.env.JWT_SECRET ?? "local-development-secret-change-me");
}

/**
 * Explicit allowlist of the only routes an API key can reach, each mapped to
 * the single scope that grants it. Centralized here (rather than middleware
 * sprinkled per-route) so the full external-facing surface is auditable in
 * one place. Anything not listed is default-deny for API keys -- only the
 * admin session cookie can reach it.
 */
const API_KEY_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp; scope: string }> = [
	{ method: "GET", pattern: /^\/v1\/bots$/, scope: "bots:read" },
	{ method: "GET", pattern: /^\/v1\/bots\/[^/]+$/, scope: "bots:read" },
	{ method: "GET", pattern: /^\/v1\/bots\/[^/]+\/status$/, scope: "bots:read" },
	{ method: "GET", pattern: /^\/v1\/bots\/[^/]+\/targets$/, scope: "bots:read" },
	{ method: "GET", pattern: /^\/v1\/bots\/[^/]+\/senders$/, scope: "bots:read" },
	{ method: "POST", pattern: /^\/v1\/bots\/[^/]+\/messages$/, scope: "messages:send" },
	{ method: "POST", pattern: /^\/v1\/bots\/[^/]+\/events\/[^/]+$/, scope: "events:trigger" },
	{ method: "POST", pattern: /^\/v1\/bots\/[^/]+\/control$/, scope: "bots:control" },
	{ method: "POST", pattern: /^\/v1\/control\/emergency-stop$/, scope: "bots:control" },
	{ method: "GET", pattern: /^\/v1\/promptpay\/payments$/, scope: "promptpay:read" },
	{ method: "GET", pattern: /^\/v1\/promptpay\/payments\/[^/]+$/, scope: "promptpay:read" },
	{ method: "POST", pattern: /^\/v1\/promptpay\/payments$/, scope: "promptpay:write" },
	{ method: "POST", pattern: /^\/v1\/promptpay\/payments\/[^/]+\/cancel$/, scope: "promptpay:write" },
	{ method: "DELETE", pattern: /^\/v1\/promptpay\/payments\/[^/]+$/, scope: "promptpay:write" },
];

async function issueSession(c: Context, email: string): Promise<void> {
	const token = await new SignJWT({ role: "admin" })
		.setProtectedHeader({ alg: "HS256" })
		.setSubject(email)
		.setIssuedAt()
		.setExpirationTime(`${SESSION_TTL_SECONDS}s`)
		.sign(jwtSecretBytes());
	setCookie(c, SESSION_COOKIE, token, {
		httpOnly: true,
		// Railway gives the dashboard and API separate public origins. The
		// dashboard therefore needs a cross-site cookie in production for its
		// credentialed fetches to carry the admin session.
		sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
		secure: process.env.NODE_ENV === "production",
		path: "/",
		maxAge: SESSION_TTL_SECONDS,
	});
}

/**
 * How long a freshly issued login QR is advertised as valid.
 *
 * LINEJS's ForSecure login long-polls for `maxCount × intervalSec` (currently
 * 2 × 150s) before the session lapses, so the previous 120s figure made the
 * dashboard tear down and re-issue codes that were still perfectly scannable --
 * including, occasionally, one the operator was mid-way through scanning.
 * Kept safely under the real budget.
 */
const QR_LIFETIME_SECONDS = 240;

const botCreateSchema = z.object({
	name: z.string().trim().min(2).max(80),
	description: z.string().trim().max(500).default(""),
	adapter: z.enum(["official", "linejs"]),
	enabled: z.boolean().default(true),
	speedProfile: z.enum(["safe", "balanced", "max_compliant", "extreme", "custom"]).default("safe"),
	// Ceiling matches the runtime's own limit (see MAX_MESSAGES_PER_SECOND) so a
	// value that passes this check can never fail later when the worker
	// bootstraps -- the two used to disagree (2000 here vs. 1000 at runtime),
	// letting a bot pass creation and then fail to start with a RangeError.
	maxMessagesPerSecond: z.number().positive().max(MAX_MESSAGES_PER_SECOND, {
		message: `ตั้งค่าได้สูงสุด ${MAX_MESSAGES_PER_SECOND} ข้อความ/วินาที (เร็วที่สุดคือ ${MIN_MESSAGE_INTERVAL_MS} ms ต่อข้อความ)`,
	}).optional(),
	burst: z.number().int().positive().max(100).optional(),
	timezone: z.string().min(1).default("Asia/Bangkok"),
	riskAcknowledged: z.boolean().default(false),
	credentials: z.object({
		channelAccessToken: z.string().min(20).optional(),
		channelSecret: z.string().min(8).optional(),
		authToken: z.string().min(20).optional(),
	}).optional(),
});

const botPatchSchema = botCreateSchema.partial().omit({ adapter: true, riskAcknowledged: true, credentials: true });

const targetSchema = z.object({
	id: z.string().optional(),
	externalId: z.string().trim().min(1).max(200),
	type: z.enum(["group", "openchat", "room", "user"]),
	name: z.string().trim().min(1).max(120),
	enabled: z.boolean().default(true),
	allowed: z.boolean().optional(),
	consentConfirmed: z.boolean().default(false),
});

const conditionSchema = z.object({
	id: z.string().default(() => crypto.randomUUID()),
	type: z.enum(["target", "text", "message_match", "user", "sender_role", "time_window", "cooldown", "queue_state"]),
	config: z.record(z.string(), z.unknown()).default({}),
});

const actionSchema = z.object({
	id: z.string().default(() => crypto.randomUUID()),
	type: z.enum(["send_text", "reply_text", "queue_join", "queue_status", "queue_cancel", "queue_next", "queue_call_next", "set_variable", "webhook", "delay", "stop_processing"]),
	config: z.record(z.string(), z.unknown()).default({}),
});

const ruleSchema = z.object({
	id: z.string().optional(),
	name: z.string().trim().min(2).max(100),
	description: z.string().trim().max(500).default(""),
	enabled: z.boolean().default(true),
	priority: z.number().int().min(-10_000).max(10_000).default(0),
	trigger: z.object({
		type: z.enum(["message_received", "member_joined", "schedule", "external_event", "queue_state_changed"]),
		config: z.record(z.string(), z.unknown()).default({}),
	}),
	conditions: z.array(conditionSchema).max(30).default([]),
	actions: z.array(actionSchema).min(1).max(30),
	stopProcessing: z.boolean().default(true),
});

const settingsPatchSchema = z.object({
	defaultSpeedProfile: z.enum(["safe", "balanced", "max_compliant", "extreme", "custom"]).optional(),
	defaultTimezone: z.string().min(1).optional(),
	gracefulDrainTimeoutMs: z.number().int().min(1_000).max(120_000).optional(),
	firstResponseWindowMs: z.number().int().min(1_000).max(60_000).optional(),
});

const controlSchema = z.object({
	action: z.enum(["start", "pause", "resume", "stop"]).optional(),
	command: z.enum(["start", "pause", "resume", "stop"]).optional(),
	mode: z.enum(["graceful", "immediate"]).default("graceful"),
}).refine((value) => Boolean(value.action ?? value.command), { message: "action is required" }).transform((value) => ({ action: value.action ?? value.command!, mode: value.mode }));

const messageSchema = z.object({
	targetId: z.string().min(1),
	text: z.string().min(1).max(5_000),
	priority: z.enum(["reply", "greeting", "api", "scheduled"]).default("api"),
});

const promptPayPaymentSchema = z.object({
	botId: z.string().min(1),
	sourceTargetId: z.string().min(1),
	promptPayIdType: z.enum(["phone", "national_id", "ewallet"]),
	promptPayId: z.string().trim().min(10).max(30),
	amount: z.string().trim().regex(/^\d{1,9}(?:\.\d{1,2})?$/),
	destinationLast4: z.string().trim().regex(/^\d{4}$/).optional(),
	expiresInSeconds: z.number().int().min(30).max(600).default(120),
});

function fixedTimeEquals(a: string, b: string): boolean {
	const left = createHash("sha256").update(a).digest();
	const right = createHash("sha256").update(b).digest();
	return timingSafeEqual(left, right);
}

/** Strips secretHash before a key ever reaches a response -- only the one-time creation response carries the plaintext secret. */
function publicApiKey(key: ApiKeyRecord) {
	const { secretHash: _secretHash, ...rest } = key;
	return rest;
}

async function readJson(c: Context): Promise<unknown> {
	try {
		return await c.req.json();
	} catch {
		return {};
	}
}

export interface AppOptions {
	store?: MemoryStore;
	vault?: SecretVault;
	control?: BotControl;
	automation?: AutomationService;
	promptPay?: PromptPayService;
}

export function createApp(options: AppOptions = {}) {
	const store = options.store ?? new MemoryStore();
	const vault = options.vault ?? new SecretVault();
	const control = options.control ?? new BotControl(store, vault);
	if (!options.control) {
		void control.reconcileOnStartup().catch((cause) => {
			store.addAudit("bot.reconcile_failed", null, { message: cause instanceof Error ? cause.message : String(cause) });
		});
	}
	const automation = options.automation ?? new AutomationService(store, control);
	const promptPay = options.promptPay ?? new PromptPayService(store);
	control.on("inbound", (event) => {
		promptPay.handleInbound(event);
		void automation.handleInbound(event).catch((cause) => {
			store.addAudit("rule.event_failed", event.botId, {
				eventId: event.eventId,
				message: cause instanceof Error ? cause.message : String(cause),
			});
		});
	});
	const app = new Hono<{ Variables: Variables }>();

	app.use("*", async (c, next) => {
		const requestId = c.req.header("x-request-id")?.slice(0, 128) || crypto.randomUUID();
		c.set("requestId", requestId);
		c.header("x-request-id", requestId);
		await next();
	});
	app.use("*", secureHeaders());
	app.use("*", cors({
		origin: process.env.DASHBOARD_ORIGIN ?? "http://localhost:5173",
		allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Request-ID"],
		allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
		credentials: true,
	}));
	app.use("/v1/*", bodyLimit({ maxSize: 1_000_000, onError: (c) => error(c, "PAYLOAD_TOO_LARGE", "Request body exceeds 1 MB", 413) }));

	// Gates every /v1 route behind either the admin session cookie (full access,
	// enforced only once REQUIRE_AUTH is on -- off by default for the pure
	// single-operator local case) or a scoped API key (always enforced against
	// API_KEY_ROUTES, regardless of REQUIRE_AUTH, since a key is inherently for
	// external/machine callers rather than the operator's own browser).
	const PUBLIC_AUTH_PATHS = new Set(["/v1/auth/login", "/v1/auth/me", "/v1/auth/logout"]);
	app.use("/v1/*", async (c, next) => {
		if (PUBLIC_AUTH_PATHS.has(c.req.path)) return next();
		const authHeader = c.req.header("authorization");
		if (authHeader?.startsWith("Bearer ")) {
			const key = store.authenticateApiKey(authHeader.slice(7).trim());
			if (!key) return error(c, "UNAUTHENTICATED", "Invalid or revoked API key", 401);
			const route = API_KEY_ROUTES.find((candidate) => candidate.method === c.req.method && candidate.pattern.test(c.req.path));
			if (!route) return error(c, "FORBIDDEN", "This endpoint is not available to API keys", 403);
			if (!key.scopes.includes(route.scope)) return error(c, "FORBIDDEN", `API key missing required scope: ${route.scope}`, 403);
			return next();
		}
		if (process.env.REQUIRE_AUTH !== "true") return next();
		const token = getCookie(c, SESSION_COOKIE);
		if (!token) return error(c, "UNAUTHENTICATED", "Login required", 401);
		try {
			await jwtVerify(token, jwtSecretBytes());
		} catch {
			return error(c, "UNAUTHENTICATED", "Session expired, please log in again", 401);
		}
		await next();
	});

	app.onError((cause, c) => {
		console.error(JSON.stringify({ level: "error", requestId: c.get("requestId"), message: cause.message, stack: cause.stack }));
		return error(c, "INTERNAL_ERROR", "Unexpected server error", 500);
	});

	app.notFound((c) => error(c, "NOT_FOUND", "Route not found", 404));

	app.get("/health/live", (c) => c.json({ status: "ok", service: "linebot-api", timestamp: new Date().toISOString() }));
	app.get("/health/ready", (c) => c.json({ status: "ready", persistence: "sqlite", timestamp: new Date().toISOString() }));

	app.post("/v1/auth/login", async (c) => {
		// Not `.email()`: the admin identity is a local login name, not a
		// deliverable address, and the documented default (admin@localhost) has
		// no TLD -- zod's email format would reject it and login could never
		// succeed with the project's own default credential.
		const parsed = z.object({ email: z.string().trim().min(3).max(254), password: z.string().min(1) }).safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		const email = process.env.ADMIN_EMAIL ?? "admin@localhost";
		const password = process.env.ADMIN_PASSWORD ?? "change-me-before-production";
		if (!fixedTimeEquals(parsed.data.email.toLowerCase(), email.toLowerCase()) || !fixedTimeEquals(parsed.data.password, password)) {
			return error(c, "INVALID_CREDENTIALS", "Invalid email or password", 401);
		}
		await issueSession(c, email);
		store.addAudit("auth.login", null, { email });
		return success(c, { expiresInSeconds: SESSION_TTL_SECONDS, admin: { email, role: "admin" } });
	});

	app.post("/v1/auth/logout", (c) => {
		deleteCookie(c, SESSION_COOKIE, {
			path: "/",
			sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
			secure: process.env.NODE_ENV === "production",
		});
		store.addAudit("auth.logout", null, {});
		return success(c, { loggedOut: true });
	});

	app.get("/v1/auth/me", async (c) => {
		const email = process.env.ADMIN_EMAIL ?? "admin@localhost";
		const localMode = process.env.REQUIRE_AUTH !== "true";
		if (localMode) return success(c, { email, role: "admin", localMode, authenticated: true });
		const token = getCookie(c, SESSION_COOKIE);
		if (!token) return success(c, { email, role: "admin", localMode, authenticated: false });
		try {
			await jwtVerify(token, jwtSecretBytes());
			return success(c, { email, role: "admin", localMode, authenticated: true });
		} catch {
			return success(c, { email, role: "admin", localMode, authenticated: false });
		}
	});

	app.get("/v1/dashboard/overview", (c) => {
		const rawBots = store.listBots();
		const metrics = [...store.metrics.values()];
		const summary = {
			totalBots: rawBots.length,
			onlineBots: rawBots.filter((bot) => bot.status === "online").length,
			pausedBots: rawBots.filter((bot) => bot.status === "paused").length,
			errorBots: rawBots.filter((bot) => bot.status === "error" || bot.status === "degraded").length,
			totalMessagesSent: metrics.reduce((sum, metric) => sum + metric.messagesSent, 0),
			averageFirstResponseRate: metrics.length ? Math.round(metrics.reduce((sum, metric) => sum + metric.firstResponseRate, 0) / metrics.length * 100) / 100 : 0,
		};
		const colors = ["#76f8a7", "#a58bff", "#63d8ff", "#ffbd66"];
		// Single pass over targets/metricSeries grouped by botId, instead of
		// re-scanning the full collection once per bot (was O(bots x targets) and
		// O(bots x metricSeries) below -- this endpoint is polled every 2s by
		// every open dashboard tab, so that cost was paid constantly).
		const targetsByBot = new Map<string, TargetRecord[]>();
		for (const target of store.targets.values()) {
			const bucket = targetsByBot.get(target.botId);
			if (bucket) bucket.push(target);
			else targetsByBot.set(target.botId, [target]);
		}
		const metricSeriesByBot = new Map<string, MetricPoint[]>();
		for (const point of store.metricSeries) {
			const bucket = metricSeriesByBot.get(point.botId);
			if (bucket) bucket.push(point);
			else metricSeriesByBot.set(point.botId, [point]);
		}
		const bots = rawBots.map((bot, index) => {
			const current = store.getMetrics(bot.id);
			const botTargets = targetsByBot.get(bot.id) ?? [];
			return {
				...bot,
				accent: colors[index % colors.length],
				connectedTargets: botTargets.length,
				allowedTargets: botTargets.filter((target) => target.enabled).length,
				throughputPerMinute: Math.round((current?.messagesPerSecond ?? 0) * 60 * 10) / 10,
				queueDepth: current?.queueDepth ?? 0,
				responseP95Ms: current?.latencyP95Ms ?? 0,
				firstResponseRate: current?.firstResponseRate ?? 0,
				cpuPercent: current?.cpuPercent ?? 0,
				memoryMb: current?.memoryMb ?? 0,
				uptimeSeconds: current?.uptimeSeconds ?? 0,
				lastHeartbeat: bot.lastHeartbeatAt ?? bot.updatedAt,
				autoRestart: true,
				credentialsConfigured: vault.status(bot.id).configured,
			};
		});
		const metricSeries = rawBots.map((bot) => ({
			botId: bot.id,
			points: (metricSeriesByBot.get(bot.id) ?? []).map((point) => ({
				timestamp: point.timestamp,
				messages: point.messagesPerSecond * 60,
				latencyMs: point.latencyMs,
			})),
		}));
		const targets = [...store.targets.values()].map((target) => ({
			...target,
			memberCount: target.memberCount ?? 0,
			allowed: target.enabled,
			connection: target.enabled ? "healthy" as const : "offline" as const,
			lastEventAt: store.getMetrics(target.botId)?.lastEventAt ?? target.createdAt,
		}));
		const senders = [...store.senders.values()];
		const rules = [...store.rules.values()].map((rule) => ({ ...rule, triggerCount: 0 }));
		const queueTickets = [...store.queueTickets.values()].map((ticket) => ({
			...ticket,
			queueNumber: ticket.number,
			joinedAt: ticket.createdAt,
			waitMinutes: Math.max(0, Math.floor((Date.now() - Date.parse(ticket.createdAt)) / 60_000)),
			status: ticket.status === "completed" || ticket.status === "skipped" ? "serving" : ticket.status,
		}));
		const audit = store.auditLog.slice(0, 100).map((entry) => ({
			id: entry.id,
			...(entry.botId ? { botId: entry.botId } : {}),
			type: entry.action.includes("rule") ? "rule" : entry.action.includes("delivery") || entry.action.includes("queue") ? "delivery" : entry.action.includes("auth") || entry.action.includes("api_key") || entry.action.includes("credentials") ? "security" : "control",
			message: entry.action.replaceAll("_", " "),
			actor: entry.actor,
			createdAt: entry.createdAt,
		}));
		return success(c, {
			summary,
			bots,
			metrics,
			metricSeries,
			metricsSeries: store.metricSeries.slice(-500),
			rules,
			targets,
			senders,
			queueTickets,
			deliveries: [...store.deliveries.values()].slice(-100),
			apiKeys: [...store.apiKeys.values()].map((key) => ({ ...publicApiKey(key), lastUsedAt: key.lastUsedAt ?? undefined })),
			audit,
		});
	});

	app.get("/v1/bots", (c) => success(c, store.listBots(), { total: store.bots.size }));
	app.post("/v1/bots", async (c) => {
		const parsed = botCreateSchema.safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		if (parsed.data.adapter === "linejs" && !parsed.data.riskAcknowledged) {
			return error(c, "RISK_ACKNOWLEDGEMENT_REQUIRED", "LINEJS SelfBot requires explicit risk acknowledgement", 422);
		}
		const bot = store.createBot({
			name: parsed.data.name,
			description: parsed.data.description,
			adapter: parsed.data.adapter,
			enabled: parsed.data.enabled,
			speedProfile: parsed.data.speedProfile,
			maxMessagesPerSecond: parsed.data.maxMessagesPerSecond ?? speedDefaults(parsed.data.adapter, parsed.data.speedProfile).messagesPerSecond,
			burst: parsed.data.burst ?? speedDefaults(parsed.data.adapter, parsed.data.speedProfile).burst,
			timezone: parsed.data.timezone,
			riskAcknowledgedAt: parsed.data.riskAcknowledged ? new Date().toISOString() : null,
		});
		if (bot.adapter === "official" && parsed.data.credentials?.channelAccessToken && parsed.data.credentials.channelSecret) {
			vault.set(bot.id, "official", {
				channelAccessToken: parsed.data.credentials.channelAccessToken,
				channelSecret: parsed.data.credentials.channelSecret,
			});
		}
		if (bot.adapter === "linejs" && parsed.data.credentials?.authToken) {
			vault.set(bot.id, "linejs", { authToken: parsed.data.credentials.authToken });
			store.setStatus(bot.id, "stopped");
		}
		if (bot.adapter === "official" && !vault.status(bot.id).configured) {
			store.setStatus(bot.id, "auth_required", "stopped");
		}
		const current = store.getMetrics(bot.id);
		return success(c, {
			...bot,
			accent: "#76f8a7",
			connectedTargets: 0,
			allowedTargets: 0,
			throughputPerMinute: 0,
			queueDepth: 0,
			responseP95Ms: 0,
			firstResponseRate: 0,
			cpuPercent: 0,
			memoryMb: 0,
			uptimeSeconds: current?.uptimeSeconds ?? 0,
			lastHeartbeat: bot.updatedAt,
			autoRestart: true,
			credentialsConfigured: vault.status(bot.id).configured,
		}, undefined, 201);
	});

	app.get("/v1/bots/:botId", (c) => {
		const bot = store.getBot(c.req.param("botId"));
		return bot ? success(c, bot) : error(c, "BOT_NOT_FOUND", "Bot not found", 404);
	});
	app.patch("/v1/bots/:botId", async (c) => {
		const parsed = botPatchSchema.safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		const bot = store.updateBot(c.req.param("botId"), parsed.data);
		return bot ? success(c, bot) : error(c, "BOT_NOT_FOUND", "Bot not found", 404);
	});
	app.delete("/v1/bots/:botId", (c) => {
		const id = c.req.param("botId");
		const bot = store.getBot(id);
		if (!bot) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		if (["online", "starting", "stopping"].includes(bot.status)) return error(c, "BOT_MUST_BE_STOPPED", "Stop the bot before deleting it", 409);
		store.deleteBot(id);
		vault.delete(id);
		return success(c, { id, deleted: true });
	});

	app.get("/v1/bots/:botId/credentials", (c) => {
		const bot = store.getBot(c.req.param("botId"));
		return bot ? success(c, vault.status(bot.id)) : error(c, "BOT_NOT_FOUND", "Bot not found", 404);
	});
	app.post("/v1/bots/:botId/credentials", async (c) => {
		const bot = store.getBot(c.req.param("botId"));
		if (!bot) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		const schema = bot.adapter === "official"
			? z.object({ channelAccessToken: z.string().min(20), channelSecret: z.string().min(8) })
			: z.object({ authToken: z.string().min(20) });
		const parsed = schema.safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		vault.set(bot.id, bot.adapter, parsed.data);
		store.addAudit("bot.credentials_updated", bot.id, { adapter: bot.adapter });
		if (bot.status === "auth_required") store.setStatus(bot.id, "stopped");
		return success(c, vault.status(bot.id));
	});
	app.delete("/v1/bots/:botId/credentials", (c) => {
		const bot = store.getBot(c.req.param("botId"));
		if (!bot) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		vault.delete(bot.id);
		store.setStatus(bot.id, "auth_required", "stopped");
		store.addAudit("bot.credentials_deleted", bot.id, { adapter: bot.adapter });
		return success(c, { configured: false });
	});

	app.get("/v1/bots/:botId/status", (c) => {
		const bot = store.getBot(c.req.param("botId"));
		if (!bot) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		return success(c, { botId: bot.id, status: bot.status, desiredStatus: bot.desiredStatus, lastHeartbeatAt: bot.lastHeartbeatAt, metrics: store.getMetrics(bot.id) });
	});
	app.get("/v1/bots/:botId/auth/latest", (c) => {
		const bot = store.getBot(c.req.param("botId"));
		if (!bot) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		return success(c, control.getLastAuthEvent(bot.id) ?? null);
	});
	app.post("/v1/bots/:botId/control", async (c) => {
		const id = c.req.param("botId");
		const bot = store.getBot(id);
		if (!bot) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		const parsed = controlSchema.safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		try {
			if (parsed.data.action === "start") {
				// A LINEJS bot can be missing its token in "auth_required" (never
				// connected), "stopped" (manually stopped) or "error" (a prior
				// connection attempt failed) -- not configured is the actual
				// signal, regardless of which of those states it's currently in.
				if (!vault.status(bot.id).configured) {
					return error(c, "BOT_AUTH_REQUIRED", "Complete bot authentication first", 409);
				}
				await control.start(id);
			} else if (parsed.data.action === "pause") {
				if (bot.status !== "online" && bot.status !== "degraded") return error(c, "INVALID_BOT_STATE", "Only an online bot can be paused", 409);
				await control.pause(id);
			} else if (parsed.data.action === "resume") {
				if (bot.status !== "paused") return error(c, "INVALID_BOT_STATE", "Only a paused bot can be resumed", 409);
				await control.resume(id);
			} else {
				await control.stop(id, parsed.data.mode);
			}
		} catch (cause) {
			return error(c, "BOT_CONTROL_FAILED", cause instanceof Error ? cause.message : "Bot control failed", 409);
		}
		return success(c, { botId: id, accepted: true, action: parsed.data.action, mode: parsed.data.mode }, undefined, 202);
	});

	app.post("/v1/control/emergency-stop", async (c) => {
		const affected = await control.emergencyStop();
		store.addAudit("system.emergency_stop", null, { affected });
		store.publish("system.emergency_stop", { affected });
		return success(c, { stopped: affected.length, botIds: affected });
	});

	app.post("/v1/bots/:botId/auth/qr", async (c) => {
		const bot = store.getBot(c.req.param("botId"));
		if (!bot) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		if (bot.adapter !== "linejs") return error(c, "UNSUPPORTED_AUTH_METHOD", "This adapter does not use QR login", 422);
		const sessionId = `qr_${crypto.randomUUID()}`;
		try {
			const authEvent = await control.startQr(bot.id);
			if (authEvent.type === "auth-error") return error(c, "LINEJS_AUTH_FAILED", authEvent.value ?? "LINEJS authentication failed", 409);
			const payload = {
				sessionId,
				status: "pending",
				qrUrl: authEvent.type === "qr" ? authEvent.value : undefined,
				pin: authEvent.type === "pin" ? authEvent.value : undefined,
				expiresInSeconds: QR_LIFETIME_SECONDS,
			};
			return success(c, payload, undefined, 202);
		} catch (cause) {
			return error(c, "LINEJS_QR_UNAVAILABLE", cause instanceof Error ? cause.message : "QR login is unavailable", 503);
		}
	});

	/**
	 * Forks the bot's worker in advance so the QR that follows appears without
	 * paying for process startup. Fire-and-forget: it never blocks the caller
	 * and never fails the request.
	 */
	app.post("/v1/bots/:botId/auth/qr/prewarm", (c) => {
		const bot = store.getBot(c.req.param("botId"));
		if (!bot) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		if (bot.adapter === "linejs") control.prewarmQr(bot.id);
		return success(c, { botId: bot.id, prewarmed: bot.adapter === "linejs" }, undefined, 202);
	});

	/** Official LINE Messaging API webhook. Signature is verified before parsing. */
	app.post("/v1/webhooks/line/:botId", async (c) => {
		const botId = c.req.param("botId");
		const bot = store.getBot(botId);
		if (!bot || bot.adapter !== "official") return error(c, "BOT_NOT_FOUND", "Official LINE bot not found", 404);
		const credentials = vault.get(botId);
		if (!credentials?.channelSecret) return error(c, "BOT_AUTH_REQUIRED", "Channel secret is not configured", 409);
		const rawBody = await c.req.text();
		const signature = c.req.header("x-line-signature") ?? "";
		const expected = createHmac("sha256", credentials.channelSecret).update(rawBody).digest("base64");
		if (!signature || !fixedTimeEquals(signature, expected)) {
			store.addAudit("webhook.signature_rejected", botId, {});
			return error(c, "INVALID_LINE_SIGNATURE", "Webhook signature is invalid", 401);
		}
		let payload: { events?: unknown[] };
		try {
			payload = JSON.parse(rawBody) as { events?: unknown[] };
		} catch {
			return error(c, "INVALID_WEBHOOK_BODY", "Webhook body is not valid JSON", 400);
		}
		let accepted = 0;
		let ignored = 0;
		for (const rawEvent of payload.events ?? []) {
			const event = parseLineWebhookEvent(rawEvent);
			if (!event) {
				ignored++;
				continue;
			}
			const target = store.listTargets(botId).find((item) => item.externalId === event.targetId && item.enabled);
			if (!target) {
				ignored++;
				continue;
			}
			try {
				if (event.kind === "message") {
					await control.ingestEvent(botId, {
						eventId: event.eventId,
						targetId: event.targetId,
						targetKind: event.targetKind,
						senderId: event.senderId,
						text: event.text,
						timestamp: event.timestamp,
						source: "official",
						replyToken: event.replyToken,
					});
				} else {
					await automation.handleMemberJoined(botId, target, event.memberIds.map((id) => ({ id })), new Date(event.timestamp).toISOString());
				}
				accepted++;
			} catch (cause) {
				ignored++;
				store.addAudit("webhook.event_rejected", botId, {
					eventId: event.eventId,
					message: cause instanceof Error ? cause.message : String(cause),
				});
			}
		}
		return success(c, { accepted, ignored });
	});

	app.get("/v1/bots/:botId/targets", (c) => {
		const botId = c.req.param("botId");
		if (!store.getBot(botId)) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		return success(c, store.listTargets(botId));
	});
	app.post("/v1/bots/:botId/targets", async (c) => {
		const botId = c.req.param("botId");
		if (!store.getBot(botId)) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		const parsed = targetSchema.safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		const target = store.upsertTarget({
			id: parsed.data.id,
			botId,
			externalId: parsed.data.externalId,
			type: parsed.data.type,
			name: parsed.data.name,
			// A manually added target can only be allowlisted once consent is
			// confirmed -- honouring the Add-group modal's own promise that "the
			// bot cannot send here until consent is confirmed", and preventing
			// the enabled-without-consent state that silently blocks every send.
			enabled: parsed.data.allowed ?? (parsed.data.consentConfirmed && parsed.data.enabled),
			consentConfirmedAt: parsed.data.consentConfirmed ? new Date().toISOString() : null,
		});
		return success(c, target, undefined, parsed.data.id ? 200 : 201);
	});
	app.patch("/v1/bots/:botId/targets/:targetId", async (c) => {
		const existing = store.targets.get(c.req.param("targetId"));
		if (!existing || existing.botId !== c.req.param("botId")) return error(c, "TARGET_NOT_FOUND", "Target not found", 404);
		const parsed = targetSchema.partial().safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		const target = store.upsertTarget({
			...existing,
			...parsed.data,
			id: existing.id,
			botId: existing.botId,
			enabled: parsed.data.allowed ?? parsed.data.enabled ?? existing.enabled,
			consentConfirmedAt: parsed.data.consentConfirmed === undefined
				? parsed.data.allowed === true || parsed.data.enabled === true
					? existing.consentConfirmedAt ?? new Date().toISOString()
					: existing.consentConfirmedAt
				: parsed.data.consentConfirmed ? new Date().toISOString() : null,
		});
		return success(c, target);
	});
	app.post("/v1/bots/:botId/targets/discover", async (c) => {
		const botId = c.req.param("botId");
		const bot = store.getBot(botId);
		if (!bot) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		if (bot.status !== "online" && bot.status !== "paused") return error(c, "BOT_NOT_ONLINE", "Start the bot before discovering targets", 409);
		try {
			const targets = await control.syncTargets(botId);
			return success(c, targets, { discovered: targets.length });
		} catch (cause) {
			return error(c, "TARGET_DISCOVERY_FAILED", cause instanceof Error ? cause.message : "Could not discover targets", 409);
		}
	});
	app.delete("/v1/bots/:botId/targets/:targetId", (c) => store.deleteTarget(c.req.param("botId"), c.req.param("targetId")) ? success(c, { deleted: true }) : error(c, "TARGET_NOT_FOUND", "Target not found", 404));

	app.get("/v1/bots/:botId/senders", (c) => {
		const botId = c.req.param("botId");
		if (!store.getBot(botId)) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		return success(c, store.listSenders(botId));
	});
	app.patch("/v1/bots/:botId/senders/:senderId", async (c) => {
		const botId = c.req.param("botId");
		if (!store.getBot(botId)) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		const parsed = z.object({ role: z.enum(["member", "admin"]) }).safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		const record = store.setSenderRole(botId, c.req.param("senderId"), parsed.data.role);
		return record ? success(c, record) : error(c, "SENDER_NOT_FOUND", "Sender not found", 404);
	});

	app.get("/v1/bots/:botId/rules", (c) => {
		const botId = c.req.param("botId");
		return store.getBot(botId) ? success(c, store.listRules(botId)) : error(c, "BOT_NOT_FOUND", "Bot not found", 404);
	});
	app.post("/v1/bots/:botId/rules", async (c) => {
		const botId = c.req.param("botId");
		if (!store.getBot(botId)) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		const parsed = ruleSchema.safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		const rule = store.upsertRule({ ...parsed.data, botId });
		return success(c, rule, undefined, 201);
	});
	app.patch("/v1/bots/:botId/rules/:ruleId", async (c) => {
		const existing = store.rules.get(c.req.param("ruleId"));
		if (!existing || existing.botId !== c.req.param("botId")) return error(c, "RULE_NOT_FOUND", "Rule not found", 404);
		const parsed = ruleSchema.partial().safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		const rule = store.upsertRule({ ...existing, ...parsed.data, id: existing.id, botId: existing.botId });
		return success(c, rule);
	});
	app.put("/v1/bots/:botId/rules/:ruleId", async (c) => {
		const existing = store.rules.get(c.req.param("ruleId"));
		if (!existing || existing.botId !== c.req.param("botId")) return error(c, "RULE_NOT_FOUND", "Rule not found", 404);
		const parsed = ruleSchema.safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		const rule = store.upsertRule({ ...parsed.data, id: existing.id, botId: existing.botId });
		return success(c, rule);
	});
	app.delete("/v1/bots/:botId/rules/:ruleId", (c) => store.deleteRule(c.req.param("botId"), c.req.param("ruleId")) ? success(c, { deleted: true }) : error(c, "RULE_NOT_FOUND", "Rule not found", 404));
	app.post("/v1/bots/:botId/rules/:ruleId/test", async (c) => {
		const rule = store.rules.get(c.req.param("ruleId"));
		if (!rule || rule.botId !== c.req.param("botId")) return error(c, "RULE_NOT_FOUND", "Rule not found", 404);
		const input = await readJson(c) as Record<string, unknown>;
		const event = isNormalizedEvent(input) ? input : createDryRunEvent(store, rule.botId, input);
		try {
			const result = await automation.dryRun(rule.botId, event, rule.id);
			return success(c, result);
		} catch (cause) {
			return error(c, "RULE_TEST_INVALID", cause instanceof Error ? cause.message : "Rule test failed", 422);
		}
	});

	app.get("/v1/bots/:botId/metrics", (c) => {
		const metrics = store.getMetrics(c.req.param("botId"));
		return metrics ? success(c, { current: metrics, series: store.metricSeries.filter((point) => point.botId === metrics.botId) }) : error(c, "BOT_NOT_FOUND", "Bot not found", 404);
	});

	app.post("/v1/bots/:botId/messages", async (c) => {
		const botId = c.req.param("botId");
		const bot = store.getBot(botId);
		if (!bot) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		const parsed = messageSchema.safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		const target = store.targets.get(parsed.data.targetId);
		if (!target || target.botId !== botId || !target.enabled) return error(c, "TARGET_NOT_ALLOWED", "Target is missing or disabled", 403);
		if (!target.consentConfirmedAt) return error(c, "TARGET_CONSENT_REQUIRED", "Target consent must be confirmed before sending", 403);
		if (bot.status !== "online") return error(c, "BOT_NOT_ONLINE", "Bot must be online before sending", 409);
		const delivery = store.createDelivery({ botId, ...parsed.data });
		try {
			await control.enqueueText(botId, {
				deliveryId: delivery.id,
				targetId: target.externalId,
				targetKind: target.type,
				text: parsed.data.text,
				priority: parsed.data.priority === "greeting" ? "join" : parsed.data.priority,
			});
		} catch (cause) {
			store.completeDelivery(delivery.id, false, cause instanceof Error ? cause.message : String(cause));
			return error(c, "DELIVERY_REJECTED", cause instanceof Error ? cause.message : "Delivery was rejected", 409);
		}
		return success(c, delivery, undefined, 202);
	});

	app.get("/v1/bots/:botId/queues", (c) => store.getBot(c.req.param("botId")) ? success(c, store.listTickets(c.req.param("botId"))) : error(c, "BOT_NOT_FOUND", "Bot not found", 404));
	app.post("/v1/bots/:botId/queues", async (c) => {
		const botId = c.req.param("botId");
		if (!store.getBot(botId)) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		const parsed = z.object({ targetId: z.string(), userId: z.string(), displayName: z.string().min(1).max(120) }).safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		return success(c, store.createTicket(botId, parsed.data.targetId, parsed.data.userId, parsed.data.displayName), undefined, 201);
	});
	app.post("/v1/bots/:botId/queues/actions", async (c) => {
		const botId = c.req.param("botId");
		if (!store.getBot(botId)) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		const parsed = z.object({ action: z.enum(["call_next", "complete", "cancel", "skip"]), ticketId: z.string().optional(), targetId: z.string().optional() }).safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		const ticket = parsed.data.action === "call_next"
			? store.callNext(botId, parsed.data.targetId)
			: parsed.data.ticketId
				? store.updateTicket(botId, parsed.data.ticketId, parsed.data.action === "complete" ? "completed" : parsed.data.action === "cancel" ? "cancelled" : "skipped")
				: undefined;
		return ticket ? success(c, ticket) : error(c, "QUEUE_TICKET_NOT_FOUND", "No matching queue ticket", 404);
	});

	app.post("/v1/bots/:botId/events/:eventKey", async (c) => {
		const botId = c.req.param("botId");
		if (!store.getBot(botId)) return error(c, "BOT_NOT_FOUND", "Bot not found", 404);
		const input = await readJson(c);
		const payload = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : { value: input };
		try {
			const eventId = await automation.handleExternal(botId, c.req.param("eventKey"), payload, typeof payload.targetId === "string" ? payload.targetId : undefined);
			store.publish(`external.${c.req.param("eventKey")}`, { eventId }, botId);
			return success(c, { eventId, accepted: true }, undefined, 202);
		} catch (cause) {
			return error(c, "EXTERNAL_EVENT_REJECTED", cause instanceof Error ? cause.message : "Event was rejected", 422);
		}
	});

	app.get("/v1/api-keys", (c) => success(c, [...store.apiKeys.values()].map(publicApiKey)));
	app.post("/v1/api-keys", async (c) => {
		const parsed = z.object({ name: z.string().min(2).max(100), scopes: z.array(z.string()).min(1).max(30) }).safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		const { record, secret } = store.createApiKey(parsed.data.name, parsed.data.scopes);
		return success(c, { record: publicApiKey(record), secret }, undefined, 201);
	});
	app.delete("/v1/api-keys/:keyId", (c) => {
		const key = store.revokeApiKey(c.req.param("keyId"));
		return key ? success(c, publicApiKey(key)) : error(c, "API_KEY_NOT_FOUND", "API key not found", 404);
	});
	app.post("/v1/api-keys/:keyId/control", async (c) => {
		const keyId = c.req.param("keyId");
		const parsed = z.object({ action: z.enum(["pause", "resume"]) }).safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		const existing = store.apiKeys.get(keyId);
		if (!existing) return error(c, "API_KEY_NOT_FOUND", "API key not found", 404);
		if (existing.revokedAt) return error(c, "API_KEY_BANNED", "A banned key cannot be paused or resumed -- create a new one", 409);
		const key = store.setApiKeyPaused(keyId, parsed.data.action === "pause");
		return key ? success(c, publicApiKey(key)) : error(c, "API_KEY_NOT_FOUND", "API key not found", 404);
	});

	app.get("/v1/settings", (c) => success(c, store.getSettings()));
	app.patch("/v1/settings", async (c) => {
		const parsed = settingsPatchSchema.safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		return success(c, store.updateSettings(parsed.data));
	});

	/** Boolean-only environment checks -- never returns an actual secret value. */
	app.get("/v1/system/security", (c) => {
		const checks = [
			{
				id: "admin_password",
				label: "เปลี่ยนรหัสผ่าน Admin จากค่าเริ่มต้นแล้ว",
				ok: process.env.ADMIN_PASSWORD !== undefined && process.env.ADMIN_PASSWORD !== "change-me-before-production",
			},
			{
				id: "jwt_secret",
				label: "เปลี่ยน JWT secret จากค่าเริ่มต้นแล้ว",
				ok: process.env.JWT_SECRET !== undefined && process.env.JWT_SECRET !== "local-development-secret-change-me",
			},
			{
				id: "encryption_key",
				label: "เปลี่ยน encryption key จากค่าเริ่มต้นแล้ว",
				ok: process.env.ENCRYPTION_KEY !== undefined && process.env.ENCRYPTION_KEY !== "local-development-encryption-key",
			},
			{
				id: "dashboard_origin",
				label: "ตั้งค่า DASHBOARD_ORIGIN สำหรับ production แล้ว",
				ok: process.env.DASHBOARD_ORIGIN !== undefined && process.env.DASHBOARD_ORIGIN !== "http://localhost:5173",
			},
			{ id: "node_env", label: "รันด้วย NODE_ENV=production", ok: process.env.NODE_ENV === "production" },
		];
		const score = Math.round((checks.filter((check) => check.ok).length / checks.length) * 100);
		return success(c, { score, checks });
	});

	app.get("/v1/system/resources", (c) => {
		const totalQueueDepth = [...store.metrics.values()].reduce((sum, metric) => sum + metric.queueDepth, 0);
		return success(c, {
			storage: store.getStorageInfo(),
			totalQueueDepth,
			totalBots: store.bots.size,
			activeBots: store.listBots().filter((bot) => ["online", "degraded"].includes(bot.status)).length,
		});
	});

	app.get("/v1/audit", (c) => success(c, store.auditLog));

	app.get("/v1/promptpay/payments", (c) => {
		const botId = c.req.query("botId");
		return success(c, promptPay.list(botId), { total: promptPay.list(botId).length });
	});

	app.post("/v1/promptpay/payments", async (c) => {
		const parsed = promptPayPaymentSchema.safeParse(await readJson(c));
		if (!parsed.success) return validationError(c, parsed.error);
		try {
			const payment = promptPay.create(parsed.data);
			const target = store.targets.get(payment.sourceTargetId);
			try {
				if (!target) throw new Error("ไม่พบ LINE OA ที่เลือก");
				const watchDurationMs = Math.max(30_000, Date.parse(payment.expiresAt) - Date.now() + 30_000);
				await control.watchTarget(payment.botId, target.externalId, watchDurationMs);
			} catch (cause) {
				promptPay.cancel(payment.id);
				return error(
					c,
					"PROMPTPAY_LISTENER_UNAVAILABLE",
					`LINE listener สำรองไม่พร้อม: ${cause instanceof Error ? cause.message : "อ่านประวัติแชตไม่ได้"}`,
					503,
				);
			}
			return success(c, payment, { listenerFallback: "active" }, 201);
		} catch (cause) {
			return error(c, "PROMPTPAY_INVALID", cause instanceof Error ? cause.message : "สร้าง PromptPay QR ไม่สำเร็จ", 422);
		}
	});

	app.get("/v1/promptpay/payments/:paymentId", (c) => {
		const payment = promptPay.get(c.req.param("paymentId"));
		return payment ? success(c, payment) : error(c, "NOT_FOUND", "ไม่พบรายการชำระเงิน", 404);
	});

	app.post("/v1/promptpay/payments/:paymentId/cancel", (c) => {
		const payment = promptPay.cancel(c.req.param("paymentId"));
		return payment ? success(c, payment) : error(c, "PAYMENT_NOT_PENDING", "รายการนี้ไม่ได้อยู่ในสถานะรอชำระ", 409);
	});

	app.delete("/v1/promptpay/payments/:paymentId", (c) => {
		const removed = promptPay.remove(c.req.param("paymentId"));
		return removed ? success(c, { deleted: true }) : error(c, "NOT_FOUND", "ไม่พบรายการชำระเงิน", 404);
	});

	app.get("/v1/events", (c) => streamSSE(c, async (stream) => {
		let finish!: () => void;
		const ended = new Promise<void>((resolve) => { finish = resolve; });
		const write = async (event: LiveEvent) => {
			await stream.writeSSE({ id: event.id, event: event.type, data: JSON.stringify(event) });
		};
		const lastEventId = c.req.header("last-event-id");
		const start = lastEventId ? Math.max(0, store.liveEvents.findIndex((event) => event.id === lastEventId) + 1) : Math.max(0, store.liveEvents.length - 20);
		for (const event of store.liveEvents.slice(start)) await write(event);
		const handler = (event: LiveEvent) => { void write(event); };
		store.emitter.on("event", handler);
		const heartbeat = setInterval(() => { void stream.writeSSE({ event: "heartbeat", data: JSON.stringify({ timestamp: new Date().toISOString() }) }); }, 15_000);
		stream.onAbort(finish);
		await ended;
		clearInterval(heartbeat);
		store.emitter.off("event", handler);
	}));

	return {
		app,
		store,
		vault,
		control,
		automation,
		promptPay,
		shutdown: async () => {
			automation.close();
			await control.shutdown("graceful");
			store.close();
			vault.close();
		},
	};
}

type AppContext = Context<{ Variables: Variables }>;

function envelope<T>(c: AppContext, data: T | null, errorValue: ApiEnvelope<T>["error"], meta?: Record<string, unknown>): ApiEnvelope<T> {
	return { data, ...(meta ? { meta } : {}), error: errorValue, requestId: c.get("requestId") };
}

function success<T>(c: AppContext, data: T, meta?: Record<string, unknown>, status: ContentfulStatusCode = 200) {
	return c.json(envelope(c, data, null, meta), status);
}

function error(c: AppContext, code: string, message: string, status: ContentfulStatusCode, details?: unknown) {
	return c.json(envelope(c, null, { code, message, ...(details === undefined ? {} : { details }) }), status);
}

function validationError(c: AppContext, cause: z.ZodError) {
	return error(c, "VALIDATION_ERROR", "Request validation failed", 422, cause.flatten());
}

function isNormalizedEvent(value: Record<string, unknown>): boolean {
	return typeof value.id === "string" && typeof value.botId === "string" &&
		typeof value.type === "string" && typeof value.occurredAt === "string";
}

function createDryRunEvent(store: MemoryStore, botId: string, input: Record<string, unknown>) {
	const bot = store.getBot(botId);
	if (!bot) throw new Error("Bot not found");
	const selectedTarget = typeof input.targetId === "string" ? store.targets.get(input.targetId) : undefined;
	const target = selectedTarget?.botId === botId ? selectedTarget : store.listTargets(botId)[0];
	const timestamp = new Date().toISOString();
	return {
		id: `evt_${crypto.randomUUID()}`,
		botId,
		adapterType: bot.adapter,
		type: "message_received" as const,
		occurredAt: timestamp,
		receivedAt: timestamp,
		target: {
			id: target?.id ?? "target_dry_run",
			adapterTargetId: target?.externalId ?? "local-dry-run",
			type: target?.type ?? "group",
			name: target?.name ?? "Dry run target",
		},
		actor: {
			id: typeof input.senderId === "string" ? input.senderId : "user_dry_run",
			displayName: typeof input.displayName === "string" ? input.displayName : "Dry Run User",
			role: input.role === "admin" || input.role === "operator" || input.role === "member" ? input.role : "unknown",
		},
		message: {
			id: `msg_${crypto.randomUUID()}`,
			text: typeof input.text === "string" ? input.text : "!จองคิว",
		},
		metadata: {},
	};
}

type ParsedLineWebhookEvent =
	| {
		kind: "message";
		eventId: string;
		targetId: string;
		targetKind: "group" | "room" | "user";
		senderId: string;
		text: string;
		timestamp: number;
		replyToken?: string;
	}
	| {
		kind: "member_joined";
		eventId: string;
		targetId: string;
		targetKind: "group" | "room" | "user";
		memberIds: string[];
		timestamp: number;
	};

function parseLineWebhookEvent(value: unknown): ParsedLineWebhookEvent | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const source = raw.source && typeof raw.source === "object" ? raw.source as Record<string, unknown> : undefined;
	if (!source) return undefined;
	const sourceType = source.type;
	const targetKind = sourceType === "group" || sourceType === "room" || sourceType === "user" ? sourceType : undefined;
	const targetId = targetKind === "group"
		? source.groupId
		: targetKind === "room"
		? source.roomId
		: source.userId;
	if (!targetKind || typeof targetId !== "string") return undefined;
	const timestamp = typeof raw.timestamp === "number" ? raw.timestamp : Date.now();
	const fallbackId = `line_${crypto.randomUUID()}`;
	if (raw.type === "message") {
		const message = raw.message && typeof raw.message === "object" ? raw.message as Record<string, unknown> : undefined;
		if (!message || message.type !== "text" || typeof message.text !== "string") return undefined;
		return {
			kind: "message",
			eventId: typeof raw.webhookEventId === "string" ? raw.webhookEventId : typeof message.id === "string" ? message.id : fallbackId,
			targetId,
			targetKind,
			senderId: typeof source.userId === "string" ? source.userId : "unknown",
			text: message.text,
			timestamp,
			...(typeof raw.replyToken === "string" ? { replyToken: raw.replyToken } : {}),
		};
	}
	if (raw.type === "memberJoined") {
		const joined = raw.joined && typeof raw.joined === "object" ? raw.joined as Record<string, unknown> : undefined;
		const members = Array.isArray(joined?.members) ? joined.members : [];
		const memberIds = members.flatMap((member) => {
			if (!member || typeof member !== "object") return [];
			const id = (member as Record<string, unknown>).userId;
			return typeof id === "string" ? [id] : [];
		});
		if (!memberIds.length) return undefined;
		return {
			kind: "member_joined",
			eventId: typeof raw.webhookEventId === "string" ? raw.webhookEventId : fallbackId,
			targetId,
			targetKind,
			memberIds,
			timestamp,
		};
	}
	return undefined;
}

function speedDefaults(
	adapter: "official" | "linejs",
	profile: "safe" | "balanced" | "max_compliant" | "extreme" | "custom",
): { messagesPerSecond: number; burst: number } {
	if (adapter === "official") {
		if (profile === "safe") return { messagesPerSecond: 5, burst: 5 };
		if (profile === "balanced") return { messagesPerSecond: 10, burst: 10 };
		if (profile === "extreme") return { messagesPerSecond: 40, burst: 40 };
		// "max_compliant" and unspecified "custom" values land here.
		return { messagesPerSecond: 20, burst: 20 };
	}
	// Sustained rates are deliberately conservative -- LINEJS drives a real user
	// account. The burst (token-bucket capacity) is what decides whether the
	// *first* replies after a quiet spell go out immediately or queue behind a
	// refill; with a burst of 1, a second reply waited two full seconds. Raising
	// only the burst keeps the long-run rate, and therefore the risk, unchanged.
	// "extreme" is the fastest preset offered and still sends less than once
	// every 250ms sustained -- past this point "custom" is the only way up,
	// and every step above "safe" already carries a real ban risk on an
	// unofficial account.
	if (profile === "safe") return { messagesPerSecond: 0.5, burst: 3 };
	if (profile === "balanced") return { messagesPerSecond: 1, burst: 4 };
	if (profile === "extreme") return { messagesPerSecond: 4, burst: 8 };
	// "max_compliant" and unspecified "custom" values land here.
	return { messagesPerSecond: 2, burst: 6 };
}
