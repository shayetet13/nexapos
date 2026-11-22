import { z } from "zod";
import { EntityIdSchema, IsoDateTimeSchema } from "./common.ts";

export const QueueStatusSchema = z.enum(["open", "paused", "closed"]);
export type QueueStatus = z.infer<typeof QueueStatusSchema>;

export const QueueTicketStatusSchema = z.enum([
	"waiting",
	"called",
	"completed",
	"cancelled",
	"no_show",
]);
export type QueueTicketStatus = z.infer<typeof QueueTicketStatusSchema>;

export const QueueDefinitionSchema = z.object({
	id: EntityIdSchema,
	botId: EntityIdSchema,
	targetId: EntityIdSchema,
	name: z.string().trim().min(1).max(120),
	status: QueueStatusSchema,
	nextNumber: z.number().int().positive(),
	resetDaily: z.boolean(),
	version: z.number().int().nonnegative(),
	createdAt: IsoDateTimeSchema,
	updatedAt: IsoDateTimeSchema,
}).strict();
export type QueueDefinition = z.infer<typeof QueueDefinitionSchema>;

export const QueueTicketSchema = z.object({
	id: EntityIdSchema,
	queueId: EntityIdSchema,
	botId: EntityIdSchema,
	targetId: EntityIdSchema,
	userId: z.string().trim().min(1).max(512),
	number: z.number().int().positive(),
	position: z.number().int().positive().optional(),
	status: QueueTicketStatusSchema,
	joinedAt: IsoDateTimeSchema,
	calledAt: IsoDateTimeSchema.optional(),
	completedAt: IsoDateTimeSchema.optional(),
	cancelledAt: IsoDateTimeSchema.optional(),
}).strict();
export type QueueTicket = z.infer<typeof QueueTicketSchema>;

export const QueueStateSnapshotSchema = z.object({
	queueId: EntityIdSchema,
	botId: EntityIdSchema,
	targetId: EntityIdSchema,
	status: QueueStatusSchema,
	waitingCount: z.number().int().nonnegative(),
	currentTicket: QueueTicketSchema.optional(),
	nextNumber: z.number().int().positive(),
	observedAt: IsoDateTimeSchema,
}).strict();
export type QueueStateSnapshot = z.infer<typeof QueueStateSnapshotSchema>;

export const QueueJoinInputSchema = z.object({
	userId: z.string().trim().min(1).max(512),
	idempotencyKey: z.string().trim().min(1).max(200),
}).strict();
export type QueueJoinInput = z.infer<typeof QueueJoinInputSchema>;

export const QueueControlCommandSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("open") }).strict(),
	z.object({ action: z.literal("pause") }).strict(),
	z.object({ action: z.literal("close") }).strict(),
	z.object({ action: z.literal("call_next") }).strict(),
	z.object({
		action: z.literal("complete"),
		ticketId: EntityIdSchema,
	}).strict(),
	z.object({
		action: z.literal("cancel"),
		ticketId: EntityIdSchema,
	}).strict(),
]);
export type QueueControlCommand = z.infer<typeof QueueControlCommandSchema>;
