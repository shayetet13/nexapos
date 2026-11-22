import { z } from "zod";
import { AdapterTypeSchema } from "./adapter.ts";
import {
	EntityIdSchema,
	IsoDateTimeSchema,
	JsonObjectSchema,
} from "./common.ts";
import { QueueStatusSchema } from "./queue.ts";
import { TargetTypeSchema } from "./target.ts";

export const EventTargetSchema = z.object({
	id: EntityIdSchema,
	adapterTargetId: z.string().trim().min(1).max(512),
	type: TargetTypeSchema,
	name: z.string().trim().min(1).max(200).optional(),
}).strict();
export type EventTarget = z.infer<typeof EventTargetSchema>;

export const EventActorSchema = z.object({
	id: z.string().trim().min(1).max(512),
	displayName: z.string().trim().min(1).max(200).optional(),
	role: z.enum(["admin", "operator", "member", "unknown"]).default("unknown"),
}).strict();
export type EventActor = z.infer<typeof EventActorSchema>;

const eventBaseShape = {
	id: EntityIdSchema,
	botId: EntityIdSchema,
	adapterType: AdapterTypeSchema,
	occurredAt: IsoDateTimeSchema,
	receivedAt: IsoDateTimeSchema,
	correlationId: EntityIdSchema.optional(),
	metadata: JsonObjectSchema.default({}),
};

export const MessageReceivedEventSchema = z.object({
	...eventBaseShape,
	type: z.literal("message_received"),
	target: EventTargetSchema,
	actor: EventActorSchema,
	message: z.object({
		id: z.string().trim().min(1).max(512),
		text: z.string().max(20_000),
		replyToken: z.string().min(1).max(2_048).optional(),
	}).strict(),
}).strict();

export const MemberJoinedEventSchema = z.object({
	...eventBaseShape,
	type: z.literal("member_joined"),
	target: EventTargetSchema,
	members: z.array(EventActorSchema).min(1).max(100),
}).strict();

export const ScheduleEventSchema = z.object({
	...eventBaseShape,
	type: z.literal("schedule"),
	scheduleKey: EntityIdSchema,
	target: EventTargetSchema.optional(),
}).strict();

export const ExternalEventSchema = z.object({
	...eventBaseShape,
	type: z.literal("external_event"),
	eventKey: EntityIdSchema,
	payload: JsonObjectSchema.default({}),
	target: EventTargetSchema.optional(),
	actor: EventActorSchema.optional(),
}).strict();

export const QueueStateChangedEventSchema = z.object({
	...eventBaseShape,
	type: z.literal("queue_state_changed"),
	target: EventTargetSchema,
	actor: EventActorSchema.optional(),
	queue: z.object({
		id: EntityIdSchema,
		previousStatus: QueueStatusSchema,
		status: QueueStatusSchema,
		waitingCount: z.number().int().nonnegative(),
	}).strict(),
}).strict();

export const NormalizedEventSchema = z.discriminatedUnion("type", [
	MessageReceivedEventSchema,
	MemberJoinedEventSchema,
	ScheduleEventSchema,
	ExternalEventSchema,
	QueueStateChangedEventSchema,
]);
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;
