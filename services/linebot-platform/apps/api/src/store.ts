import { EventEmitter } from "node:events";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { Persistence } from "./db.js";
import type {
	ApiKeyRecord,
	AuditRecord,
	BankAlertRecord,
	BotMetrics,
	BotRecord,
	BotStatus,
	DeliveryRecord,
	LiveEvent,
	MetricPoint,
	PromptPayPayment,
	QueueTicket,
	RuleRecord,
	SenderRecord,
	SenderRole,
	SystemSettings,
	TargetRecord,
} from "./types.js";

const now = () => new Date().toISOString();

const DEFAULT_SETTINGS: Omit<SystemSettings, "updatedAt"> = {
	defaultSpeedProfile: "balanced",
	defaultTimezone: "Asia/Bangkok",
	gracefulDrainTimeoutMs: 30_000,
	firstResponseWindowMs: 5_000,
};

function loadLevel(metrics: Pick<BotMetrics, "cpuPercent" | "queueDepth" | "rateUtilization">): BotMetrics["loadLevel"] {
	const utilization = Math.max(
		metrics.cpuPercent,
		Math.min(100, metrics.queueDepth * 10),
		metrics.rateUtilization,
	);
	return utilization >= 80 ? "high" : utilization >= 40 ? "medium" : "low";
}

function sameTarget(left: TargetRecord, right: TargetRecord): boolean {
	return left.id === right.id &&
		left.botId === right.botId &&
		left.externalId === right.externalId &&
		left.type === right.type &&
		left.name === right.name &&
		left.enabled === right.enabled &&
		left.consentConfirmedAt === right.consentConfirmedAt &&
		left.createdAt === right.createdAt &&
		left.memberCount === right.memberCount;
}

function emptyMetrics(bot: BotRecord): BotMetrics {
	return {
		botId: bot.id,
		status: bot.status,
		uptimeSeconds: 0,
		queueDepth: 0,
		messagesReceived: 0,
		messagesSent: 0,
		messagesFailed: 0,
		messagesPerSecond: 0,
		successRate: 100,
		firstResponseWins: 0,
		firstResponseLosses: 0,
		firstResponseUnknown: 0,
		firstResponseRate: 0,
		latencyP50Ms: 0,
		latencyP95Ms: 0,
		latencyP99Ms: 0,
		cpuPercent: 0,
		memoryMb: 0,
		rateUtilization: 0,
		loadLevel: "low",
		lastEventAt: null,
		lastSendAt: null,
		updatedAt: now(),
	};
}

export class MemoryStore {
	readonly bots = new Map<string, BotRecord>();
	readonly targets = new Map<string, TargetRecord>();
	readonly senders = new Map<string, SenderRecord>();
	readonly rules = new Map<string, RuleRecord>();
	readonly metrics = new Map<string, BotMetrics>();
	readonly metricSeries: MetricPoint[] = [];
	readonly queueTickets = new Map<string, QueueTicket>();
	readonly deliveries = new Map<string, DeliveryRecord>();
	readonly apiKeys = new Map<string, ApiKeyRecord>();
	readonly promptPayPayments = new Map<string, PromptPayPayment>();
	readonly bankAlerts = new Map<string, BankAlertRecord>();
	readonly auditLog: AuditRecord[] = [];
	readonly liveEvents: LiveEvent[] = [];
	readonly idempotency = new Map<string, { status: number; body: unknown; expiresAt: number }>();
	readonly emitter = new EventEmitter();
	readonly #db: Persistence;
	/**
	 * `${botId}:${externalId}` → target id. Inbound events arrive keyed by the
	 * adapter's chat id, and resolving that by scanning every target put an
	 * O(targets) walk in front of every single reply.
	 */
	readonly #targetsByExternalId = new Map<string, string>();
	/** Rows whose disk write is deferred; see {@link #scheduleFlush}. */
	readonly #deferredWrites: Array<[collection: string, key: string, value: unknown]> = [];
	readonly #deferredDeletes: Array<[collection: string, key: string]> = [];
	#flushScheduled = false;
	#closed = false;
	readonly #dbPath: string;
	#settings: SystemSettings;

