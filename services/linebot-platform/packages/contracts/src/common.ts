import { z } from "zod";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number().finite(),
		z.boolean(),
		z.null(),
		z.array(JsonValueSchema),
		z.record(z.string(), JsonValueSchema),
	])
);

export const JsonObjectSchema: z.ZodType<JsonObject> = z.record(
	z.string(),
	JsonValueSchema,
);

/** IDs are opaque, URL-safe values. They may be UUIDs, ULIDs, or test IDs. */
export const EntityIdSchema = z.string().trim().min(1).max(128).regex(
	/^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
	"must be an opaque URL-safe identifier",
);

export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export const TimeZoneSchema = z.string().trim().min(1).max(100);

export const AuditFieldsSchema = z.object({
	createdAt: IsoDateTimeSchema,
	updatedAt: IsoDateTimeSchema,
}).strict();

export type AuditFields = z.infer<typeof AuditFieldsSchema>;
