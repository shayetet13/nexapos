import {
	NormalizedEventSchema,
	RuleDefinitionSchema,
} from "@linebot/contracts";
import type {
	NormalizedEvent,
	QueueStatus,
	RuleAction,
	RuleCondition,
	RuleDefinition,
	RuleTrigger,
} from "@linebot/contracts";
import type { CooldownRequest } from "./cooldown.ts";
import { compileSafeRegex } from "./safe-regex.ts";
import {
	createEventTemplateContext,
	renderJsonTemplate,
	renderTemplate,
} from "./template.ts";
import type { TemplateIssue } from "./template.ts";
import {
	RuleEngineValidationError,
	type ActionPlan,
	type RuleEngineDiagnostic,
	type RuleEvaluationContext,
	type RuleEvaluationResult,
} from "./types.ts";

interface ConditionEvaluation {
	matched: boolean;
	diagnostic?: RuleEngineDiagnostic;
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
	Sun: 0,
	Mon: 1,
	Tue: 2,
	Wed: 3,
	Thu: 4,
	Fri: 5,
	Sat: 6,
};

function triggerMatches(trigger: RuleTrigger, event: NormalizedEvent): boolean {
	if (trigger.type !== event.type) return false;
	switch (trigger.type) {
		case "schedule":
			return event.type === "schedule" &&
				event.scheduleKey === trigger.scheduleKey;
		case "external_event":
			return event.type === "external_event" &&
				event.eventKey === trigger.eventKey;
		case "queue_state_changed":
			return event.type === "queue_state_changed" &&
				(trigger.toStates === undefined ||
					trigger.toStates.includes(event.queue.status));
		default:
			return true;
	}
}

function normalizedText(value: string, trim: boolean, caseSensitive: boolean) {
	const normalized = trim ? value.trim().normalize("NFKC") : value.normalize("NFKC");
	return caseSensitive ? normalized : normalized.toLowerCase();
}

function eventActors(event: NormalizedEvent) {
	if (event.type === "member_joined") return event.members;
	if ("actor" in event && event.actor !== undefined) return [event.actor];
	return [];
}

function localTimeParts(
	date: Date,
	timezone: string,
): { weekday: number; minutes: number } | undefined {
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			weekday: "short",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		}).formatToParts(date);
		const values = Object.fromEntries(
			parts.map((part) => [part.type, part.value]),
		);
		const weekday = values.weekday === undefined
			? undefined
			: WEEKDAY_INDEX[values.weekday];
		const hour = Number(values.hour);
		const minute = Number(values.minute);
		if (weekday === undefined || !Number.isInteger(hour) ||
			!Number.isInteger(minute)) return undefined;
		return { weekday, minutes: hour * 60 + minute };
	} catch {
		return undefined;
	}
}

function parseMinutes(value: string): number {
	const [hour = "0", minute = "0"] = value.split(":");
	return Number(hour) * 60 + Number(minute);
}

function inTimeWindow(
	condition: Extract<RuleCondition, { type: "time_window" }>,
	event: NormalizedEvent,
): ConditionEvaluation {
	const local = localTimeParts(new Date(event.occurredAt), condition.timezone);
	if (local === undefined) {
		return {
			matched: false,
			diagnostic: {
				code: "invalid_timezone",
				message: `Timezone '${condition.timezone}' is not supported`,
			},
		};
	}
	const start = parseMinutes(condition.start);
	const end = parseMinutes(condition.end);
	if (start <= end) {
		return {
			matched: condition.daysOfWeek.includes(local.weekday) &&
				local.minutes >= start && local.minutes <= end,
		};
	}
	const previousWeekday = (local.weekday + 6) % 7;
	return {
		matched: (condition.daysOfWeek.includes(local.weekday) &&
			local.minutes >= start) ||
			(condition.daysOfWeek.includes(previousWeekday) &&
				local.minutes <= end),
	};
}

function resolveQueueStatus(
	condition: Extract<RuleCondition, { type: "queue_state" }>,
	event: NormalizedEvent,
	context: RuleEvaluationContext,
): QueueStatus | undefined {
	const desiredId = condition.queueId;
	if (event.type === "queue_state_changed" &&
		(desiredId === undefined || desiredId === event.queue.id)) {
		return event.queue.status;
	}
	if (context.currentQueue !== undefined &&
		(desiredId === undefined || desiredId === context.currentQueue.queueId)) {
		return context.currentQueue.status;
	}
	if (desiredId === undefined) return undefined;
	const state = context.queueStates?.[desiredId];
	return typeof state === "string" ? state : state?.status;
}

