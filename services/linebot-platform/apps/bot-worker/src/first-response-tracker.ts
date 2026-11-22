import type { FirstResponseMetrics, NormalizedInboundEvent } from "./contracts.ts";

export type FirstResponseOutcome = "win" | "loss" | "unknown";

interface Opportunity {
	eventId: string;
	targetId: string;
	startedAt: number;
	deadline: number;
	timer: NodeJS.Timeout;
}

export class FirstResponseTracker {
	#windowMs: number;
	#pending = new Map<string, Opportunity>();
	#wins = 0;
	#losses = 0;
	#unknown = 0;
	#latencies: number[] = [];
	#onOutcome?: (
		outcome: FirstResponseOutcome,
		eventId: string,
		latencyMs?: number,
	) => void;

	constructor(
		windowMs = 5000,
		onOutcome?: (
			outcome: FirstResponseOutcome,
			eventId: string,
			latencyMs?: number,
		) => void,
	) {
		if (!Number.isFinite(windowMs) || windowMs < 1) {
			throw new RangeError("First-response window must be positive");
		}
		this.#windowMs = windowMs;
		this.#onOutcome = onOutcome;
	}

	observe(event: NormalizedInboundEvent): void {
		if (event.isBot) return;
		for (const opportunity of [...this.#pending.values()]) {
			if (opportunity.targetId === event.targetId) {
				this.#settle(opportunity.eventId, "loss");
			}
		}
		const startedAt = Date.now();
		const timer = setTimeout(
			() => this.#settle(event.eventId, "loss"),
			this.#windowMs,
		);
		timer.unref?.();
		this.#pending.set(event.eventId, {
			eventId: event.eventId,
			targetId: event.targetId,
			startedAt,
			deadline: startedAt + this.#windowMs,
			timer,
		});
	}

	markSent(eventId: string, sentAt = Date.now()): boolean {
		const opportunity = this.#pending.get(eventId);
		if (!opportunity || sentAt > opportunity.deadline) return false;
		this.#settle(eventId, "win", Math.max(0, sentAt - opportunity.startedAt));
		return true;
	}

	markAllUnknown(): void {
		for (const eventId of [...this.#pending.keys()]) {
			this.#settle(eventId, "unknown");
		}
	}

	snapshot(): FirstResponseMetrics {
		const decided = this.#wins + this.#losses;
		return {
			wins: this.#wins,
			losses: this.#losses,
			unknown: this.#unknown,
			pending: this.#pending.size,
			winRate: decided ? this.#wins / decided : null,
			averageLatencyMs: average(this.#latencies),
			p95LatencyMs: percentile(this.#latencies, 0.95),
		};
	}

	#settle(
		eventId: string,
		outcome: FirstResponseOutcome,
		latencyMs?: number,
	): void {
		const opportunity = this.#pending.get(eventId);
		if (!opportunity) return;
		clearTimeout(opportunity.timer);
		this.#pending.delete(eventId);
		if (outcome === "win") {
			this.#wins++;
			if (latencyMs !== undefined) this.#latencies.push(latencyMs);
		} else if (outcome === "loss") {
			this.#losses++;
		} else {
			this.#unknown++;
		}
		this.#onOutcome?.(outcome, eventId, latencyMs);
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
