import { z } from "zod";
import {
	EntityIdSchema,
	IsoDateTimeSchema,
	JsonValueSchema,
	TimeZoneSchema,
} from "./common.ts";
import { QueueStatusSchema } from "./queue.ts";
import { TargetTypeSchema } from "./target.ts";

const conditionBaseShape = {
	id: EntityIdSchema.optional(),
	negate: z.boolean().default(false),
};

export const MessageReceivedTriggerSchema = z.object({
	type: z.literal("message_received"),
}).strict();

export const MemberJoinedTriggerSchema = z.object({
	type: z.literal("member_joined"),
}).strict();

export const ScheduleTriggerSchema = z.object({
	type: z.literal("schedule"),
	scheduleKey: EntityIdSchema,
	cron: z.string().trim().min(5).max(200),
	timezone: TimeZoneSchema.default("Asia/Bangkok"),
}).strict();

export const ExternalEventTriggerSchema = z.object({
	type: z.literal("external_event"),
	eventKey: EntityIdSchema,
}).strict();

export const QueueStateChangedTriggerSchema = z.object({
	type: z.literal("queue_state_changed"),
	toStates: z.array(QueueStatusSchema).min(1).optional(),
}).strict();

export const RuleTriggerSchema = z.discriminatedUnion("type", [
	MessageReceivedTriggerSchema,
	MemberJoinedTriggerSchema,
	ScheduleTriggerSchema,
	ExternalEventTriggerSchema,
	QueueStateChangedTriggerSchema,
]);
export type RuleTrigger = z.infer<typeof RuleTriggerSchema>;

export const TargetConditionSchema = z.object({
	...conditionBaseShape,
	type: z.literal("target"),
	operator: z.enum(["in", "not_in"]),
	targetIds: z.array(EntityIdSchema).min(1).max(1_000),
	targetTypes: z.array(TargetTypeSchema).min(1).optional(),
}).strict();

export const TextConditionSchema = z.object({
	...conditionBaseShape,
	type: z.literal("text"),
	operator: z.enum(["exact", "prefix", "contains", "regex"]),
	value: z.string().min(1).max(5_000),
	caseSensitive: z.boolean().default(false),
	trim: z.boolean().default(true),
}).strict();

export const UserConditionSchema = z.object({
	...conditionBaseShape,
	type: z.literal("user"),
	operator: z.enum(["in", "not_in"]),
	/** Omit userIds to filter by role only. */
	userIds: z.array(z.string().trim().min(1).max(512)).min(1).max(10_000)
		.optional(),
	roles: z.array(z.enum(["admin", "operator", "member", "unknown"]))
		.min(1).optional(),
}).strict();

const MinutesSchema = z.string().regex(
	/^(?:[01]\d|2[0-3]):[0-5]\d$/,
	"must use HH:mm in 24-hour time",
);

export const TimeWindowConditionSchema = z.object({
	...conditionBaseShape,
	type: z.literal("time_window"),
	timezone: TimeZoneSchema.default("Asia/Bangkok"),
	daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
	start: MinutesSchema,
	end: MinutesSchema,
}).strict();

export const CooldownConditionSchema = z.object({
	id: EntityIdSchema.optional(),
	negate: z.literal(false).default(false),
	type: z.literal("cooldown"),
	scope: z.enum(["bot", "target", "user"]),
	durationMs: z.number().int().min(100).max(86_400_000),
	key: EntityIdSchema.optional(),
}).strict();

export const QueueStateConditionSchema = z.object({
	...conditionBaseShape,
	type: z.literal("queue_state"),
	queueId: EntityIdSchema.optional(),
	states: z.array(QueueStatusSchema).min(1).max(3),
}).strict();

export const RuleConditionSchema = z.discriminatedUnion("type", [
	TargetConditionSchema,
	TextConditionSchema,
	UserConditionSchema,
	TimeWindowConditionSchema,
	CooldownConditionSchema,
	QueueStateConditionSchema,
]);
export type RuleCondition = z.infer<typeof RuleConditionSchema>;

