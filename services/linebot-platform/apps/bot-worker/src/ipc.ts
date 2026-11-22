import type {
	AdapterAuthEvent,
	BotConfig,
	BotSnapshot,
	DeliveryEvent,
	NormalizedInboundEvent,
	SendTextRequest,
	SendTextResult,
} from "./contracts.ts";

export type WorkerCommand = "pause" | "resume" | "stop-graceful" | "stop-immediate";

export type SupervisorToWorkerMessage =
	| { type: "bootstrap"; requestId: string; config: BotConfig }
	| { type: "command"; requestId: string; command: WorkerCommand }
	| { type: "send-text"; requestId: string; request: SendTextRequest }
	| { type: "enqueue-text"; requestId: string; request: SendTextRequest }
	| { type: "ingest-event"; requestId: string; event: NormalizedInboundEvent }
	| { type: "watch-target"; requestId: string; targetId: string; durationMs: number }
	| { type: "list-targets"; requestId: string }
	| { type: "snapshot"; requestId: string };

export type WorkerEvent =
	| { name: "status"; payload: BotSnapshot }
	| { name: "inbound"; payload: NormalizedInboundEvent & { botId: string } }
	| { name: "delivery"; payload: DeliveryEvent }
	| { name: "auth"; payload: AdapterAuthEvent & { botId: string } }
	| {
		name: "first-response";
		payload: {
			botId: string;
			outcome: "win" | "loss" | "unknown";
			eventId: string;
			latencyMs?: number;
		};
	};

export type WorkerToSupervisorMessage =
	| { type: "ready"; pid: number }
	| { type: "response"; requestId: string; ok: true; data?: unknown }
	| { type: "response"; requestId: string; ok: false; error: string }
	| { type: "event"; event: WorkerEvent }
	| { type: "heartbeat"; snapshot: BotSnapshot }
	| { type: "fatal"; error: string };

export interface WorkerRuntimeApi {
	start(): Promise<BotSnapshot>;
	pause(): Promise<BotSnapshot>;
	resume(): Promise<BotSnapshot>;
	stop(mode: "graceful" | "immediate"): Promise<BotSnapshot>;
	sendText(request: SendTextRequest): Promise<SendTextResult>;
	queueText(request: SendTextRequest): {
		deliveryId: string;
		completion: Promise<SendTextResult>;
	};
	ingestEvent(event: NormalizedInboundEvent): Promise<void>;
	watchTarget(targetId: string, durationMs: number): Promise<void>;
	listTargets(): Promise<unknown>;
	snapshot(): Promise<BotSnapshot>;
}

export function isSupervisorMessage(value: unknown): value is SupervisorToWorkerMessage {
	if (!value || typeof value !== "object") return false;
	const message = value as Record<string, unknown>;
	return typeof message.type === "string" && typeof message.requestId === "string";
}
