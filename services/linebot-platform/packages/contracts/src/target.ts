import { z } from "zod";
import {
	EntityIdSchema,
	IsoDateTimeSchema,
	JsonObjectSchema,
} from "./common.ts";

export const TargetTypeSchema = z.enum(["user", "group", "room", "openchat"]);
export type TargetType = z.infer<typeof TargetTypeSchema>;

export const TargetSchema = z.object({
	id: EntityIdSchema,
	botId: EntityIdSchema,
	adapterTargetId: z.string().trim().min(1).max(512),
	type: TargetTypeSchema,
	name: z.string().trim().min(1).max(200),
	enabled: z.boolean(),
	metadata: JsonObjectSchema.default({}),
	createdAt: IsoDateTimeSchema,
	updatedAt: IsoDateTimeSchema,
}).strict();
export type Target = z.infer<typeof TargetSchema>;

export const TargetUpdateInputSchema = z.object({
	enabled: z.boolean().optional(),
	name: z.string().trim().min(1).max(200).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
	message: "at least one field is required",
});
export type TargetUpdateInput = z.infer<typeof TargetUpdateInputSchema>;
