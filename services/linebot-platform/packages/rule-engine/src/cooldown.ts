export interface CooldownRequest {
	key: string;
	durationMs: number;
}

/**
 * Production implementations should perform this operation atomically (for
 * Redis, a Lua script is suitable). `commit: false` is used by dry-runs.
 */
export interface CooldownStore {
	tryAcquire(
		requests: readonly CooldownRequest[],
		nowMs: number,
		options: { commit: boolean },
	): Promise<boolean>;
}

export class InMemoryCooldownStore implements CooldownStore {
	readonly #expiresAt = new Map<string, number>();

	tryAcquire(
		requests: readonly CooldownRequest[],
		nowMs: number,
		options: { commit: boolean },
	): Promise<boolean> {
		for (const request of requests) {
			const expiresAt = this.#expiresAt.get(request.key);
			if (expiresAt !== undefined && expiresAt > nowMs) {
				return Promise.resolve(false);
			}
		}
		if (options.commit) {
			for (const request of requests) {
				this.#expiresAt.set(request.key, nowMs + request.durationMs);
			}
		}
		return Promise.resolve(true);
	}

	clear(): void {
		this.#expiresAt.clear();
	}

	prune(nowMs = Date.now()): void {
		for (const [key, expiresAt] of this.#expiresAt) {
			if (expiresAt <= nowMs) this.#expiresAt.delete(key);
		}
	}
}