	/**
	 * `dbPath` defaults to `:memory:` (matching this class's name) so tests and
	 * any other short-lived instance stay fully isolated. The real server
	 * entrypoint passes a real file path so every entity a user creates --
	 * bots, targets, rules, senders, API keys, queue tickets, and fleet-wide
	 * settings -- survives a restart. Only telemetry that rebuilds itself from
	 * live state (metrics, the delivery log, the SSE catch-up ring buffer)
	 * stays in-memory; none of that is something a user created.
	 */
	constructor(dbPath = ":memory:") {
		this.emitter.setMaxListeners(100);
		this.#dbPath = dbPath;
		this.#db = new Persistence(dbPath);
		for (const [id, bot] of this.#db.loadAll<BotRecord>("bots")) this.bots.set(id, bot);
		for (const [id, target] of this.#db.loadAll<TargetRecord>("targets")) {
			// Backfill the enabled-implies-consent invariant for records written
			// before it was enforced, so previously-broken allowlisted targets
			// can send without the operator having to re-toggle them.
			if (target.enabled && !target.consentConfirmedAt) {
				target.consentConfirmedAt = now();
				this.#db.upsert("targets", id, target);
			}
			this.targets.set(id, target);
			this.#targetsByExternalId.set(`${target.botId}:${target.externalId}`, id);
		}
		for (const [key, sender] of this.#db.loadAll<SenderRecord>("senders")) this.senders.set(key, sender);
		for (const [id, rule] of this.#db.loadAll<RuleRecord>("rules")) this.rules.set(id, rule);
		for (const [id, key] of this.#db.loadAll<ApiKeyRecord>("apiKeys")) this.apiKeys.set(id, key);
		for (const [id, ticket] of this.#db.loadAll<QueueTicket>("queueTickets")) this.queueTickets.set(id, ticket);
		for (const [id, payment] of this.#db.loadAll<PromptPayPayment>("promptPayPayments")) this.promptPayPayments.set(id, payment);
		for (const [id, alert] of this.#db.loadAll<BankAlertRecord>("bankAlerts")) this.bankAlerts.set(id, alert);
		const auditEntries = this.#db.loadAll<AuditRecord>("auditLog").map(([, entry]) => entry);
		auditEntries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		this.auditLog.push(...auditEntries.slice(0, 500));
		for (const bot of this.bots.values()) this.metrics.set(bot.id, emptyMetrics(bot));
		const storedSettings = this.#db.loadAll<SystemSettings>("settings").find(([key]) => key === "global")?.[1];
		this.#settings = storedSettings ?? { ...DEFAULT_SETTINGS, updatedAt: now() };
	}

	close(): void {
		if (this.#closed) return;
		this.flushDeferredWrites();
		// Work already in flight can still emit bookkeeping after this point --
		// a rule action that completes during shutdown, for instance -- and its
		// deferred write must not reach a closed database.
		this.#closed = true;
		this.#db.close();
	}

	/**
	 * Queues a row for a later disk write.
	 *
	 * Audit entries and sender bookkeeping are produced by the same code path
	 * that has to get a reply onto the wire, and `DatabaseSync` writes block the
	 * event loop. Batching them into one post-tick flush keeps that work off the
	 * reply's critical path without dropping it: the in-memory record is updated
	 * immediately, and the flush runs before anything can observe the file.
	 */
	#deferWrite(collection: string, key: string, value: unknown): void {
		if (this.#closed) return;
		this.#deferredWrites.push([collection, key, value]);
		this.#scheduleFlush();
	}

	#scheduleFlush(): void {
		if (this.#flushScheduled) return;
		this.#flushScheduled = true;
		// Left referenced on purpose: an immediate runs in the same loop
		// iteration it was queued from, so it cannot meaningfully delay exit,
		// and unref'ing it would risk dropping the write on the way out.
		setImmediate(() => this.flushDeferredWrites());
	}

	flushDeferredWrites(): void {
		this.#flushScheduled = false;
		if (this.#closed) {
			this.#deferredWrites.length = 0;
			this.#deferredDeletes.length = 0;
			return;
		}
		if (!this.#deferredWrites.length && !this.#deferredDeletes.length) return;
		this.#db.applyBatch(this.#deferredWrites.splice(0), this.#deferredDeletes.splice(0));
	}

	getSettings(): SystemSettings {
		return this.#settings;
	}

	updateSettings(patch: Partial<Omit<SystemSettings, "updatedAt">>): SystemSettings {
		this.#settings = { ...this.#settings, ...patch, updatedAt: now() };
		this.#db.upsert("settings", "global", this.#settings);
		this.addAudit("settings.updated", null, patch);
		this.publish("settings.updated", this.#settings);
		return this.#settings;
	}

	/** Real on-disk footprint of persisted data, for the Settings page's resource panel. */
	getStorageInfo(): { path: string; sizeBytes: number; persistent: boolean } {
		if (this.#dbPath === ":memory:") return { path: this.#dbPath, sizeBytes: 0, persistent: false };
		try {
			return { path: this.#dbPath, sizeBytes: statSync(this.#dbPath).size, persistent: true };
		} catch {
			// Not yet written to disk (e.g. no bot has been created yet).
			return { path: this.#dbPath, sizeBytes: 0, persistent: true };
		}
	}

	listBots(): BotRecord[] {
		return [...this.bots.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	}

	getBot(id: string): BotRecord | undefined {
		return this.bots.get(id);
	}

	createBot(input: Omit<BotRecord, "id" | "status" | "desiredStatus" | "createdAt" | "updatedAt" | "lastHeartbeatAt">): BotRecord {
		const createdAt = now();
		const bot: BotRecord = {
			...input,
			id: `bot_${randomUUID()}`,
			status: input.adapter === "linejs" ? "auth_required" : "stopped",
			desiredStatus: "stopped",
			createdAt,
			updatedAt: createdAt,
			lastHeartbeatAt: null,
		};
		this.bots.set(bot.id, bot);
		this.#db.upsert("bots", bot.id, bot);
		this.metrics.set(bot.id, emptyMetrics(bot));
		this.addAudit("bot.created", bot.id, { name: bot.name, adapter: bot.adapter });
		this.publish("bot.created", bot, bot.id);
		return bot;
	}

	updateBot(id: string, patch: Partial<BotRecord>): BotRecord | undefined {
		const current = this.bots.get(id);
		if (!current) return undefined;
		const updated = { ...current, ...patch, id, updatedAt: now() };
		this.bots.set(id, updated);
		this.#db.upsert("bots", id, updated);
		const metrics = this.metrics.get(id);
		if (metrics && patch.status) this.metrics.set(id, { ...metrics, status: patch.status, updatedAt: now() });
		this.publish("bot.updated", updated, id);
		return updated;
	}

	deleteBot(id: string): boolean {
		if (!this.bots.delete(id)) return false;
		this.#db.remove("bots", id);
		for (const [key, value] of this.targets) {
			if (value.botId !== id) continue;
			this.targets.delete(key);
			this.#targetsByExternalId.delete(`${value.botId}:${value.externalId}`);
			this.#db.remove("targets", key);
		}
		for (const [key, value] of this.senders) if (value.botId === id) { this.senders.delete(key); this.#db.remove("senders", key); }
		for (const [key, value] of this.rules) if (value.botId === id) { this.rules.delete(key); this.#db.remove("rules", key); }
		for (const [key, value] of this.queueTickets) {
			if (value.botId !== id) continue;
			this.queueTickets.delete(key);
			this.#db.remove("queueTickets", key);
		}
		for (const [key, value] of this.promptPayPayments) {
			if (value.botId !== id) continue;
			this.promptPayPayments.delete(key);
			this.#db.remove("promptPayPayments", key);
		}
		for (const [key, value] of this.bankAlerts) {
			if (value.botId !== id) continue;
			this.bankAlerts.delete(key);
			this.#db.remove("bankAlerts", key);
		}
		this.metrics.delete(id);
		this.addAudit("bot.deleted", id, {});
		this.publish("bot.deleted", { id }, id);
		return true;
	}

	setStatus(id: string, status: BotStatus, desiredStatus = status): BotRecord | undefined {
		const bot = this.updateBot(id, {
			status,
			desiredStatus,
			lastHeartbeatAt: status === "online" || status === "paused" ? now() : this.bots.get(id)?.lastHeartbeatAt ?? null,
		});
		if (!bot) return undefined;
		const current = this.metrics.get(id) ?? emptyMetrics(bot);
		this.metrics.set(id, {
			...current,
			status,
			messagesPerSecond: status === "online" ? current.messagesPerSecond : 0,
			queueDepth: status === "stopped" ? 0 : current.queueDepth,
			updatedAt: now(),
		});
		this.addAudit("bot.status_changed", id, { status, desiredStatus });
		this.publish("bot.status", { status, desiredStatus }, id);
		return bot;
	}

	listTargets(botId: string): TargetRecord[] {
		return [...this.targets.values()].filter((target) => target.botId === botId);
	}

	/** O(1) lookup for the inbound path; `adapterTargetId` may be either id form. */
	findTarget(botId: string, adapterTargetId: string): TargetRecord | undefined {
		const mapped = this.#targetsByExternalId.get(`${botId}:${adapterTargetId}`);
		const target = this.targets.get(mapped ?? adapterTargetId);
		return target?.botId === botId ? target : undefined;
	}

	upsertTarget(input: Omit<TargetRecord, "id" | "createdAt"> & { id?: string }): TargetRecord {
		const record: TargetRecord = { ...input, id: input.id ?? `target_${randomUUID()}`, createdAt: input.id ? this.targets.get(input.id)?.createdAt ?? now() : now() };
		// Invariant: an allowlisted target is, by definition, one the operator
		// has opted into sending to -- there is no legitimate "enabled but no
		// consent" state. Leaving that gap open made every rule reply and
		// direct send throw "has no consent" silently (audit-only), which reads
		// to the user as "the bot does nothing". Enforce it here so no code
		// path (manual add, discovery sync, future callers) can recreate it.
		if (record.enabled && !record.consentConfirmedAt) record.consentConfirmedAt = now();
		const existing = this.targets.get(record.id);
		if (existing && sameTarget(existing, record)) return existing;
		this.targets.set(record.id, record);
		this.#targetsByExternalId.set(`${record.botId}:${record.externalId}`, record.id);
		this.#deferWrite("targets", record.id, record);
		this.addAudit(input.id ? "target.updated" : "target.created", record.botId, { targetId: record.id });
		this.publish("target.updated", record, record.botId);
		return record;
	}

	deleteTarget(botId: string, id: string): boolean {
		const target = this.targets.get(id);
		if (!target || target.botId !== botId) return false;
		this.targets.delete(id);
		this.#targetsByExternalId.delete(`${target.botId}:${target.externalId}`);
		this.#db.remove("targets", id);
		this.addAudit("target.deleted", botId, { targetId: id });
		return true;
	}

	listSenders(botId: string): SenderRecord[] {
		return [...this.senders.values()].filter((sender) => sender.botId === botId).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
	}

	/** Called for every inbound message so unknown senders quietly build up a roster to promote from. */
	observeSender(botId: string, senderId: string): SenderRecord {
		const key = `${botId}:${senderId}`;
		const existing = this.senders.get(key);
		const record: SenderRecord = existing
			? { ...existing, lastSeenAt: now(), messageCount: existing.messageCount + 1 }
			: { id: senderId, botId, role: "member", firstSeenAt: now(), lastSeenAt: now(), messageCount: 1 };
		this.senders.set(key, record);
		// Every inbound message updates a counter here; the disk write is not
		// worth blocking the reply for.
		this.#deferWrite("senders", key, record);
		if (!existing) this.publish("sender.seen", record, botId);
		return record;
	}

	/** Reads a sender's role without recording a sighting. */
	getSenderRole(botId: string, senderId: string): SenderRole {
		return this.senders.get(`${botId}:${senderId}`)?.role ?? "member";
	}

	setSenderRole(botId: string, senderId: string, role: SenderRole): SenderRecord | undefined {
		const key = `${botId}:${senderId}`;
		const existing = this.senders.get(key);
		if (!existing) return undefined;
		const record: SenderRecord = { ...existing, role };
		this.senders.set(key, record);
		this.#db.upsert("senders", key, record);
		this.addAudit("sender.role_changed", botId, { senderId, role });
		this.publish("sender.updated", record, botId);
		return record;
	}

	listRules(botId: string): RuleRecord[] {
		return [...this.rules.values()].filter((rule) => rule.botId === botId).sort((a, b) => b.priority - a.priority);
	}

	upsertRule(input: Omit<RuleRecord, "id" | "createdAt" | "updatedAt" | "version"> & { id?: string; version?: number }): RuleRecord {
		const current = input.id ? this.rules.get(input.id) : undefined;
		const timestamp = now();
		const record: RuleRecord = {
			...input,
			id: input.id ?? `rule_${randomUUID()}`,
			createdAt: current?.createdAt ?? timestamp,
			updatedAt: timestamp,
			version: current ? current.version + 1 : input.version ?? 1,
		};
		this.rules.set(record.id, record);
		this.#db.upsert("rules", record.id, record);
		this.addAudit(current ? "rule.updated" : "rule.created", record.botId, { ruleId: record.id, version: record.version });
		this.publish("rule.updated", record, record.botId);
		return record;
	}

	deleteRule(botId: string, id: string): boolean {
		const rule = this.rules.get(id);
		if (!rule || rule.botId !== botId) return false;
		this.rules.delete(id);
		this.#db.remove("rules", id);
		this.addAudit("rule.deleted", botId, { ruleId: id });
		return true;
	}

	getMetrics(botId: string): BotMetrics | undefined {
		return this.metrics.get(botId);
	}

	updateMetrics(botId: string, patch: Partial<BotMetrics>): BotMetrics | undefined {
		const current = this.metrics.get(botId);
		if (!current) return undefined;
		const next = { ...current, ...patch, botId, updatedAt: now() };
		next.loadLevel = loadLevel(next);
		const decided = next.firstResponseWins + next.firstResponseLosses;
		next.firstResponseRate = decided ? Math.round((next.firstResponseWins / decided) * 10_000) / 100 : 0;
		this.metrics.set(botId, next);
		this.publish("bot.metrics", next, botId);
		return next;
	}

	/**
	 * Snapshots a bot's *current* metrics into history for the throughput
	 * chart. Called on a fixed interval (not per-heartbeat, which fires far
	 * more often) so the series is an even, predictable cadence rather than
	 * bursty. In-memory only -- losing an hour of chart history on a restart
	 * is an acceptable tradeoff for a live operational chart, and there was no
	 * persistence path for this collection before it existed either.
	 */
	recordMetricPoint(botId: string): void {
		const metrics = this.metrics.get(botId);
		if (!metrics) return;
		this.metricSeries.push({
			botId,
			timestamp: now(),
			latencyMs: metrics.latencyP95Ms,
			messagesPerSecond: metrics.messagesPerSecond,
			successRate: metrics.successRate,
			queueDepth: metrics.queueDepth,
		});
		// Bounded so a long-running server doesn't grow this unboundedly; comfortably
		// covers 60 one-minute points for a large fleet of bots.
		if (this.metricSeries.length > 5_000) this.metricSeries.splice(0, this.metricSeries.length - 5_000);
	}

	createDelivery(input: Pick<DeliveryRecord, "botId" | "targetId" | "text" | "priority">): DeliveryRecord {
		const delivery: DeliveryRecord = { ...input, id: `delivery_${randomUUID()}`, status: "queued", createdAt: now(), sentAt: null, error: null };
		this.deliveries.set(delivery.id, delivery);
		const metrics = this.metrics.get(input.botId);
		if (metrics) this.updateMetrics(input.botId, { queueDepth: metrics.queueDepth + 1 });
		this.publish("delivery.queued", delivery, input.botId);
		return delivery;
	}

	completeDelivery(id: string, success = true, error?: string): DeliveryRecord | undefined {
		const current = this.deliveries.get(id);
		if (!current) return undefined;
		const delivery: DeliveryRecord = { ...current, status: success ? "sent" : "failed", sentAt: success ? now() : null, error: error ?? null };
		this.deliveries.set(id, delivery);
		const metrics = this.metrics.get(delivery.botId);
		if (metrics) {
			const sent = metrics.messagesSent + (success ? 1 : 0);
			const failed = metrics.messagesFailed + (success ? 0 : 1);
			this.updateMetrics(delivery.botId, {
				messagesSent: sent,
				messagesFailed: failed,
				queueDepth: Math.max(0, metrics.queueDepth - 1),
				successRate: sent + failed ? Math.round((sent / (sent + failed)) * 10_000) / 100 : 100,
				lastSendAt: success ? now() : metrics.lastSendAt,
			});
		}
		this.publish(success ? "delivery.sent" : "delivery.failed", delivery, delivery.botId);
		return delivery;
	}

	listTickets(botId: string): QueueTicket[] {
		return [...this.queueTickets.values()].filter((ticket) => ticket.botId === botId).sort((a, b) => a.number - b.number);
	}

	listPromptPayPayments(botId?: string): PromptPayPayment[] {
		return [...this.promptPayPayments.values()]
			.filter((payment) => !botId || payment.botId === botId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	savePromptPayPayment(payment: PromptPayPayment): PromptPayPayment {
		this.promptPayPayments.set(payment.id, payment);
		// Deferred like targets/senders/auditLog: the in-memory Map (the source
		// of truth for every read this session) is already updated above, so the
		// synchronous disk fsync doesn't need to sit on the bank-message ->
		// verified-payment critical path. Flushes on the next tick regardless.
		this.#deferWrite("promptPayPayments", payment.id, payment);
		return payment;
	}

	deletePromptPayPayment(botId: string, id: string): boolean {
		const payment = this.promptPayPayments.get(id);
		if (!payment || payment.botId !== botId) return false;
		this.promptPayPayments.delete(id);
		this.#db.remove("promptPayPayments", id);
		this.addAudit("promptpay.deleted", botId, { paymentId: id, status: payment.status });
		return true;
	}

	saveBankAlert(alert: BankAlertRecord): BankAlertRecord {
		this.bankAlerts.set(alert.id, alert);
		this.#deferWrite("bankAlerts", alert.id, alert);
		return alert;
	}

	createTicket(botId: string, targetId: string, userId: string, displayName: string): QueueTicket {
		const existing = this.listTickets(botId).filter((ticket) => ticket.targetId === targetId);
		const nextNumber = Math.max(0, ...existing.map((ticket) => ticket.number)) + 1;
		const ticket: QueueTicket = {
			id: `ticket_${randomUUID()}`,
			botId,
			targetId,
			userId,
			displayName,
			number: nextNumber,
			status: "waiting",
			createdAt: now(),
			calledAt: null,
			completedAt: null,
		};
		this.queueTickets.set(ticket.id, ticket);
		this.#db.upsert("queueTickets", ticket.id, ticket);
		this.addAudit("queue.joined", botId, { ticketId: ticket.id, number: ticket.number });
		this.publish("queue.updated", ticket, botId);
		return ticket;
	}

	updateTicket(botId: string, id: string, status: QueueTicket["status"]): QueueTicket | undefined {
		const current = this.queueTickets.get(id);
		if (!current || current.botId !== botId) return undefined;
		const ticket: QueueTicket = {
			...current,
			status,
			calledAt: status === "called" ? now() : current.calledAt,
			completedAt: status === "completed" ? now() : current.completedAt,
		};
		this.queueTickets.set(id, ticket);
		this.#db.upsert("queueTickets", id, ticket);
		this.addAudit(`queue.${status}`, botId, { ticketId: id, number: ticket.number });
		this.publish("queue.updated", ticket, botId);
		return ticket;
	}

	callNext(botId: string, targetId?: string): QueueTicket | undefined {
		const waiting = this.listTickets(botId).filter((ticket) => ticket.status === "waiting" && (!targetId || ticket.targetId === targetId));
		return waiting[0] ? this.updateTicket(botId, waiting[0].id, "called") : undefined;
	}

	createApiKey(name: string, scopes: string[]): { record: ApiKeyRecord; secret: string } {
		const secret = `lbk_${randomBytes(24).toString("base64url")}`;
		const record: ApiKeyRecord = {
			id: `key_${randomUUID()}`,
			name,
			prefix: secret.slice(0, 12),
			secretHash: createHash("sha256").update(secret).digest("hex"),
			scopes,
			createdAt: now(),
			lastUsedAt: null,
			pausedAt: null,
			revokedAt: null,
		};
		this.apiKeys.set(record.id, record);
		this.#db.upsert("apiKeys", record.id, record);
		this.addAudit("api_key.created", null, { keyId: record.id, scopes });
		return { record, secret };
	}

	revokeApiKey(id: string): ApiKeyRecord | undefined {
		const current = this.apiKeys.get(id);
		if (!current) return undefined;
		const record = { ...current, revokedAt: now() };
		this.apiKeys.set(id, record);
		this.#db.upsert("apiKeys", id, record);
		this.addAudit("api_key.revoked", null, { keyId: id });
		return record;
	}

	/** Reversible suspension -- unlike revoke, a paused key can be resumed. Both no-op past a permanent ban. */
	setApiKeyPaused(id: string, paused: boolean): ApiKeyRecord | undefined {
		const current = this.apiKeys.get(id);
		if (!current || current.revokedAt) return undefined;
		const record = { ...current, pausedAt: paused ? now() : null };
		this.apiKeys.set(id, record);
		this.#db.upsert("apiKeys", id, record);
		this.addAudit(paused ? "api_key.paused" : "api_key.resumed", null, { keyId: id });
		return record;
	}

	/** Looks up an active (non-revoked, non-paused) key by its full secret and bumps lastUsedAt. Linear scan is fine at this scale (a handful of keys, not per-request-hot). */
	authenticateApiKey(secret: string): ApiKeyRecord | undefined {
		const hash = createHash("sha256").update(secret).digest("hex");
		for (const key of this.apiKeys.values()) {
			if (key.revokedAt || key.pausedAt || key.secretHash !== hash) continue;
			const updated = { ...key, lastUsedAt: now() };
			this.apiKeys.set(key.id, updated);
			this.#db.upsert("apiKeys", key.id, updated);
			return updated;
		}
		return undefined;
	}

	addAudit(action: string, botId: string | null, details: Record<string, unknown>, actor = "local-admin"): AuditRecord {
		const record: AuditRecord = { id: `audit_${randomUUID()}`, action, botId, actor, details, createdAt: now() };
		this.auditLog.unshift(record);
		this.#deferWrite("auditLog", record.id, record);
		if (this.auditLog.length > 500) {
			const dropped = this.auditLog.splice(500);
			if (!this.#closed) for (const entry of dropped) this.#deferredDeletes.push(["auditLog", entry.id]);
		}
		return record;
	}

	publish(type: string, payload: unknown, botId?: string): LiveEvent {
		const event: LiveEvent = { id: randomUUID(), type, botId, payload, createdAt: now() };
		this.liveEvents.push(event);
		if (this.liveEvents.length > 1_000) this.liveEvents.splice(0, this.liveEvents.length - 1_000);
		this.emitter.emit("event", event);
		return event;
	}
}
