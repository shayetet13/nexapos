import type { BotInboundEvent } from "@linebot/bot-worker";
import type {
	NormalizedEvent,
	RuleAction,
	RuleCondition,
	RuleDefinition,
} from "@linebot/contracts";
import {
	createEventTemplateContext,
	InMemoryCooldownStore,
	renderTemplate,
	RuleEngine,
} from "@linebot/rule-engine";
import type { BotControl } from "./bot-control.js";
import type { MemoryStore } from "./store.js";
import type { RuleRecord, TargetRecord } from "./types.js";

type JsonObject = Record<string, unknown>;

export class AutomationService {
	readonly #store: MemoryStore;
	readonly #control: BotControl;
	readonly #engine = new RuleEngine();
	readonly #cooldowns = new InMemoryCooldownStore();
	readonly #webhookEndpoints: Readonly<Record<string, string>>;
	readonly #scheduleRuns = new Set<string>();
	readonly #scheduleTimer: NodeJS.Timeout;

	constructor(store: MemoryStore, control: BotControl) {
		this.#store = store;
		this.#control = control;
		this.#webhookEndpoints = readWebhookEndpoints();
		this.#scheduleTimer = setInterval(() => void this.runSchedules(), 30_000);
		this.#scheduleTimer.unref();
	}

	async handleInbound(event: BotInboundEvent): Promise<void> {
		const target = this.#store.findTarget(event.botId, event.targetId);
		if (!target?.enabled) {
			this.#store.addAudit("rule.event_rejected", event.botId, {
				reason: "target_not_allowed",
				adapterTargetId: event.targetId,
			});
			return;
		}
		const occurredAt = new Date(event.timestamp).toISOString();
		// Roster bookkeeping is not an input to rule matching -- the role it
		// would record is already known -- so it runs after the reply is on its
		// way rather than in front of it.
		const role = this.#store.getSenderRole(event.botId, event.senderId);
		setImmediate(() => this.#store.observeSender(event.botId, event.senderId));
		await this.handleEvent({
			id: entityId(event.eventId),
			botId: event.botId,
			adapterType: event.source,
			type: "message_received",
			occurredAt,
			receivedAt: new Date().toISOString(),
			target: eventTarget(target),
			actor: { id: event.senderId, role },
			message: {
				id: event.eventId,
				text: event.text,
				...(event.replyToken ? { replyToken: event.replyToken } : {}),
			},
			metadata: {},
		});
	}

	async handleExternal(
		botId: string,
		eventKey: string,
		payload: JsonObject,
		targetId?: string,
	): Promise<string> {
		const bot = this.#store.getBot(botId);
		if (!bot) throw new Error("Bot not found");
		const target = targetId ? this.#store.targets.get(targetId) : undefined;
		const id = `evt_${crypto.randomUUID()}`;
		await this.handleEvent({
			id,
			botId,
			adapterType: bot.adapter,
			type: "external_event",
			eventKey: entityId(eventKey),
			payload: jsonObject(payload),
			occurredAt: new Date().toISOString(),
			receivedAt: new Date().toISOString(),
			...(target && target.botId === botId ? { target: eventTarget(target) } : {}),
			metadata: {},
		});
		return id;
	}

	async handleMemberJoined(
		botId: string,
		target: TargetRecord,
		members: Array<{ id: string; displayName?: string }>,
		occurredAt = new Date().toISOString(),
	): Promise<void> {
		const bot = this.#store.getBot(botId);
		if (!bot || !target.enabled || members.length === 0) return;
		await this.handleEvent({
			id: `evt_${crypto.randomUUID()}`,
			botId,
			adapterType: bot.adapter,
			type: "member_joined",
			occurredAt,
			receivedAt: new Date().toISOString(),
			target: eventTarget(target),
			members: members.map((member) => ({ ...member, role: "unknown" as const })),
			metadata: {},
		});
	}

	async dryRun(botId: string, event: unknown, onlyRuleId?: string) {
		const rules = this.#store.listRules(botId)
			.filter((rule) => !onlyRuleId || rule.id === onlyRuleId)
			.map(normalizeRule);
		return await this.#engine.evaluate(event, rules, {
			cooldownStore: this.#cooldowns,
			dryRun: true,
		});
	}

	async handleEvent(event: NormalizedEvent): Promise<void> {
		const records = this.#store.listRules(event.botId);
		const rules = records.map(normalizeRule);
		const targetId = event.target?.id;
		// Skip the ticket scan entirely when no queue exists, which is the
		// common case for a plain auto-reply bot.
		const tickets = targetId && this.#store.queueTickets.size
			? this.#store.listTickets(event.botId).filter((ticket) => ticket.targetId === targetId)
			: [];
		const result = await this.#engine.evaluate(event, rules, {
			cooldownStore: this.#cooldowns,
			currentQueue: targetId ? {
				queueId: targetId,
				botId: event.botId,
				targetId,
				status: "open",
				waitingCount: tickets.filter((ticket) => ticket.status === "waiting").length,
				nextNumber: Math.max(1, ...tickets.map((ticket) => ticket.number + 1)),
				observedAt: new Date().toISOString(),
			} : undefined,
		});
		// Diagnostics are for the operator, not the reply -- record them once the
		// outgoing message has been handed to the worker.
		if (result.diagnostics.length) {
			setImmediate(() => {
				for (const diagnostic of result.diagnostics) {
					this.#store.addAudit("rule.diagnostic", event.botId, {
						code: diagnostic.code,
						message: diagnostic.message,
						ruleId: diagnostic.ruleId,
					});
				}
			});
		}
		if (result.matchedRuleIds.length) {
			this.#store.publish("rule.matched", {
				eventId: event.id,
				ruleIds: result.matchedRuleIds,
			}, event.botId);
		}
		const variables: Record<string, unknown> = {};
		for (const plan of result.actionPlans) {
			if (!plan.ready) continue;
			try {
				await this.#executeAction(event, plan.action, variables);
				setImmediate(() => this.#store.addAudit("rule.action_completed", event.botId, {
					ruleId: plan.ruleId,
					action: plan.action.type,
				}));
			} catch (cause) {
				this.#store.addAudit("rule.action_failed", event.botId, {
					ruleId: plan.ruleId,
					action: plan.action.type,
					message: cause instanceof Error ? cause.message : String(cause),
				});
				break;
			}
		}
	}

	async runSchedules(now = new Date()): Promise<void> {
		const minuteKey = now.toISOString().slice(0, 16);
		for (const rule of this.#store.rules.values()) {
			if (!rule.enabled || rule.trigger.type !== "schedule") continue;
			const bot = this.#store.getBot(rule.botId);
			if (!bot || bot.status !== "online") continue;
			const cron = text(rule.trigger.config.cron, "");
			const timezone = text(rule.trigger.config.timezone, bot.timezone);
			if (!cronMatches(cron, now, timezone)) continue;
			const runKey = `${rule.id}:${minuteKey}`;
			if (this.#scheduleRuns.has(runKey)) continue;
			this.#scheduleRuns.add(runKey);
			for (const target of this.#store.listTargets(bot.id).filter((item) => item.enabled && item.consentConfirmedAt)) {
				await this.handleEvent({
					id: `evt_${crypto.randomUUID()}`,
					botId: bot.id,
					adapterType: bot.adapter,
					type: "schedule",
					scheduleKey: entityId(text(rule.trigger.config.scheduleKey, rule.id)),
					target: eventTarget(target),
					occurredAt: now.toISOString(),
					receivedAt: new Date().toISOString(),
					metadata: {},
				});
			}
		}
		if (this.#scheduleRuns.size > 2_000) this.#scheduleRuns.clear();
	}

	close(): void {
		clearInterval(this.#scheduleTimer);
	}

	async #executeAction(
		event: NormalizedEvent,
		action: RuleAction,
		variables: Record<string, unknown>,
	): Promise<void> {
		const context = { ...createEventTemplateContext(event, variables), ...variables };
		switch (action.type) {
			case "reply_text":
			case "send_text": {
				const target = action.type === "send_text" && action.target.mode === "target"
					? this.#store.targets.get(action.target.targetId)
					: event.target ? this.#store.targets.get(event.target.id) : undefined;
				if (!target || target.botId !== event.botId || !target.enabled || !target.consentConfirmedAt) {
					throw new Error("Action target is missing, disabled, or has no consent");
				}
				const rendered = renderTemplate(action.text, context, { missing: "empty" });
				if (!rendered.value.trim()) throw new Error("Rendered message is empty");
				const delivery = this.#store.createDelivery({
					botId: event.botId,
					targetId: target.id,
					text: rendered.value,
					priority: action.type === "reply_text" ? "reply" : "api",
				});
				try {
					await this.#control.enqueueText(event.botId, {
						deliveryId: delivery.id,
						targetId: target.externalId,
						targetKind: target.type,
						text: rendered.value,
						priority: action.type === "reply_text" ? "reply" : "api",
						...(event.type === "message_received" ? {
							relatedEventId: event.id,
							replyToken: event.message.replyToken,
						} : {}),
					});
				} catch (cause) {
					this.#store.completeDelivery(delivery.id, false, cause instanceof Error ? cause.message : String(cause));
					throw cause;
				}
				return;
			}
			case "queue_join": {
				if (!("actor" in event) || !event.actor || !event.target) throw new Error("queue_join requires an actor and target");
				const existing = this.#store.listTickets(event.botId).find((ticket) =>
					ticket.targetId === event.target?.id && ticket.userId === event.actor?.id && ticket.status === "waiting"
				);
				const ticket = existing ?? this.#store.createTicket(
					event.botId,
					event.target.id,
					event.actor.id,
					event.actor.displayName ?? event.actor.id,
				);
				variables.queue = {
					number: ticket.number,
					ahead: this.#store.listTickets(event.botId).filter((item) => item.targetId === ticket.targetId && item.status === "waiting" && item.number < ticket.number).length,
					ticketId: ticket.id,
					status: ticket.status,
				};
				return;
			}
			case "queue_status": {
				const ticket = actorTicket(this.#store, event);
				variables.queue = ticket ? {
					number: ticket.number,
					status: ticket.status,
					ahead: this.#store.listTickets(event.botId).filter((item) => item.targetId === ticket.targetId && item.status === "waiting" && item.number < ticket.number).length,
				} : { status: "not_found", number: "-", ahead: 0 };
				return;
			}
			case "queue_cancel": {
				const ticket = actorTicket(this.#store, event);
				if (!ticket) throw new Error("No active queue ticket was found");
				this.#store.updateTicket(event.botId, ticket.id, "cancelled");
				variables.queue = { number: ticket.number, status: "cancelled", ticketId: ticket.id };
				return;
			}
			case "queue_next": {
				if ("actor" in event && event.actor && !["operator", "admin"].includes(event.actor.role)) {
					throw new Error("queue_next requires an operator or admin actor");
				}
				const ticket = this.#store.callNext(event.botId, event.target?.id);
				if (!ticket) throw new Error("No waiting queue ticket was found");
				variables.queue = { number: ticket.number, status: ticket.status, ticketId: ticket.id };
				return;
			}
			case "set_variable": {
				variables[action.name] = renderTemplate(action.value, context, { missing: "empty" }).value;
				return;
			}
			case "webhook": {
				const url = this.#webhookEndpoints[action.endpointId];
				if (!url) throw new Error(`Webhook endpoint '${action.endpointId}' is not allowlisted`);
				const response = await fetch(url, {
					method: action.method,
					headers: { "content-type": "application/json" },
					body: JSON.stringify(action.body ?? {}),
					signal: AbortSignal.timeout(5_000),
				});
				if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
				return;
			}
			case "delay":
				await new Promise<void>((resolve) => setTimeout(resolve, action.durationMs));
				return;
			case "stop_processing":
				return;
		}
	}

}

