import type {
	BotMetricsSnapshot,
	FirstResponseMetrics,
} from "./contracts.ts";

export class RuntimeMetrics {
	received = 0;
	enqueued = 0;
	sent = 0;
	failed = 0;
	dropped = 0;
	queueDepth = 0;
	#receivedTimes: number[] = [];
	#sentTimes: number[] = [];
	#sendLatencies: number[] = [];

	recordReceived(at = Date.now()): void {
		this.received++;
		this.#receivedTimes.push(at);
		this.#trim(at);
	}

	recordEnqueued(): void {
		this.enqueued++;
	}

	recordSent(latencyMs: number, at = Date.now()): void {
		this.sent++;
		this.#sentTimes.push(at);
		this.#sendLatencies.push(Math.max(0, latencyMs));
		if (this.#sendLatencies.length > 1000) this.#sendLatencies.shift();
		this.#trim(at);
	}

	recordFailed(): void {
		this.failed++;
	}

	recordDropped(count = 1): void {
		this.dropped += count;
	}

	snapshot(
		firstResponse: FirstResponseMetrics,
		rateLimitPerSecond: number,
	): BotMetricsSnapshot {
		const now = Date.now();
		this.#trim(now);
		const memory = process.memoryUsage();
		const cpu = process.cpuUsage();
		return {
			received: this.received,
			enqueued: this.enqueued,
			sent: this.sent,
			failed: this.failed,
			dropped: this.dropped,
			queueDepth: this.queueDepth,
			receivedPerMinute: this.#receivedTimes.length,
			sentPerMinute: this.#sentTimes.length,
			averageSendLatencyMs: average(this.#sendLatencies),
			p95SendLatencyMs: percentile(this.#sendLatencies, 0.95),
			rateLimitPerSecond,
			firstResponse,
			process: {
				pid: process.pid,
				rssBytes: memory.rss,
				heapUsedBytes: memory.heapUsed,
				cpuUserMicros: cpu.user,
				cpuSystemMicros: cpu.system,
			},
		};
	}

	#trim(now: number): void {
		const cutoff = now - 60_000;
		while (this.#receivedTimes[0] !== undefined && this.#receivedTimes[0] < cutoff) {
			this.#receivedTimes.shift();
		}
		while (this.#sentTimes[0] !== undefined && this.#sentTimes[0] < cutoff) {
			this.#sentTimes.shift();
		}
	}
}

function average(values: number[]): number | null {
	if (!values.length) return null;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number): number | null {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)];
}
