import { z } from "zod";
import { BotStatusSchema } from "./bot.ts";
import { EntityIdSchema, IsoDateTimeSchema } from "./common.ts";

export const LoadLevelSchema = z.enum(["low", "medium", "high"]);
export type LoadLevel = z.infer<typeof LoadLevelSchema>;

export const LatencyDistributionSchema = z.object({
	count: z.number().int().nonnegative(),
	p50Ms: z.number().nonnegative(),
	p95Ms: z.number().nonnegative(),
	p99Ms: z.number().nonnegative(),
}).strict().refine(
	(value) => value.p50Ms <= value.p95Ms && value.p95Ms <= value.p99Ms,
	{ message: "latency percentiles must be monotonic" },
);
export type LatencyDistribution = z.infer<typeof LatencyDistributionSchema>;

export const FirstResponseMetricsSchema = z.object({
	attempted: z.number().int().nonnegative(),
	wins: z.number().int().nonnegative(),
	losses: z.number().int().nonnegative(),
	unknown: z.number().int().nonnegative(),
	winRate: z.number().min(0).max(1),
	latency: LatencyDistributionSchema,
}).strict().superRefine((value, context) => {
	if (value.wins + value.losses + value.unknown !== value.attempted) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["attempted"],
			message: "attempted must equal wins + losses + unknown",
		});
	}
	const decided = value.wins + value.losses;
	const expectedRate = decided === 0 ? 0 : value.wins / decided;
	if (Math.abs(expectedRate - value.winRate) > 0.000_001) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["winRate"],
			message: "winRate must be wins / (wins + losses)",
		});
	}
});
export type FirstResponseMetrics = z.infer<typeof FirstResponseMetricsSchema>;

export const BotMetricsSchema = z.object({
	botId: EntityIdSchema,
	status: BotStatusSchema,
	windowStartedAt: IsoDateTimeSchema,
	sampledAt: IsoDateTimeSchema,
	messagesReceived: z.number().int().nonnegative(),
	messagesAccepted: z.number().int().nonnegative(),
	messagesSent: z.number().int().nonnegative(),
	messagesFailed: z.number().int().nonnegative(),
	receivedPerSecond: z.number().nonnegative(),
	sentPerSecond: z.number().nonnegative(),
	queueDepth: z.number().int().nonnegative(),
	queueCapacity: z.number().int().positive(),
	errorRate: z.number().min(0).max(1),
	sendLatency: LatencyDistributionSchema,
	responseLatency: LatencyDistributionSchema,
	firstResponse: FirstResponseMetricsSchema,
	resources: z.object({
		cpuPercent: z.number().nonnegative(),
		memoryBytes: z.number().int().nonnegative(),
		uptimeSeconds: z.number().nonnegative(),
		reconnectCount: z.number().int().nonnegative(),
	}).strict(),
	rateUtilization: z.number().min(0).max(1),
	queueUtilization: z.number().min(0).max(1),
	loadLevel: LoadLevelSchema,
}).strict();
export type BotMetrics = z.infer<typeof BotMetricsSchema>;
