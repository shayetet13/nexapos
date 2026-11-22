export class TokenBucketRateLimiter {
	#configuredRate: number;
	#effectiveRate: number;
	#capacity: number;
	#tokens: number;
	#lastRefill: number;
	#penalizedAt = 0;

	constructor(messagesPerSecond: number, burst: number) {
		if (!Number.isFinite(messagesPerSecond) || messagesPerSecond <= 0) {
			throw new RangeError("messagesPerSecond must be greater than zero");
		}
		if (!Number.isInteger(burst) || burst < 1) {
			throw new RangeError("burst must be a positive integer");
		}
		this.#configuredRate = messagesPerSecond;
		this.#effectiveRate = messagesPerSecond;
		this.#capacity = burst;
		this.#tokens = burst;
		this.#lastRefill = performance.now();
	}

	get effectiveRate(): number {
		this.#recover();
		return this.#effectiveRate;
	}

	/** Back off after a provider throttle without ever exceeding configured rate. */
	penalize(): void {
		this.#refill();
		this.#effectiveRate = Math.max(0.1, this.#effectiveRate / 2);
		this.#tokens = Math.min(this.#tokens, 1);
		this.#penalizedAt = performance.now();
	}

	async take(signal?: AbortSignal): Promise<void> {
		while (true) {
			if (signal?.aborted) throw abortError();
			this.#refill();
			if (this.#tokens >= 1) {
				this.#tokens -= 1;
				return;
			}
			const waitMs = Math.max(1, Math.ceil((1 - this.#tokens) * 1000 / this.#effectiveRate));
			await abortableDelay(waitMs, signal);
		}
	}

	#recover(): void {
		if (this.#effectiveRate >= this.#configuredRate || this.#penalizedAt === 0) return;
		const elapsedSeconds = (performance.now() - this.#penalizedAt) / 1000;
		if (elapsedSeconds < 10) return;
		this.#effectiveRate = Math.min(
			this.#configuredRate,
			this.#effectiveRate * 1.25,
		);
		this.#penalizedAt = performance.now();
	}

	#refill(): void {
		this.#recover();
		const now = performance.now();
		const elapsedSeconds = Math.max(0, now - this.#lastRefill) / 1000;
		this.#tokens = Math.min(
			this.#capacity,
			this.#tokens + elapsedSeconds * this.#effectiveRate,
		);
		this.#lastRefill = now;
	}
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(abortError());
	return new Promise((resolve, reject) => {
		const timer = setTimeout(done, ms);
		function done(): void {
			signal?.removeEventListener("abort", cancelled);
			resolve();
		}
		function cancelled(): void {
			clearTimeout(timer);
			reject(abortError());
		}
		signal?.addEventListener("abort", cancelled, { once: true });
	});
}

function abortError(): Error {
	const error = new Error("Operation aborted");
	error.name = "AbortError";
	return error;
}
