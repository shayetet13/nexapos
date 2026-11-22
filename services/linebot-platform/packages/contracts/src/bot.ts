import { z } from "zod";
import { AdapterTypeSchema } from "./adapter.ts";
import {
	EntityIdSchema,
	IsoDateTimeSchema,
	JsonObjectSchema,
	TimeZoneSchema,
} from "./common.ts";

export const BotStatusSchema = z.enum([
	"provisioning",
	"auth_required",
	"starting",
	"online",
	"degraded",
	"paused",
	"stopping",
	"stopped",
	"error",
]);
export type BotStatus = z.infer<typeof BotStatusSchema>;

export const SpeedProfileSchema = z.enum([
	"safe",
	"balanced",
	"max_compliant",
	"custom",
]);
export type SpeedProfile = z.infer<typeof SpeedProfileSchema>;

export const CustomRateLimitSchema = z.object({
	messagesPerSecond: z.number().positive().max(1_000),
	burst: z.number().int().positive().max(10_000),
	queueLimit: z.number().int().positive().max(1_000_000),
}).strict();
export type CustomRateLimit = z.infer<typeof CustomRateLimitSchema>;

export const BotSettingsSchema = z.object({
	timezone: TimeZoneSchema.default("Asia/Bangkok"),
	speedProfile: SpeedProfileSchema.default("balanced"),
	customRateLimit: CustomRateLimitSchema.optional(),
	firstResponseWindowMs: z.number().int().min(1_000).max(30_000).default(5_000),
	autoRestartOnCrash: z.boolean().default(true),
}).strict().superRefine((value, context) => {
	if (value.speedProfile === "custom" && value.customRateLimit === undefined) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["customRateLimit"],
			message: "customRateLimit is required for the custom speed profile",
		});
	}
	if (value.speedProfile !== "custom" && value.customRateLimit !== undefined) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["customRateLimit"],
			message: "customRateLimit is only valid for the custom speed profile",
		});
	}
});
export type BotSettings = z.infer<typeof BotSettingsSchema>;

export const BotSchema = z.object({
	id: EntityIdSchema,
	name: z.string().trim().min(1).max(120),
	adapterType: AdapterTypeSchema,
	status: BotStatusSchema,
	settings: BotSettingsSchema,
	version: z.number().int().nonnegative(),
	createdAt: IsoDateTimeSchema,
	updatedAt: IsoDateTimeSchema,
}).strict();
export type Bot = z.infer<typeof BotSchema>;

export const BotCreateInputSchema = z.object({
	name: z.string().trim().min(1).max(120),
	adapterType: AdapterTypeSchema,
	settings: BotSettingsSchema.optional(),
}).strict();
export type BotCreateInput = z.infer<typeof BotCreateInputSchema>;

export const BotUpdateInputSchema = z.object({
	name: z.string().trim().min(1).max(120).optional(),
	settings: BotSettingsSchema.optional(),
	expectedVersion: z.number().int().nonnegative(),
}).strict();
export type BotUpdateInput = z.infer<typeof BotUpdateInputSchema>;

/** Write-only DTO; never include these fields in Bot/API read responses. */
export const OfficialAdapterCredentialsInputSchema = z.object({
	adapterType: z.literal("official"),
	channelAccessToken: z.string().min(20).max(8_192),
	channelSecret: z.string().min(8).max(1_024),
}).strict();

/** Optional token import is intended for controlled local migration only. */
export const LineJsAdapterCredentialsInputSchema = z.object({
	adapterType: z.literal("linejs"),
	authToken: z.string().min(20).max(8_192),
}).strict();

export const AdapterCredentialsInputSchema = z.discriminatedUnion("adapterType", [
	OfficialAdapterCredentialsInputSchema,
	LineJsAdapterCredentialsInputSchema,
]);
export type AdapterCredentialsInput = z.infer<
	typeof AdapterCredentialsInputSchema
>;

export const BotStatusSnapshotSchema = z.object({
	botId: EntityIdSchema,
	status: BotStatusSchema,
	observedAt: IsoDateTimeSchema,
	lastHeartbeatAt: IsoDateTimeSchema.optional(),
	uptimeSeconds: z.number().nonnegative(),
	restartCount: z.number().int().nonnegative(),
	reasonCode: z.string().trim().min(1).max(100).optional(),
	details: JsonObjectSchema.default({}),
}).strict();
export type BotStatusSnapshot = z.infer<typeof BotStatusSnapshotSchema>;
