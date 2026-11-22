import { z } from "zod";
import {
	EntityIdSchema,
	IsoDateTimeSchema,
	JsonObjectSchema,
} from "./common.ts";

export const AdapterTypeSchema = z.enum(["official", "linejs"]);
export type AdapterType = z.infer<typeof AdapterTypeSchema>;

export const AdapterCapabilitiesSchema = z.object({
	canReply: z.boolean(),
	canPush: z.boolean(),
	canListTargets: z.boolean(),
	supportsGroupChats: z.boolean(),
	supportsOpenChat: z.boolean(),
	supportsJoinEvents: z.boolean(),
}).strict();
export type AdapterCapabilities = z.infer<typeof AdapterCapabilitiesSchema>;

export const AdapterHealthSchema = z.object({
	adapterType: AdapterTypeSchema,
	connected: z.boolean(),
	authenticated: z.boolean(),
	checkedAt: IsoDateTimeSchema,
	lastConnectedAt: IsoDateTimeSchema.optional(),
	lastEventAt: IsoDateTimeSchema.optional(),
	lastErrorCode: z.string().trim().min(1).max(100).optional(),
	metadata: JsonObjectSchema.default({}),
}).strict();
export type AdapterHealth = z.infer<typeof AdapterHealthSchema>;

export const SendTextRequestSchema = z.object({
	botId: EntityIdSchema,
	targetId: EntityIdSchema,
	text: z.string().min(1).max(5_000),
	replyToken: z.string().min(1).max(2_048).optional(),
	idempotencyKey: z.string().trim().min(1).max(200),
}).strict();
export type SendTextRequest = z.infer<typeof SendTextRequestSchema>;

export const SendTextResultSchema = z.object({
	deliveryId: EntityIdSchema,
	adapterMessageId: z.string().trim().min(1).max(256).optional(),
	acceptedAt: IsoDateTimeSchema,
}).strict();
export type SendTextResult = z.infer<typeof SendTextResultSchema>;
