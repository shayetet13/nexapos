interface QueueItem<T, R> {
	id: number;
	priority: number;
	value: T;
	resolve: (result: R) => void;
	reject: (error: unknown) => void;
}

export class QueueClosedError extends Error {
	constructor(message = "Outgoing queue is not accepting new work") {
		super(message);
		this.name = "QueueClosedError";
	}
}

export class PriorityOutgoingQueue<T, R> {
	#items: Array<QueueItem<T, R>> = [];
	#sequence = 0;
	#running = false;
	#paused = false;
	#accepting = true;
	#drainWaiters: Array<() => void> = [];
	#processor: (value: T) => Promise<R>;
	#limit: number;
	#onDepth?: (depth: number) => void;

	constructor(
		processor: (value: T) => Promise<R>,
		options: { limit?: number; onDepth?: (depth: number) => void } = {},
	) {
		this.#processor = processor;
		this.#limit = options.limit ?? 1000;
		this.#onDepth = options.onDepth;
	}

	get depth(): number {
		return this.#items.length + (this.#running ? 1 : 0);
	}

	get accepting(): boolean {
		return this.#accepting;
	}

	enqueue(value: T, priority: number): Promise<R> {
		if (!this.#accepting) throw new QueueClosedError();
		if (this.#items.length >= this.#limit) {
			throw new QueueClosedError("Outgoing queue is full");
		}
		return new Promise<R>((resolve, reject) => {
			this.#items.push({
				id: this.#sequence++,
				priority,
				value,
				resolve,
				reject,
			});
			this.#items.sort((a, b) => a.priority - b.priority || a.id - b.id);
			this.#notifyDepth();
			queueMicrotask(() => void this.#pump());
		});
	}

	pause(): void {
		this.#paused = true;
	}

	resume(): void {
		this.#paused = false;
		queueMicrotask(() => void this.#pump());
	}

	stopAccepting(): void {
		this.#accepting = false;
	}

	cancelPending(reason = "Outgoing delivery cancelled"): number {
		this.#accepting = false;
		const pending = this.#items.splice(0);
		for (const item of pending) item.reject(new QueueClosedError(reason));
		this.#notifyDepth();
		this.#resolveDrainIfIdle();
		return pending.length;
	}

	async drain(): Promise<void> {
		if (this.#items.length === 0 && !this.#running) return;
		await new Promise<void>((resolve) => this.#drainWaiters.push(resolve));
	}

	async #pump(): Promise<void> {
		if (this.#running || this.#paused) return;
		const item = this.#items.shift();
		if (!item) {
			this.#resolveDrainIfIdle();
			return;
		}
		this.#running = true;
		this.#notifyDepth();
		try {
			item.resolve(await this.#processor(item.value));
		} catch (error) {
			item.reject(error);
		} finally {
			this.#running = false;
			this.#notifyDepth();
			queueMicrotask(() => void this.#pump());
		}
	}

	#notifyDepth(): void {
		this.#onDepth?.(this.depth);
	}

	#resolveDrainIfIdle(): void {
		if (this.#items.length || this.#running) return;
		for (const resolve of this.#drainWaiters.splice(0)) resolve();
	}
}
