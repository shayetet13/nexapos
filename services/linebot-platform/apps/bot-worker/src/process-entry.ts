import { BotRuntime } from "./runtime.ts";
import {
	isSupervisorMessage,
	type SupervisorToWorkerMessage,
	type WorkerToSupervisorMessage,
} from "./ipc.ts";
import { sanitizeError } from "./contracts.ts";

let runtime: BotRuntime | undefined;
let heartbeat: NodeJS.Timeout | undefined;
let shuttingDown = false;

function send(message: WorkerToSupervisorMessage): void {
	if (process.connected) process.send?.(message);
}

send({ type: "ready", pid: process.pid });

process.on("message", (value: unknown) => {
	if (!isSupervisorMessage(value)) return;
	void handle(value).catch((error) => {
		send({
			type: "response",
			requestId: value.requestId,
			ok: false,
			error: sanitizeError(error),
		});
	});
});

async function handle(message: SupervisorToWorkerMessage): Promise<void> {
	if (message.type === "bootstrap") {
		if (runtime) throw new Error("Worker has already been bootstrapped");
		runtime = new BotRuntime(message.config);
		wireRuntime(runtime);
		startHeartbeat(message.config.heartbeatIntervalMs ?? 2000);
		const snapshot = await runtime.start();
		send({ type: "response", requestId: message.requestId, ok: true, data: snapshot });
		return;
	}
	if (!runtime) throw new Error("Worker is not bootstrapped");

	switch (message.type) {
		case "command": {
			let data;
			if (message.command === "pause") data = await runtime.pause();
			else if (message.command === "resume") data = await runtime.resume();
			else if (message.command === "stop-graceful") data = await runtime.stop("graceful");
			else data = await runtime.stop("immediate");
			send({ type: "response", requestId: message.requestId, ok: true, data });
			if (message.command.startsWith("stop-")) {
				shuttingDown = true;
				if (heartbeat) clearInterval(heartbeat);
				setTimeout(() => process.exit(0), 10).unref();
			}
			return;
		}
		case "send-text": {
			const data = await runtime.sendText(message.request);
			send({ type: "response", requestId: message.requestId, ok: true, data });
			return;
		}
		case "enqueue-text": {
			const queued = runtime.queueText(message.request);
			queued.completion.catch(() => undefined);
			send({
				type: "response",
				requestId: message.requestId,
				ok: true,
				data: { deliveryId: queued.deliveryId },
			});
			return;
		}
		case "ingest-event": {
			await runtime.ingestEvent(message.event);
			send({ type: "response", requestId: message.requestId, ok: true });
			return;
		}
		case "watch-target": {
			await runtime.watchTarget(message.targetId, message.durationMs);
			send({ type: "response", requestId: message.requestId, ok: true });
			return;
		}
		case "list-targets": {
			const data = await runtime.listTargets();
			send({ type: "response", requestId: message.requestId, ok: true, data });
			return;
		}
		case "snapshot": {
			const data = await runtime.snapshot();
			send({ type: "response", requestId: message.requestId, ok: true, data });
			return;
		}
	}
}

function wireRuntime(bot: BotRuntime): void {
	bot.on("status", (payload) => send({ type: "event", event: { name: "status", payload } }));
	bot.on("inbound", (payload) => send({ type: "event", event: { name: "inbound", payload } }));
	bot.on("delivery", (payload) => send({ type: "event", event: { name: "delivery", payload } }));
	bot.on("auth", (payload) => send({ type: "event", event: { name: "auth", payload } }));
	bot.on("firstResponse", (payload) => {
		send({ type: "event", event: { name: "first-response", payload } });
	});
}

function startHeartbeat(intervalMs: number): void {
	const safeInterval = Math.max(100, Math.min(intervalMs, 60_000));
	heartbeat = setInterval(() => {
		if (!runtime || shuttingDown) return;
		void runtime.snapshot().then((snapshot) => send({ type: "heartbeat", snapshot }));
	}, safeInterval);
	heartbeat.unref();
}

async function terminateFromSignal(): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	if (heartbeat) clearInterval(heartbeat);
	try {
		await runtime?.stop("graceful");
	} finally {
		process.exit(0);
	}
}

process.on("SIGTERM", () => void terminateFromSignal());
process.on("SIGINT", () => void terminateFromSignal());
process.on("disconnect", () => void terminateFromSignal());
process.on("uncaughtException", (error) => {
	send({ type: "fatal", error: sanitizeError(error) });
	process.exit(1);
});
process.on("unhandledRejection", (error) => {
	send({ type: "fatal", error: sanitizeError(error) });
	process.exit(1);
});
