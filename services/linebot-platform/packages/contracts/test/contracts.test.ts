import { describe, expect, it } from "vitest";
import {
	BotSettingsSchema,
	ControlCommandSchema,
	createApiEnvelopeSchema,
	FirstResponseMetricsSchema,
	NormalizedEventSchema,
	RuleDefinitionSchema,
} from "../src/index.ts";
import { z } from "zod";

const timestamp = "2026-07-22T10:00:00.000+07:00";

describe("shared contracts", () => {
	it("applies safe bot defaults and requires custom rate settings", () => {
		expect(BotSettingsSchema.parse({})).toMatchObject({
			timezone: "Asia/Bangkok",
			speedProfile: "balanced",
			firstResponseWindowMs: 5_000,
		});
		expect(() => BotSettingsSchema.parse({ speedProfile: "custom" })).toThrow();
	});

	it("parses a normalized message event and rejects unknown fields", () => {
		const event = {
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
			},
			actor: { id: "user-1" },
			message: { id: "message-1", text: "hello" },
		};
		const parsed = NormalizedEventSchema.parse(event);
		expect(parsed.type).toBe("message_received");
		if (parsed.type !== "message_received") throw new Error("unexpected event");
		expect(parsed.actor.role).toBe("unknown");
		expect(NormalizedEventSchema.safeParse({ ...event, secret: "leak" }).success)
			.toBe(false);
	});

	it("accepts admin-composed rules and rejects raw webhook URLs", () => {
		const baseRule = {
			id: "rule-1",
			botId: "bot-1",
			name: "greeting",
			enabled: true,
			priority: 100,
			trigger: { type: "message_received" },
			conditions: [],
			actions: [{ type: "reply_text", text: "Hi {{user.displayName}}" }],
			version: 1,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		expect(RuleDefinitionSchema.parse(baseRule).stopProcessing).toBe(true);
		expect(RuleDefinitionSchema.safeParse({
			...baseRule,
			actions: [{ type: "webhook", url: "http://127.0.0.1" }],
		}).success).toBe(false);
	});

	it("validates lifecycle commands", () => {
		const command = ControlCommandSchema.parse({
			action: "stop",
			mode: "graceful",
		});
		expect(command.action).toBe("stop");
		if (command.action !== "stop" || command.mode !== "graceful") {
			throw new Error("unexpected command");
		}
		expect(command.drainTimeoutMs).toBe(30_000);
		expect(ControlCommandSchema.safeParse({
			action: "stop",
			mode: "immediate",
			drainTimeoutMs: 10,
		}).success).toBe(false);
	});

	it("enforces first-response metric invariants", () => {
		const latency = { count: 2, p50Ms: 20, p95Ms: 40, p99Ms: 50 };
		expect(FirstResponseMetricsSchema.safeParse({
			attempted: 3,
			wins: 2,
			losses: 0,
			unknown: 1,
			winRate: 1,
			latency,
		}).success).toBe(true);
		expect(FirstResponseMetricsSchema.safeParse({
			attempted: 3,
			wins: 2,
			losses: 0,
			unknown: 0,
			winRate: 1,
			latency,
		}).success).toBe(false);
	});

	it("builds success-or-error API envelopes", () => {
		const schema = createApiEnvelopeSchema(z.object({ ok: z.boolean() }));
		expect(schema.safeParse({
			data: { ok: true },
			meta: null,
			error: null,
			requestId: "request-1",
		}).success).toBe(true);
		expect(schema.safeParse({
			data: { ok: true },
			meta: null,
			error: { code: "bad", message: "bad" },
			requestId: "request-1",
		}).success).toBe(false);
	});
});
