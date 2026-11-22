import { randomUUID } from "node:crypto";
import {
	type AdapterCapabilities,
	type AdapterEventListener,
	type AdapterHealth,
	type BotAdapter,
	type BotTarget,
	type NormalizedInboundEvent,
	type OfficialLineAdapterConfig,
	type SendTextRequest,
	type SendTextResult,
} from "../contracts.ts";

export class AdapterHttpError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = "AdapterHttpError";
		this.status = status;
	}
}

export class OfficialLineAdapter implements BotAdapter {
	readonly kind = "official" as const;
	#config: Readonly<OfficialLineAdapterConfig>;
	#connected = false;
	#listeners = new Set<AdapterEventListener>();

	constructor(config: OfficialLineAdapterConfig) {
		this.#config = structuredClone(config);
	}

	async connect(): Promise<void> {
		if (!this.#config.channelAccessToken) {
			throw new Error("Official LINE access token is missing");
		}
		this.#connected = true;
	}

	async disconnect(): Promise<void> {
		this.#connected = false;
	}

	async sendText(
		request: SendTextRequest,
		signal?: AbortSignal,
	): Promise<SendTextResult> {
		this.#assertConnected();
		const baseUrl = (this.#config.apiBaseUrl ?? "https://api.line.me").replace(/\/$/, "");
		const useReply = Boolean(request.replyToken);
		const endpoint = useReply
			? `${baseUrl}/v2/bot/message/reply`
			: `${baseUrl}/v2/bot/message/push`;
		const body = useReply
			? { replyToken: request.replyToken, messages: [{ type: "text", text: request.text }] }
			: { to: request.targetId, messages: [{ type: "text", text: request.text }] };
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				authorization: `Bearer ${this.#config.channelAccessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
			signal,
		});
		if (!response.ok) {
			const detail = (await response.text()).slice(0, 300);
			throw new AdapterHttpError(
				response.status,
				`LINE Messaging API returned ${response.status}${detail ? `: ${detail}` : ""}`,
			);
		}
		return {
			deliveryId: request.deliveryId ?? randomUUID(),
			providerMessageId: response.headers.get("x-line-request-id") ?? undefined,
			sentAt: Date.now(),
			targetId: request.targetId,
		};
	}

	async listTargets(): Promise<BotTarget[]> {
		this.#assertConnected();
		// Messaging API has no endpoint that lists every joined group. The API
		// layer persists targets learned from signed webhooks and supplies them here.
		return structuredClone(this.#config.targets ?? []);
	}

	subscribeEvents(listener: AdapterEventListener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	async ingestEvent(event: NormalizedInboundEvent): Promise<void> {
		this.#assertConnected();
		if (event.source !== "official") {
			throw new TypeError("Official adapter accepts only normalized official events");
		}
		for (const listener of [...this.#listeners]) await listener(structuredClone(event));
	}

	async health(): Promise<AdapterHealth> {
		return {
			connected: this.#connected,
			detail: this.#connected ? "configured" : "disconnected",
			checkedAt: Date.now(),
		};
	}

	capabilities(): AdapterCapabilities {
		return {
			inboundEvents: true,
			listTargets: false,
			openChat: false,
			reply: true,
		};
	}

	#assertConnected(): void {
		if (!this.#connected) throw new Error("Official LINE adapter is not connected");
	}
}
