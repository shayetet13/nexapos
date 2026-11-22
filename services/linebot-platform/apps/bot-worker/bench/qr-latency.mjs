/**
 * Measures how long a LINEJS QR login takes to produce a scannable code,
 * broken down by phase, without going through the API or the dashboard.
 *
 * Usage: node apps/bot-worker/bench/qr-latency.mjs
 *
 * Phases reported:
 *   fork→ready       child process spawn + module graph load of the worker
 *   ready→bootstrap  IPC round trip to hand the config over
 *   bootstrap→qr     @evex/linejs import + LINE createSession/createQrCode
 */
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../src/process-entry.ts", import.meta.url));
const marks = [];
const started = performance.now();
const at = () => Math.round(performance.now() - started);

const child = fork(entry, [], {
	stdio: ["ignore", "pipe", "pipe", "ipc"],
	serialization: "advanced",
	execArgv: [],
	env: { ...process.env, LINEBOT_WORKER_ID: "bench-qr", LINEBOT_TRACE: "1", LINEJS_STORAGE_DIR: "./data/linejs-bench" },
});

child.stdout.on("data", (chunk) => process.stdout.write(`  worker | ${chunk}`));
child.stderr.on("data", (chunk) => process.stderr.write(`  worker! | ${chunk}`));

const timeout = setTimeout(() => {
	console.error("\nTimed out after 90s without a QR code.");
	child.kill("SIGKILL");
	process.exit(1);
}, 90_000);

child.on("message", (message) => {
	if (message.type === "ready") {
		marks.push(["fork→ready", at()]);
		child.send({
			type: "bootstrap",
			requestId: "bench",
			config: {
				botId: "bench",
				adapter: {
					kind: "linejs",
					loginMode: "qr",
					device: process.env.LINEJS_DEVICE ?? "ANDROIDSECONDARY",
					enableTalk: true,
					enableSquare: true,
					preferCompactMessages: true,
				},
				heartbeatIntervalMs: 5_000,
			},
		});
		marks.push(["ready→bootstrap sent", at()]);
		return;
	}
	if (message.type === "event" && message.event.name === "auth" && message.event.payload.type === "qr") {
		marks.push(["bootstrap→qr ready", at()]);
		clearTimeout(timeout);
		console.log("\n=== QR login latency ===");
		let previous = 0;
		for (const [label, total] of marks) {
			console.log(`${label.padEnd(24)} +${String(total - previous).padStart(6)}ms   (t=${total}ms)`);
			previous = total;
		}
		console.log(`\nTotal time to scannable QR: ${at()}ms`);
		child.kill("SIGKILL");
		process.exit(0);
	}
	if (message.type === "fatal" || (message.type === "response" && message.ok === false)) {
		console.error("\nWorker failed:", message.error);
		clearTimeout(timeout);
		child.kill("SIGKILL");
		process.exit(1);
	}
});
