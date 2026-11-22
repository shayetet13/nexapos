import { describe, expect, it } from "vitest";
import {
	InMemoryCooldownStore,
	renderJsonTemplate,
	renderTemplate,
	RuleEngine,
	RuleEngineValidationError,
} from "../src/index.ts";

const timestamp = "2026-07-22T10:00:00.000+07:00";

function messageEvent(overrides: Record<string, unknown> = {}) {
	return {
		id: "evt-1",
		botId: "bot-1",
		adapterType: "official",
		type: "message_received",
		occurredAt: timestamp,
		receivedAt: timestamp,
		target: {
			id: "target-1",
			adapterTargetId: "line-group-1",
			type: "group",
			name: "Support",
		},
		actor: { id: "user-1", displayName: "Alice", role: "member" },
		message: { id: "message-1", text: "  HELLO team  ", replyToken: "reply" },
		...overrides,
	};
}

function rule(
	id: string,
	priority: number,
	overrides: Record<string, unknown> = {},
) {
	return {
		id,
		botId: "bot-1",
		name: id,
		enabled: true,
		priority,
		trigger: { type: "message_received" },
		conditions: [],
		actions: [{ type: "reply_text", text: `${id}: {{user.displayName}}` }],
		stopProcessing: true,
		version: 1,
		createdAt: timestamp,
		updatedAt: timestamp,
		...overrides,
	};
}

describe("RuleEngine", () => {
	it("runs higher priorities first, renders variables, and stops", async () => {
		const result = await new RuleEngine().evaluate(messageEvent(), [
			rule("low", 1),
			rule("high", 100),
		], { dryRun: true });

		expect(result.matchedRuleIds).toEqual(["high"]);
		expect(result.actionPlans).toHaveLength(1);
		expect(result.actionPlans[0]?.action).toMatchObject({
			type: "reply_text",
			text: "high: Alice",
		});
		expect(result.stopped).toBe(true);
	});

	it("continues through multiple matching rules when configured", async () => {
		const result = await new RuleEngine().evaluate(messageEvent(), [
			rule("low", 1),
			rule("high", 100, { stopProcessing: false }),
		], { dryRun: true });
		expect(result.matchedRuleIds).toEqual(["high", "low"]);
	});

	it("evaluates target, normalized text, user, and queue conditions", async () => {
		const result = await new RuleEngine().evaluate(messageEvent(), [
			rule("filtered", 10, {
				conditions: [
					{
						type: "target",
						operator: "in",
						targetIds: ["target-1"],
						targetTypes: ["group"],
					},
					{
						type: "text",
						operator: "prefix",
						value: "hello",
					},
					{
						type: "user",
						operator: "in",
						userIds: ["user-1"],
						roles: ["member"],
					},
					{
						type: "queue_state",
						queueId: "queue-1",
						states: ["open"],
					},
				],
			}),
		], {
			dryRun: true,
			queueStates: { "queue-1": "open" },
		});
		expect(result.matchedRuleIds).toEqual(["filtered"]);
	});

	it("rejects unsafe regular expressions without executing them", async () => {
		const result = await new RuleEngine().evaluate(messageEvent(), [
			rule("regex", 10, {
				conditions: [{
					type: "text",
					operator: "regex",
					value: "(a+)+$",
				}],
			}),
		], { dryRun: true });
		expect(result.matchedRuleIds).toEqual([]);
		expect(result.diagnostics[0]?.code).toBe("unsafe_regex");
	});

	it("atomically gates repeated events with cooldown", async () => {
		const store = new InMemoryCooldownStore();
		const cooldownRule = rule("cooldown", 10, {
			conditions: [{
				type: "cooldown",
				scope: "user",
				durationMs: 1_000,
			}],
		});
		const engine = new RuleEngine();
		const first = await engine.evaluate(messageEvent(), [cooldownRule], {
			cooldownStore: store,
			now: new Date(1_000),
		});
		const blocked = await engine.evaluate(
			messageEvent({ id: "evt-2" }),
			[cooldownRule],
			{ cooldownStore: store, now: new Date(1_500) },
		);
		const expired = await engine.evaluate(
			messageEvent({ id: "evt-3" }),
			[cooldownRule],
			{ cooldownStore: store, now: new Date(2_001) },
		);
		expect(first.matchedRuleIds).toEqual(["cooldown"]);
		expect(blocked.matchedRuleIds).toEqual([]);
		expect(expired.matchedRuleIds).toEqual(["cooldown"]);
	});

	it("handles overnight time windows using the configured timezone", async () => {
		const overnight = rule("overnight", 10, {
			conditions: [{
				type: "time_window",
				timezone: "Asia/Bangkok",
				daysOfWeek: [1],
				start: "22:00",
				end: "02:00",
			}],
		});
		const mondayLate = await new RuleEngine().evaluate(messageEvent({
			occurredAt: "2026-07-20T23:00:00.000+07:00",
		}), [overnight], { dryRun: true });
		const tuesdayEarly = await new RuleEngine().evaluate(messageEvent({
			id: "evt-2",
			occurredAt: "2026-07-21T01:00:00.000+07:00",
		}), [overnight], { dryRun: true });
		expect(mondayLate.matchedRuleIds).toEqual(["overnight"]);
		expect(tuesdayEarly.matchedRuleIds).toEqual(["overnight"]);
	});

	it("keeps future action-output variables deferred", async () => {
		const deferredRule = rule("queue", 10, {
			actions: [
				{ type: "queue_join" },
				{ type: "reply_text", text: "Queue {{variables.queueNumber}}" },
			],
		});
		const result = await new RuleEngine().evaluate(messageEvent(), [deferredRule], {
			dryRun: true,
		});
		expect(result.actionPlans[1]?.ready).toBe(true);
		expect(result.actionPlans[1]?.deferredVariables).toEqual([
			"variables.queueNumber",
		]);
	});

	it("throws a structured validation error for malformed events", async () => {
		await expect(new RuleEngine().evaluate({ type: "message_received" }, []))
			.rejects.toBeInstanceOf(RuleEngineValidationError);
	});
});

describe("safe templates", () => {
	it("does not traverse constructors or invoke getters", () => {
		let getterCalls = 0;
		const secretHolder = Object.defineProperty({}, "secret", {
			get() {
				getterCalls++;
				return "leaked";
			},
		});
		const result = renderTemplate(
			"{{variables.secret}} {{constructor.constructor}}",
			{ variables: secretHolder },
		);
		expect(getterCalls).toBe(0);
		expect(result.value).toContain("{{variables.secret}}");
		expect(result.issues.map((issue) => issue.code)).toEqual([
			"missing_variable",
			"invalid_path",
		]);
	});

	it("preserves JSON types for exact placeholders", () => {
		const result = renderJsonTemplate(
			{ count: "{{variables.count}}", label: "#{{variables.count}}" },
			{ variables: { count: 42 } },
		);
		expect(result.value).toEqual({ count: 42, label: "#42" });
	});
});