function evaluateNonCooldownCondition(
	condition: Exclude<RuleCondition, { type: "cooldown" }>,
	event: NormalizedEvent,
	context: RuleEvaluationContext,
): ConditionEvaluation {
	let evaluation: ConditionEvaluation;
	switch (condition.type) {
		case "target": {
			if (event.target === undefined) return { matched: false };
			const inSet = condition.targetIds.includes(event.target.id) &&
				(condition.targetTypes === undefined ||
					condition.targetTypes.includes(event.target.type));
			evaluation = {
				matched: condition.operator === "in" ? inSet : !inSet,
			};
			break;
		}
		case "text": {
			if (event.type !== "message_received") return { matched: false };
			if (condition.operator === "regex") {
				const compiled = compileSafeRegex(
					condition.value,
					condition.caseSensitive,
				);
				if (!compiled.safe || compiled.regex === undefined) {
					return {
						matched: false,
						diagnostic: {
							code: "unsafe_regex",
							message: `Regex was rejected (${compiled.reason ?? "unsafe"})`,
						},
					};
				}
				evaluation = { matched: compiled.regex.test(event.message.text) };
				break;
			}
			const actual = normalizedText(
				event.message.text,
				condition.trim,
				condition.caseSensitive,
			);
			const expected = normalizedText(
				condition.value,
				condition.trim,
				condition.caseSensitive,
			);
			evaluation = {
				matched: condition.operator === "exact"
					? actual === expected
					: condition.operator === "prefix"
					? actual.startsWith(expected)
					: actual.includes(expected),
			};
			break;
		}
		case "user": {
			const actors = eventActors(event);
			if (actors.length === 0) return { matched: false };
			const inSet = actors.some((actor) =>
				(condition.userIds === undefined || condition.userIds.includes(actor.id)) &&
				(condition.roles === undefined || condition.roles.includes(actor.role))
			);
			evaluation = {
				matched: condition.operator === "in" ? inSet : !inSet,
			};
			break;
		}
		case "time_window":
			evaluation = inTimeWindow(condition, event);
			break;
		case "queue_state": {
			const status = resolveQueueStatus(condition, event, context);
			if (status === undefined) {
				return {
					matched: false,
					diagnostic: {
						code: "missing_queue_state",
						message: "Queue state was not supplied to the rule engine",
					},
				};
			}
			evaluation = { matched: condition.states.includes(status) };
			break;
		}
	}
	return condition.negate
		? { ...evaluation, matched: !evaluation.matched }
		: evaluation;
}

function cooldownRequest(
	condition: Extract<RuleCondition, { type: "cooldown" }>,
	rule: RuleDefinition,
	event: NormalizedEvent,
): CooldownRequest | undefined {
	const segment = (value: string) => encodeURIComponent(value);
	const prefix = [
		"linebot",
		"cooldown",
		segment(event.botId),
		segment(rule.id),
		segment(condition.key ?? "default"),
	];
	if (condition.scope === "bot") {
		return { key: [...prefix, "bot"].join(":"), durationMs: condition.durationMs };
	}
	if (condition.scope === "target") {
		if (event.target === undefined) return undefined;
		return {
			key: [...prefix, "target", segment(event.target.id)].join(":"),
			durationMs: condition.durationMs,
		};
	}
	const actor = eventActors(event)[0];
	if (actor === undefined) return undefined;
	return {
		key: [...prefix, "user", segment(actor.id)].join(":"),
		durationMs: condition.durationMs,
	};
}

function renderAction(
	action: RuleAction,
	templateContext: Readonly<Record<string, unknown>>,
): { action: RuleAction; issues: TemplateIssue[] } {
	switch (action.type) {
		case "send_text": {
			const rendered = renderTemplate(action.text, templateContext);
			return { action: { ...action, text: rendered.value }, issues: rendered.issues };
		}
		case "reply_text": {
			const rendered = renderTemplate(action.text, templateContext);
			return { action: { ...action, text: rendered.value }, issues: rendered.issues };
		}
		case "set_variable": {
			const rendered = renderTemplate(action.value, templateContext);
			return { action: { ...action, value: rendered.value }, issues: rendered.issues };
		}
		case "webhook": {
			if (action.body === undefined) return { action, issues: [] };
			const rendered = renderJsonTemplate(action.body, templateContext);
			return { action: { ...action, body: rendered.value }, issues: rendered.issues };
		}
		default:
			return { action, issues: [] };
	}
}

function incompatibleActionReason(
	action: RuleAction,
	event: NormalizedEvent,
): string | undefined {
	if (action.type === "reply_text" && event.type !== "message_received") {
		return "reply_text requires a message_received event";
	}
	if (action.type === "send_text" && action.target.mode === "event" &&
		event.target === undefined) {
		return "send_text with event target requires an event target";
	}
	return undefined;
}

function addConditionContext(
	diagnostic: RuleEngineDiagnostic | undefined,
	ruleId: string,
	conditionIndex: number,
): RuleEngineDiagnostic | undefined {
	return diagnostic === undefined
		? undefined
		: { ...diagnostic, ruleId, conditionIndex };
}

