import { z } from "zod";

export const ControlCommandSchema = z.union([
	z.object({ action: z.literal("start") }).strict(),
	z.object({ action: z.literal("pause") }).strict(),
	z.object({ action: z.literal("resume") }).strict(),
	z.object({
		action: z.literal("stop"),
		mode: z.literal("graceful"),
		drainTimeoutMs: z.number().int().min(0).max(120_000).default(30_000),
	}).strict(),
	z.object({
		action: z.literal("stop"),
		mode: z.literal("immediate"),
	}).strict(),
]);
export type ControlCommand = z.infer<typeof ControlCommandSchema>;

export const EmergencyStopCommandSchema = z.object({
	reason: z.string().trim().min(1).max(500),
	confirmation: z.literal("STOP_ALL_BOTS"),
}).strict();
export type EmergencyStopCommand = z.infer<typeof EmergencyStopCommandSchema>;