const actionBaseShape = {
	id: EntityIdSchema.optional(),
};

export const SendTextActionSchema = z.object({
	...actionBaseShape,
	type: z.literal("send_text"),
	text: z.string().min(1).max(5_000),
	target: z.discriminatedUnion("mode", [
		z.object({ mode: z.literal("event") }).strict(),
		z.object({ mode: z.literal("target"), targetId: EntityIdSchema }).strict(),
	]).default({ mode: "event" }),
}).strict();

export const ReplyTextActionSchema = z.object({
	...actionBaseShape,
	type: z.literal("reply_text"),
	text: z.string().min(1).max(5_000),
}).strict();

export const QueueJoinActionSchema = z.object({
	...actionBaseShape,
	type: z.literal("queue_join"),
	queueId: EntityIdSchema.optional(),
}).strict();

export const QueueStatusActionSchema = z.object({
	...actionBaseShape,
	type: z.literal("queue_status"),
	queueId: EntityIdSchema.optional(),
}).strict();

export const QueueCancelActionSchema = z.object({
	...actionBaseShape,
	type: z.literal("queue_cancel"),
	queueId: EntityIdSchema.optional(),
}).strict();

export const QueueNextActionSchema = z.object({
	...actionBaseShape,
	type: z.literal("queue_next"),
	queueId: EntityIdSchema.optional(),
	requireOperator: z.literal(true).default(true),
}).strict();

export const SetVariableActionSchema = z.object({
	...actionBaseShape,
	type: z.literal("set_variable"),
	name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
	value: z.string().max(5_000),
}).strict();

export const WebhookActionSchema = z.object({
	...actionBaseShape,
	type: z.literal("webhook"),
	/** References a server-side allowlisted endpoint; raw URLs are not accepted. */
	endpointId: EntityIdSchema,
	method: z.enum(["POST", "PUT", "PATCH"]).default("POST"),
	body: JsonValueSchema.optional(),
}).strict();

export const DelayActionSchema = z.object({
	...actionBaseShape,
	type: z.literal("delay"),
	durationMs: z.number().int().min(1).max(30_000),
}).strict();

export const StopProcessingActionSchema = z.object({
	...actionBaseShape,
	type: z.literal("stop_processing"),
}).strict();

export const RuleActionSchema = z.discriminatedUnion("type", [
	SendTextActionSchema,
	ReplyTextActionSchema,
	QueueJoinActionSchema,
	QueueStatusActionSchema,
	QueueCancelActionSchema,
	QueueNextActionSchema,
	SetVariableActionSchema,
	WebhookActionSchema,
	DelayActionSchema,
	StopProcessingActionSchema,
]);
export type RuleAction = z.infer<typeof RuleActionSchema>;

export const RuleDefinitionSchema = z.object({
	id: EntityIdSchema,
	botId: EntityIdSchema,
	name: z.string().trim().min(1).max(120),
	enabled: z.boolean(),
	/** Higher values run before lower values. */
	priority: z.number().int().min(-10_000).max(10_000),
	trigger: RuleTriggerSchema,
	conditions: z.array(RuleConditionSchema).max(50).default([]),
	actions: z.array(RuleActionSchema).min(1).max(20),
	stopProcessing: z.boolean().default(true),
	version: z.number().int().nonnegative(),
	createdAt: IsoDateTimeSchema,
	updatedAt: IsoDateTimeSchema,
}).strict();
export type RuleDefinition = z.infer<typeof RuleDefinitionSchema>;

export const RuleCreateInputSchema = RuleDefinitionSchema.omit({
	id: true,
	version: true,
	createdAt: true,
	updatedAt: true,
});
export type RuleCreateInput = z.infer<typeof RuleCreateInputSchema>;

export const RuleUpdateInputSchema = RuleCreateInputSchema.partial().extend({
	expectedVersion: z.number().int().nonnegative(),
}).strict();
export type RuleUpdateInput = z.infer<typeof RuleUpdateInputSchema>;