export class RuleEngine {
	async evaluate(
		rawEvent: unknown,
		rawRules: readonly unknown[],
		context: RuleEvaluationContext = {},
	): Promise<RuleEvaluationResult> {
		const parsedEvent = NormalizedEventSchema.safeParse(rawEvent);
		if (!parsedEvent.success) {
			throw new RuleEngineValidationError(
				"Normalized event validation failed",
				parsedEvent.error.issues.map((issue) => ({
					path: issue.path,
					message: issue.message,
				})),
			);
		}
		const event = parsedEvent.data;
		const diagnostics: RuleEngineDiagnostic[] = [];
		const rules: RuleDefinition[] = [];
		for (const rawRule of rawRules) {
			const parsedRule = RuleDefinitionSchema.safeParse(rawRule);
			if (!parsedRule.success) {
				for (const issue of parsedRule.error.issues) {
					diagnostics.push({
						code: "invalid_rule",
						message: issue.message,
						path: issue.path,
					});
				}
				continue;
			}
			if (parsedRule.data.botId === event.botId && parsedRule.data.enabled) {
				rules.push(parsedRule.data);
			}
		}
		rules.sort((left, right) =>
			right.priority - left.priority || left.id.localeCompare(right.id)
		);

		const matchedRuleIds: string[] = [];
		const actionPlans: ActionPlan[] = [];
		let stopped = false;
		for (const rule of rules) {
			if (!triggerMatches(rule.trigger, event)) continue;
			let conditionsMatch = true;
			for (let index = 0; index < rule.conditions.length; index++) {
				const condition = rule.conditions[index];
				if (condition === undefined || condition.type === "cooldown") continue;
				const result = evaluateNonCooldownCondition(condition, event, context);
				const diagnostic = addConditionContext(result.diagnostic, rule.id, index);
				if (diagnostic !== undefined) diagnostics.push(diagnostic);
				if (!result.matched) {
					conditionsMatch = false;
					break;
				}
			}
			if (!conditionsMatch) continue;

			const cooldowns: CooldownRequest[] = [];
			for (let index = 0; index < rule.conditions.length; index++) {
				const condition = rule.conditions[index];
				if (condition?.type !== "cooldown") continue;
				const request = cooldownRequest(condition, rule, event);
				if (request === undefined) {
					diagnostics.push({
						code: "missing_cooldown_scope",
						message: `Event has no ${condition.scope} value for cooldown`,
						ruleId: rule.id,
						conditionIndex: index,
					});
					conditionsMatch = false;
					break;
				}
				cooldowns.push(request);
			}
			if (!conditionsMatch) continue;
			if (cooldowns.length > 0) {
				if (context.cooldownStore === undefined) {
					if (!context.dryRun) {
						diagnostics.push({
							code: "cooldown_store_missing",
							message: "A cooldown store is required for live evaluation",
							ruleId: rule.id,
						});
						continue;
					}
				} else {
					try {
						const acquired = await context.cooldownStore.tryAcquire(
							cooldowns,
							context.now?.getTime() ?? Date.now(),
							{ commit: !context.dryRun },
						);
						if (!acquired) continue;
					} catch (error) {
						diagnostics.push({
							code: "cooldown_store_error",
							message: error instanceof Error
								? error.message
								: "Cooldown store failed",
							ruleId: rule.id,
						});
						continue;
					}
				}
			}

			matchedRuleIds.push(rule.id);
			const templateContext = createEventTemplateContext(
				event,
				context.variables,
			);
			let stopFromAction = false;
			for (let actionIndex = 0; actionIndex < rule.actions.length; actionIndex++) {
				const action = rule.actions[actionIndex];
				if (action === undefined) continue;
				if (action.type === "stop_processing") {
					stopFromAction = true;
					continue;
				}
				const rendered = renderAction(action, templateContext);
				const incompatible = incompatibleActionReason(rendered.action, event);
				const invalidTemplate = rendered.issues.some((issue) =>
					issue.code === "invalid_path" || issue.code === "unsupported_value"
				);
				if (incompatible !== undefined) {
					diagnostics.push({
						code: "incompatible_action",
						message: incompatible,
						ruleId: rule.id,
						actionIndex,
					});
				}
				if (invalidTemplate) {
					diagnostics.push({
						code: "invalid_template",
						message: "Action contains an invalid template expression",
						ruleId: rule.id,
						actionIndex,
					});
				}
				actionPlans.push({
					botId: event.botId,
					ruleId: rule.id,
					ruleName: rule.name,
					priority: rule.priority,
					actionIndex,
					action: rendered.action,
					ready: incompatible === undefined && !invalidTemplate,
					deferredVariables: rendered.issues
						.filter((issue) => issue.code === "missing_variable")
						.map((issue) => issue.path),
					templateIssues: rendered.issues,
				});
			}
			if (rule.stopProcessing || stopFromAction) {
				stopped = true;
				break;
			}
		}

		return { event, matchedRuleIds, actionPlans, stopped, diagnostics };
	}
}

export async function evaluateRules(
	event: unknown,
	rules: readonly unknown[],
	context: RuleEvaluationContext = {},
): Promise<RuleEvaluationResult> {
	return await new RuleEngine().evaluate(event, rules, context);
}
