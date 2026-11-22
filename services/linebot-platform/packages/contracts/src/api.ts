import { z } from "zod";
import { EntityIdSchema, JsonObjectSchema } from "./common.ts";

export const ApiErrorSchema = z.object({
	code: z.string().trim().min(1).max(100),
	message: z.string().trim().min(1).max(1_000),
	details: JsonObjectSchema.optional(),
}).strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiMetaSchema = z.object({
	nextCursor: z.string().min(1).max(2_048).optional(),
	total: z.number().int().nonnegative().optional(),
}).strict().catchall(z.unknown());
export type ApiMeta = z.infer<typeof ApiMetaSchema>;

export interface ApiEnvelope<T> {
	data: T | null;
	meta: ApiMeta | null;
	error: ApiError | null;
	requestId: string;
}

export function createApiEnvelopeSchema<TSchema extends z.ZodTypeAny>(
	dataSchema: TSchema,
): z.ZodType<ApiEnvelope<z.output<TSchema>>> {
	return z.object({
		data: dataSchema.nullable(),
		meta: ApiMetaSchema.nullable().default(null),
		error: ApiErrorSchema.nullable(),
		requestId: EntityIdSchema,
	}).strict().superRefine((value, context) => {
		const hasData = value.data !== null;
		const hasError = value.error !== null;
		if (hasData === hasError) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "exactly one of data or error must be present",
			});
		}
	}) as z.ZodType<ApiEnvelope<z.output<TSchema>>>;
}

export const PaginationQuerySchema = z.object({
	cursor: z.string().min(1).max(2_048).optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export const IdempotencyKeySchema = z.string().trim().min(1).max(200);