function normalizeRule(record: RuleRecord): RuleDefinition {
	const triggerConfig = record.trigger.config;
	const trigger = record.trigger.type === "schedule"
		? {
			type: "schedule" as const,
			scheduleKey: entityId(text(triggerConfig.scheduleKey, record.id)),
			cron: text(triggerConfig.cron, "0 9 * * *"),
			timezone: text(triggerConfig.timezone, "Asia/Bangkok"),
		}
		: record.trigger.type === "external_event"
		? { type: "external_event" as const, eventKey: entityId(text(triggerConfig.eventKey, record.id)) }
		: record.trigger.type === "queue_state_changed"
		? { type: "queue_state_changed" as const, toStates: queueStates(triggerConfig.state) }
		: { type: record.trigger.type };
	const conditions: RuleCondition[] = [];
	if (record.trigger.type === "message_received" && text(triggerConfig.mode, "all") !== "all") {
		conditions.push({
			type: "text",
			operator: textOperator(triggerConfig.mode),
			value: text(triggerConfig.match, ""),
			caseSensitive: false,
			trim: true,
			negate: false,
		});
	}
	for (const node of record.conditions) {
		const config = node.config;
		if (node.type === "target") {
			if (text(config.mode, "allowlist") === "specific" && text(config.targetId, "")) {
				conditions.push({ type: "target", operator: "in", targetIds: [text(config.targetId, "")], negate: false });
			}
		} else if (node.type === "text" || node.type === "message_match") {
			if (text(config.mode, "contains") !== "all") conditions.push({
				type: "text",
				operator: textOperator(config.mode),
				value: text(config.match ?? config.value, ""),
				caseSensitive: boolean(config.caseSensitive, false),
				trim: true,
				negate: boolean(config.negate, false),
			});
		} else if (node.type === "user" || node.type === "sender_role") {
			conditions.push({
				type: "user",
				operator: "in",
				roles: [role(config.role)],
				negate: false,
			});
		} else if (node.type === "time_window") {
			conditions.push({
				type: "time_window",
				timezone: text(config.timezone, "Asia/Bangkok"),
				daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
				start: text(config.from ?? config.start, "08:00"),
				end: text(config.to ?? config.end, "20:00"),
				negate: boolean(config.negate, false),
			});
		} else if (node.type === "cooldown") {
			conditions.push({
				type: "cooldown",
				scope: text(config.scope, "user") === "group" ? "target" : cooldownScope(config.scope),
				durationMs: Math.max(100, Math.min(86_400_000, number(config.durationMs, number(config.seconds, 30) * 1_000))),
				negate: false,
			});
		} else if (node.type === "queue_state") {
			conditions.push({ type: "queue_state", states: queueStates(config.state), negate: false });
		}
	}
	return {
		id: record.id,
		botId: record.botId,
		name: record.name,
		enabled: record.enabled,
		priority: record.priority,
		trigger,
		conditions,
		actions: record.actions.map(normalizeAction),
		stopProcessing: record.stopProcessing,
		version: record.version,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

function normalizeAction(node: RuleRecord["actions"][number]): RuleAction {
	const config = node.config;
	if (node.type === "reply_text") return { type: "reply_text", text: text(config.text, "") };
	if (node.type === "send_text") {
		const targetId = text(config.targetId, "");
		return { type: "send_text", text: text(config.text, ""), target: targetId ? { mode: "target", targetId } : { mode: "event" } };
	}
	if (node.type === "queue_join") return { type: "queue_join" };
	if (node.type === "queue_status") return { type: "queue_status" };
	if (node.type === "queue_cancel") return { type: "queue_cancel" };
	if (node.type === "queue_next" || node.type === "queue_call_next") return { type: "queue_next", requireOperator: true };
	if (node.type === "set_variable") return {
		type: "set_variable",
		name: text(config.name ?? config.key, "state_value").replace(/[^A-Za-z0-9_]/g, "_"),
		value: text(config.value, ""),
	};
	if (node.type === "webhook") return {
		type: "webhook",
		endpointId: entityId(text(config.endpointId, "missing_endpoint")),
		method: webhookMethod(config.method),
	};
	if (node.type === "delay") return {
		type: "delay",
		durationMs: Math.max(1, Math.min(30_000, number(config.durationMs, number(config.milliseconds, 500)))),
	};
	return { type: "stop_processing" };
}

function actorTicket(store: MemoryStore, event: NormalizedEvent) {
	if (!("actor" in event) || !event.actor || !event.target) return undefined;
	return store.listTickets(event.botId).find((ticket) =>
		ticket.targetId === event.target?.id && ticket.userId === event.actor?.id && ["waiting", "called"].includes(ticket.status)
	);
}

function eventTarget(target: TargetRecord) {
	return { id: target.id, adapterTargetId: target.externalId, type: target.type, name: target.name };
}

function entityId(value: string): string {
	const safe = value.trim().replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 128);
	return /^[A-Za-z0-9]/.test(safe) ? safe : `id_${safe || crypto.randomUUID()}`;
}

function text(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function boolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function textOperator(value: unknown): "exact" | "prefix" | "contains" | "regex" {
	return value === "exact" || value === "prefix" || value === "regex" ? value : "contains";
}

function role(value: unknown): "admin" | "operator" | "member" | "unknown" {
	return value === "admin" || value === "operator" || value === "member" ? value : "unknown";
}

function cooldownScope(value: unknown): "bot" | "target" | "user" {
	return value === "bot" || value === "target" ? value : "user";
}

function queueStates(value: unknown): Array<"open" | "paused" | "closed"> {
	return [value === "paused" || value === "closed" ? value : "open"];
}

function webhookMethod(value: unknown): "POST" | "PUT" | "PATCH" {
	return value === "PUT" || value === "PATCH" ? value : "POST";
}

function jsonObject(value: unknown): Record<string, string | number | boolean | null | Record<string, never>> {
	if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, never>;
	return { value: typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null ? value : String(value) };
}

function readWebhookEndpoints(): Readonly<Record<string, string>> {
	try {
		const raw = process.env.WEBHOOK_ENDPOINTS_JSON;
		if (!raw) return {};
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return Object.fromEntries(Object.entries(parsed).filter(([, value]) => {
			if (typeof value !== "string") return false;
			try {
				const url = new URL(value);
				return url.protocol === "https:" || (process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname));
			} catch {
				return false;
			}
		})) as Record<string, string>;
	} catch {
		return {};
	}
}

function cronMatches(cron: string, date: Date, timezone: string): boolean {
	const fields = cron.trim().split(/\s+/);
	if (fields.length !== 5) return false;
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			minute: "2-digit",
			hour: "2-digit",
			day: "2-digit",
			month: "2-digit",
			weekday: "short",
			hourCycle: "h23",
		}).formatToParts(date);
		const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
		const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(values.weekday ?? "");
		return cronField(fields[0]!, Number(values.minute), 0, 59) &&
			cronField(fields[1]!, Number(values.hour), 0, 23) &&
			cronField(fields[2]!, Number(values.day), 1, 31) &&
			cronField(fields[3]!, Number(values.month), 1, 12) &&
			cronField(fields[4]!, weekday, 0, 6);
	} catch {
		return false;
	}
}

function cronField(field: string, value: number, min: number, max: number): boolean {
	return field.split(",").some((part) => {
		if (part === "*") return true;
		if (part.startsWith("*/")) {
			const step = Number(part.slice(2));
			return Number.isInteger(step) && step > 0 && (value - min) % step === 0;
		}
		const expected = Number(part);
		return Number.isInteger(expected) && expected >= min && expected <= max && expected === value;
	});
}
