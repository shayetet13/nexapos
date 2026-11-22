import { randomUUID } from "node:crypto";
import {
	type AdapterAuthEvent,
	type AdapterCapabilities,
	type AdapterEventListener,
	type AdapterHealth,
	type BotAdapter,
	type BotTarget,
	type LineJsAdapterConfig,
	type NormalizedInboundEvent,
	type SendTextRequest,
	type SendTextResult,
	type TargetKind,
} from "../contracts.ts";
import { EncryptedFileStorage } from "./linejs-storage.ts";

const ROSTER_FETCH_TIMEOUT_MS = 8_000;
const HISTORY_FETCH_TIMEOUT_MS = 8_000;
const DEFAULT_HISTORY_POLL_INTERVAL_MS = 5_000;
const HISTORY_LOOKBACK_MESSAGES = 10;
const HISTORY_INITIAL_RACE_WINDOW_MS = 15_000;
const MAX_SEEN_MESSAGE_IDS = 1_000;

/**
 * Storage key holding the set of targets known to enforce E2EE (letter
 * sealing). Persisting it means a restarted worker does not have to re-learn
 * the hard way -- by paying one rejected plain send per sealed group.
 */
const SEALED_TARGETS_KEY = "sealedTargets";

/**
 * How long an idle connection to LINE is kept open for reuse.
 *
 * Node's default fetch agent drops idle sockets after 4s, so a bot that
 * replies less often than that pays a fresh TCP + TLS handshake on every
 * message -- the single largest avoidable cost per send on a Thailand→Japan
 * path. Holding the socket open turns that back into one round trip.
 */
const KEEP_ALIVE_TIMEOUT_MS = 120_000;

/** Emits phase timings on stdout when LINEBOT_TRACE=1; a no-op otherwise. */
const trace: (phase: string, startedAt: number) => void =
	process.env.LINEBOT_TRACE === "1"
		? (phase, startedAt) => console.log(`[trace] ${phase} ${Math.round(performance.now() - startedAt)}ms`)
		: () => {};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message = "Operation timed out"): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
		promise.then(
			(value) => { clearTimeout(timer); resolve(value); },
			(error) => { clearTimeout(timer); reject(error); },
		);
	});
}

interface LineJsRawTalkMessage {
	id?: string;
	createdTime?: unknown;
	contentType?: unknown;
	contentMetadata?: Record<string, unknown>;
	to?: string;
	from?: string;
	toType?: unknown;
	text?: string;
}

interface LineJsTalkMessage {
	raw: LineJsRawTalkMessage;
	to: { id: string; type: unknown };
	from: { id: string };
	text?: string;
	isMyMessage: boolean;
	getFlex?(): Promise<{ flexJson?: unknown; altText?: string }>;
}

interface LineJsSquareMessage {
	raw: { message?: { id?: string; createdTime?: unknown } };
	to: { id: string; type: unknown };
	from: { id: string };
	text: string;
	isMyMessage(): Promise<boolean>;
}

/**
 * `extra.groupExtra.memberMids` is populated on `Chat` because `fetchJoinedChats`
 * calls `getChats` with the library's default `withMembers: true` — no extra
 * request is needed to read the roster of a Talk group. Confirmed against
 * CHRLINE (the reference Python implementation for this same LINE protocol),
 * which documents `getChats(mids, withMembers=True)` as the member-bearing call
 * and marks the older per-group `getGroup` RPC as deprecated in its favor.
 */
interface LineJsChatRaw {
	extra?: { groupExtra?: { memberMids?: Record<string, unknown> } };
}

interface LineJsChat extends LineJsSendableChat {
	mid: string;
	name: string;
	raw?: LineJsChatRaw;
}

interface LineJsUser {
	mid: string;
	raw?: {
		targetProfileDetail?: { profileName?: string };
		displayName?: string;
	};
}

/**
 * OpenChat (Square) rooms carry only `maxMemberCount` (the room's capacity) in
 * the lightweight event-derived listing — the live roster requires the separate
 * paginated `getSquareChatMembers` call exposed here as `getMembers()`.
 */
interface LineJsSquareChatInstance extends LineJsSendableChat {
	raw: { squareChatMid: string; name?: string };
	getMembers(): Promise<unknown[]>;
}

interface LineJsSendableChat {
	sendMessage(input: { text: string; relatedMessageId?: string }): Promise<unknown>;
	fetchMessages?(limit?: number): Promise<LineJsTalkMessage[]>;
}

interface LineJsClient {
	readonly authToken: string;
	on(event: "message", listener: (message: LineJsTalkMessage) => void): unknown;
	on(event: "square:message", listener: (message: LineJsSquareMessage) => void): unknown;
	listen(options: { talk: boolean; square: boolean; signal: AbortSignal }): void;
	fetchJoinedChats(): Promise<LineJsChat[]>;
	fetchUsers(): Promise<LineJsUser[]>;
	fetchJoinedSquareChats(): Promise<LineJsSquareChatInstance[]>;
	getUser?(id: string): Promise<LineJsUser>;
	getChat(id: string): Promise<LineJsSendableChat>;
	getSquareChat(id: string): Promise<LineJsSendableChat>;
	sendCompactMessage(id: string, input: string | { text: string; e2ee?: boolean }): Promise<unknown>;
	/**
	 * Internal client surface used to guarantee an E2EE self-key exists before
	 * we try to send into a letter-sealed (E2EE-enforced) group. `base` is a
	 * public field on the LINEJS `Client`.
	 */
	readonly base?: {
		profile?: { mid?: string } | null;
		e2ee: {
			registerE2EEKeyPair(): Promise<unknown>;
			getE2EESelfKeyData(mid: string): Promise<unknown>;
			decryptE2EEMessage?(message: LineJsRawTalkMessage): Promise<LineJsRawTalkMessage>;
		};
		relation?: {
			getUserFriendIds(input: {
				request: { blockStatus: "ALL"; userPageToken: string };
			}): Promise<{ userFriendMids?: string[]; nextUserPageToken?: string }>;
		};
		talk?: {
			getAllContactIds(input: { syncReason: "INTERNAL" }): Promise<string[]>;
			getMessageBoxes?(input: {
				messageBoxListRequest: Record<string, never>;
			}): Promise<{
				messageBoxes?: Array<{
					id: string;
					lastDeliveredMessageId: {
						messageId: unknown;
						deliveredTime: unknown;
					};
				}>;
			}>;
			getPreviousMessagesV2WithRequest?(input: {
				request: {
					messageBoxId: string;
					endMessageId: {
						messageId: unknown;
						deliveredTime: unknown;
					};
					messagesCount: number;
				};
			}): Promise<LineJsRawTalkMessage[]>;
		};
	};
}

async function fetchDirectUsers(client: LineJsClient): Promise<LineJsUser[]> {
	const users = new Map<string, LineJsUser>();
	try {
		for (const user of await client.fetchUsers()) users.set(user.mid, user);
	} catch {
		// Fall through to the lower-level contact rosters below.
	}

	const mids = new Set(users.keys());
	const relation = client.base?.relation;
	if (relation) {
		let userPageToken = "";
		for (let page = 0; page < 100; page++) {
			try {
				const response = await relation.getUserFriendIds({
					request: { blockStatus: "ALL", userPageToken },
				});
				for (const mid of response.userFriendMids ?? []) mids.add(mid);
				const next = response.nextUserPageToken ?? "";
				if (!next || next === userPageToken) break;
				userPageToken = next;
			} catch {
				break;
			}
		}
	}
	try {
		for (const mid of await client.base?.talk?.getAllContactIds({ syncReason: "INTERNAL" }) ?? []) mids.add(mid);
	} catch {
		// Not every LINE device profile supports this legacy Talk method.
	}

	const missing = [...mids].filter((mid) => !users.has(mid));
	if (client.getUser) {
		// Bound concurrency: a large contact list must not launch hundreds of
		// simultaneous profile requests at LINE.
		const workerCount = Math.min(8, missing.length);
		let cursor = 0;
		await Promise.all(Array.from({ length: workerCount }, async () => {
			while (cursor < missing.length) {
				const mid = missing[cursor++]!;
				try {
					const user = await client.getUser!(mid);
					users.set(user.mid, user);
				} catch {
					// Skip deleted/inaccessible contacts.
				}
			}
		}));
	}
	return [...users.values()];
}

function decodeFlexJson(value: unknown): unknown {
	let current = value;
	// LINE clients in the wild expose FLEX_JSON either as an object, a JSON
	// string, or a JSON string containing another JSON string.
	for (let depth = 0; depth < 3 && typeof current === "string"; depth++) {
		const trimmed = current.trim();
		if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith("\"")) break;
		try {
			current = JSON.parse(trimmed);
		} catch {
			break;
		}
	}
	return current;
}

function collectFlexText(value: unknown, output: string[], depth = 0): void {
	if (depth > 24 || value === null || value === undefined) return;
	if (Array.isArray(value)) {
		for (const item of value) collectFlexText(item, output, depth + 1);
		return;
	}
	if (typeof value !== "object") return;
	const record = value as Record<string, unknown>;
	// Rich Flex text is commonly split into `span` nodes. Previously only
	// `type: "text"` was read, so styled bank titles/amounts silently vanished.
	if ((record.type === "text" || record.type === "span") && typeof record.text === "string") {
		const trimmed = record.text.trim();
		if (trimmed) output.push(trimmed);
	}
	for (const [key, child] of Object.entries(record)) {
		if (key === "text" || key === "type") continue;
		collectFlexText(decodeFlexJson(child), output, depth + 1);
	}
}

/**
 * LINE bank accounts send transaction cards as Flex messages, not ordinary
 * text messages. Convert the visible Flex text nodes to the same newline text
 * stream used by the automation and payment parsers.
 */
export async function extractTalkMessageText(message: LineJsTalkMessage): Promise<string> {
	if (message.text?.trim()) return message.text.trim();
	let flex: { flexJson?: unknown; altText?: string } | undefined;
	try {
		flex = await message.getFlex?.();
	} catch {
		// Some old LINEJS builds expose only contentMetadata; use that below.
	}
	const metadata = message.raw.contentMetadata as Record<string, unknown> | undefined;
	const flexJson = decodeFlexJson(
		flex?.flexJson ??
		metadata?.FLEX_JSON ??
		metadata?.flexJson ??
		metadata?.contents,
	);
	const lines: string[] = [];
	collectFlexText(flexJson, lines);
	const altText = flex?.altText?.trim() ||
		(typeof metadata?.ALT_TEXT === "string" ? metadata.ALT_TEXT.trim() : "") ||
		(typeof metadata?.altText === "string" ? metadata.altText.trim() : "");
	// altText can contain the transaction marker even when the visible card
	// renders that marker as an image. Keep it as a parser fallback.
	if (altText && !lines.includes(altText)) lines.push(altText);
	return lines.join("\n");
}

interface LineJsModule {
	TalkMessage?: {
		fromRawTalk(message: LineJsRawTalkMessage, client: LineJsClient): Promise<LineJsTalkMessage>;
	};
	loginWithAuthToken(
		token: string,
		options: Record<string, unknown>,
	): Promise<LineJsClient>;
	loginWithQR(
		hooks: {
			onReceiveQRUrl(url: string): void;
			onPincodeRequest(pin: string): void;
		},
		options: Record<string, unknown>,
	): Promise<LineJsClient>;
}

export class LineJsCapabilityError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "LineJsCapabilityError";
	}
}

/**
 * Real @evex/linejs boundary. It never falls back to a simulator: unsupported
 * Node/package combinations fail explicitly so production cannot send through
 * a fake account by accident.
 */
export class LineJsAdapter implements BotAdapter {
	readonly kind = "linejs" as const;
	#config: Readonly<LineJsAdapterConfig>;
	#client?: LineJsClient;
	#fromRawTalk?: (message: LineJsRawTalkMessage, client: LineJsClient) => Promise<LineJsTalkMessage>;
	#abort?: AbortController;
	#listeners = new Set<AdapterEventListener>();
	#authListeners = new Set<(event: AdapterAuthEvent) => void>();
	#lastError?: string;
	readonly #storage: EncryptedFileStorage;
	/**
	 * Targets known to enforce E2EE (letter sealing). For these we skip the
	 * plain compact-send attempt that LINE would reject anyway, saving a wasted
	 * round trip (~100ms/message). Learned lazily on the first send and
	 * persisted, so a restart does not re-pay that cost per group.
	 */
	readonly #e2eeTargets = new Set<string>();
	/**
	 * Chat handles by target id. `getChat`/`getSquareChat` are round trips to
	 * LINE, not local lookups, so resolving one per outgoing message doubled
	 * the latency of every reply. A handle is just an addressable wrapper --
	 * caching it is safe, and a stale one is dropped on the first send failure.
	 */
	readonly #talkChats = new Map<string, Promise<LineJsSendableChat>>();
	readonly #squareChats = new Map<string, Promise<LineJsSendableChat>>();
	readonly #historyWatches = new Map<string, {
		expiresAt: number;
		startedAt: number;
		initialized: boolean;
		lastSuccessAt?: number;
		lastError?: string;
	}>();
	readonly #seenTalkMessageIds = new Map<string, true>();
	readonly #processingTalkMessageIds = new Set<string>();
	#historyTimer?: NodeJS.Timeout;
	#historyPollInFlight = false;
	#lastInboundAt?: number;

	constructor(config: LineJsAdapterConfig) {
		this.#config = structuredClone(config);
		// One encrypted storage file per bot so the LINEJS client's E2EE keys
		// and refresh token survive worker restarts (see EncryptedFileStorage).
		const workerId = process.env.LINEBOT_WORKER_ID ?? "default";
		const dir = process.env.LINEJS_STORAGE_DIR ?? "./data/linejs";
		const secret = process.env.ENCRYPTION_KEY ?? "local-development-encryption-key";
		this.#storage = new EncryptedFileStorage(`${dir}/${workerId}.enc`, secret);
	}

	async connect(): Promise<void> {
		if (this.#client) return;
		const connectStartedAt = performance.now();
		const specifier = this.#config.moduleSpecifier ?? "@evex/linejs";
		let linejs: LineJsModule;
		try {
			linejs = await import(specifier) as LineJsModule;
			this.#fromRawTalk = linejs.TalkMessage?.fromRawTalk;
			trace("linejs-module-loaded", connectStartedAt);
		} catch (error) {
			this.#lastError = `Cannot load ${specifier}`;
			throw new LineJsCapabilityError(
				`Unable to load ${specifier}. Install the local @evex/linejs workspace package in a Node-compatible build, or set moduleSpecifier to a compatible module. LINEJS simulation is intentionally disabled.`,
				{ cause: error },
			);
		}

		const options: Record<string, unknown> = {
			device: this.#config.device ?? "ANDROIDSECONDARY",
			// Persist client state (E2EE keys, refresh token) across restarts.
			storage: this.#storage,
			// LINE's encrypted gateway (/enc) answers an empty 404 (server=legy) to
			// every request since 2026-11-18. linejs defaults to "auto", which routes
			// token-bearing talk calls through it, so QR login and every later call
			// fail with "status=404 ... server=legy". Plain /S4 still works.
			legy: { encrypted: false },
		};
		const keepAliveFetch = await createKeepAliveFetch();
		if (keepAliveFetch) options.fetch = keepAliveFetch;
		if (this.#config.version) options.version = this.#config.version;
		if (this.#config.endpoint) options.endpoint = this.#config.endpoint;

		try {
			if ((this.#config.loginMode ?? "token") === "qr") {
				this.#client = await linejs.loginWithQR({
					onReceiveQRUrl: (url) => {
						trace("qr-url-received", connectStartedAt);
						this.#emitAuth({ type: "qr", value: url, timestamp: Date.now() });
					},
					onPincodeRequest: (pin) => this.#emitAuth({ type: "pin", value: pin, timestamp: Date.now() }),
				}, options);
				this.#emitAuth({
					type: "authenticated",
					authToken: this.#client.authToken,
					timestamp: Date.now(),
				});
			} else {
				if (!this.#config.authToken) throw new Error("LINEJS auth token is missing");
				this.#client = await linejs.loginWithAuthToken(this.#config.authToken, options);
				this.#emitAuth({ type: "authenticated", timestamp: Date.now() });
			}
		} catch (error) {
			this.#lastError = error instanceof Error ? error.message : String(error);
			this.#emitAuth({ type: "auth-error", value: this.#lastError, timestamp: Date.now() });
			throw error;
		}

		trace("login-complete", connectStartedAt);
		await this.#restoreSealedTargets();
		await this.#ensureE2EEKey();
		trace("connect-complete", connectStartedAt);

		this.#abort = new AbortController();
		this.#client.on("message", (message) => {
			void this.#onTalkMessage(message).catch((error) => {
				this.#lastError = error instanceof Error ? error.message : String(error);
			});
		});
		this.#client.on("square:message", (message) => {
			void this.#onSquareMessage(message).catch((error) => {
				this.#lastError = error instanceof Error ? error.message : String(error);
			});
		});
		this.#client.listen({
			talk: this.#config.enableTalk ?? true,
			square: this.#config.enableSquare ?? true,
			signal: this.#abort.signal,
		});
	}

	async disconnect(): Promise<void> {
		this.#abort?.abort();
		this.#abort = undefined;
		if (this.#historyTimer) clearInterval(this.#historyTimer);
		this.#historyTimer = undefined;
		this.#historyWatches.clear();
		this.#seenTalkMessageIds.clear();
		this.#processingTalkMessageIds.clear();
		this.#client = undefined;
		this.#fromRawTalk = undefined;
		this.#talkChats.clear();
		this.#squareChats.clear();
		this.#storage.flush();
	}

	async sendText(
		request: SendTextRequest,
		_signal?: AbortSignal,
	): Promise<SendTextResult> {
		const client = this.#requireClient();
		if (request.targetKind === "openchat") {
			await this.#sendViaChat(this.#squareChats, request, (id) => client.getSquareChat(id));
		} else if (this.#config.preferCompactMessages && !request.relatedMessageId) {
			await this.#sendCompact(client, request.targetId, request.text);
		} else {
			await this.#sendViaChat(this.#talkChats, request, (id) => client.getChat(id));
		}
		return {
			deliveryId: request.deliveryId ?? randomUUID(),
			sentAt: Date.now(),
			targetId: request.targetId,
		};
	}

	/**
	 * Sends through a cached chat handle, resolving one only on a cache miss.
	 *
	 * A failed send drops the cached handle before rethrowing: if the handle
	 * itself went stale (chat migrated, session rotated) the retry that the
	 * runtime performs must not keep reusing the broken one.
	 */
	async #sendViaChat(
		cache: Map<string, Promise<LineJsSendableChat>>,
		request: SendTextRequest,
		resolve: (targetId: string) => Promise<LineJsSendableChat>,
	): Promise<void> {
		let pending = cache.get(request.targetId);
		if (!pending) {
			pending = resolve(request.targetId);
			cache.set(request.targetId, pending);
			pending.catch(() => cache.delete(request.targetId));
		}
		try {
			const chat = await pending;
			await chat.sendMessage({ text: request.text, relatedMessageId: request.relatedMessageId });
		} catch (error) {
			cache.delete(request.targetId);
			throw error;
		}
	}

	async listTargets(): Promise<BotTarget[]> {
		const client = this.#requireClient();
		const targets: BotTarget[] = [];
		if (this.#config.enableTalk ?? true) {
			for (const chat of await client.fetchJoinedChats()) {
				const memberMids = chat.raw?.extra?.groupExtra?.memberMids;
				// Discovery already holds a live handle for every joined chat --
				// keeping it means the first reply to any of them skips the
				// `getChat` round trip entirely.
				this.#talkChats.set(chat.mid, Promise.resolve(chat));
				targets.push({
					id: chat.mid,
					kind: "group",
					name: chat.name,
					memberCount: memberMids ? Object.keys(memberMids).length : undefined,
				});
			}
			// Bank notification accounts are direct friend/OA conversations,
			// not joined group chats. Include friends in discovery so the
			// operator can explicitly allowlist KBank Live, Krungthai Connext,
			// SCB Connect, or another trusted OA as a payment source.
			try {
				for (const user of await fetchDirectUsers(client)) {
					targets.push({
						id: user.mid,
						kind: "user",
						name: user.raw?.targetProfileDetail?.profileName ?? user.raw?.displayName ?? user.mid,
						memberCount: 1,
					});
				}
			} catch {
				// Old LINE sessions can lack the relation-service capability;
				// group/OpenChat discovery still remains useful in that case.
			}
		}
		if (this.#config.enableSquare ?? true) {
			const squareChats = await client.fetchJoinedSquareChats();
			const withMembers = await Promise.all(squareChats.map(async (chat) => {
				this.#squareChats.set(chat.raw.squareChatMid, Promise.resolve(chat));
				let memberCount: number | undefined;
				try {
					// Bounded so one slow/hanging roster fetch can't stall
					// discovery for every other chat -- each is a separate
					// paginated call to LINE's servers, not a local lookup.
					memberCount = (await withTimeout(
						chat.getMembers(),
						ROSTER_FETCH_TIMEOUT_MS,
						"Roster fetch timed out",
					)).length;
				} catch {
					memberCount = undefined;
				}
				return {
					id: chat.raw.squareChatMid,
					kind: "openchat" as const,
					name: chat.raw.name,
					memberCount,
				};
			}));
			targets.push(...withMembers);
		}
		return targets;
	}

	subscribeEvents(listener: AdapterEventListener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	subscribeAuthEvents(listener: (event: AdapterAuthEvent) => void): () => void {
		this.#authListeners.add(listener);
		return () => this.#authListeners.delete(listener);
	}

	async health(): Promise<AdapterHealth> {
		const watches = [...this.#historyWatches.values()].filter((watch) => watch.expiresAt > Date.now());
		const historyPollIntervalMs = this.#config.historyPollIntervalMs ?? DEFAULT_HISTORY_POLL_INTERVAL_MS;
		const historyFreshnessMs = historyPollIntervalMs * 3 + HISTORY_FETCH_TIMEOUT_MS;
		const fallbackReady = watches.every((watch) =>
			Boolean(watch.lastSuccessAt) &&
			!watch.lastError &&
			Date.now() - (watch.lastSuccessAt ?? 0) <= historyFreshnessMs
		);
		return {
			connected: Boolean(this.#client) && fallbackReady,
			detail: this.#client
				? watches.length
					? fallbackReady
						? `LINEJS push + history fallback active (${watches.length} target${watches.length === 1 ? "" : "s"})`
						: `LINEJS history fallback unavailable: ${watches.find((watch) => watch.lastError)?.lastError ?? "initializing"}`
					: `LINEJS push listener active${this.#lastInboundAt ? `; last inbound ${new Date(this.#lastInboundAt).toISOString()}` : ""}`
				: (this.#lastError ?? "disconnected"),
			checkedAt: Date.now(),
		};
	}

	capabilities(): AdapterCapabilities {
		return {
			inboundEvents: true,
			listTargets: true,
			openChat: true,
			reply: true,
		};
	}

	async watchTarget(targetId: string, durationMs: number): Promise<void> {
		if (!this.#client) throw new Error("LINEJS adapter is not connected");
		if (!targetId.startsWith("u")) throw new Error("Reliable history watching is available only for direct LINE user/OA chats");
		const now = Date.now();
		const current = this.#historyWatches.get(targetId);
		this.#historyWatches.set(targetId, current
			? { ...current, expiresAt: Math.max(current.expiresAt, now + durationMs) }
			: { expiresAt: now + durationMs, startedAt: now, initialized: false });
		try {
			await this.#pollHistoryTarget(targetId);
		} catch (error) {
			this.#historyWatches.delete(targetId);
			throw error;
		}
		if (!this.#historyTimer) {
			const intervalMs = Math.max(20, this.#config.historyPollIntervalMs ?? DEFAULT_HISTORY_POLL_INTERVAL_MS);
			this.#historyTimer = setInterval(() => void this.#pollWatchedHistory(), intervalMs);
			this.#historyTimer.unref();
		}
	}

	async #onTalkMessage(message: LineJsTalkMessage): Promise<void> {
		const messageId = message.raw.id;
		if (messageId && (this.#seenTalkMessageIds.has(messageId) || this.#processingTalkMessageIds.has(messageId))) return;
		if (messageId) this.#processingTalkMessageIds.add(messageId);
		try {
			const isBot = Boolean(message.isMyMessage);
			const targetKind = normalizeTalkTarget(message.to.type);
			const targetId = targetKind === "user" && !isBot ? message.from.id : message.to.id;
			const text = await extractTalkMessageText(message);
			this.#lastInboundAt = Date.now();
			await this.#emit({
				eventId: messageId ?? randomUUID(),
				targetId,
				targetKind,
				senderId: message.from.id,
				text,
				timestamp: normalizeTimestamp(message.raw.createdTime),
				source: "linejs",
				isBot,
				rawType: "talk-message",
			});
			if (messageId) this.#rememberMessageId(messageId);
		} finally {
			if (messageId) this.#processingTalkMessageIds.delete(messageId);
		}
	}

	async #pollWatchedHistory(): Promise<void> {
		if (this.#historyPollInFlight) return;
		this.#historyPollInFlight = true;
		try {
			const now = Date.now();
			for (const [targetId, watch] of this.#historyWatches) {
				if (watch.expiresAt <= now) {
					this.#historyWatches.delete(targetId);
					continue;
				}
				try {
					await this.#pollHistoryTarget(targetId);
				} catch {
					// State retains the error for adapter health; the next tick retries.
				}
			}
			if (this.#historyWatches.size === 0 && this.#historyTimer) {
				clearInterval(this.#historyTimer);
				this.#historyTimer = undefined;
			}
		} finally {
			this.#historyPollInFlight = false;
		}
	}

	async #pollHistoryTarget(targetId: string): Promise<void> {
		const watch = this.#historyWatches.get(targetId);
		if (!watch) return;
		try {
			const messages = await withTimeout(
				this.#fetchHistoryMessages(targetId),
				HISTORY_FETCH_TIMEOUT_MS,
				"LINE history fetch timed out",
			);
			messages.sort((left, right) => normalizeTimestamp(left.raw.createdTime) - normalizeTimestamp(right.raw.createdTime));
			for (const message of messages) {
				const messageId = message.raw.id;
				if (messageId && this.#seenTalkMessageIds.has(messageId)) continue;
				const timestamp = normalizeTimestamp(message.raw.createdTime);
				if (!watch.initialized && timestamp < watch.startedAt - HISTORY_INITIAL_RACE_WINDOW_MS) {
					if (messageId) this.#rememberMessageId(messageId);
					continue;
				}
				await this.#onTalkMessage(message);
			}
			watch.initialized = true;
			watch.lastSuccessAt = Date.now();
			watch.lastError = undefined;
		} catch (error) {
			watch.lastError = error instanceof Error ? error.message : String(error);
			throw new Error(`Cannot read recent LINE messages for payment verification: ${watch.lastError}`, { cause: error });
		}
	}

	/**
	 * Reads a Talk message box directly instead of resolving a `Chat`.
	 *
	 * LINE's `getChat()` RPC returns group/room metadata only. A bank OA is a
	 * direct user conversation (`u...`), so asking LINEJS to construct `Chat`
	 * from that response produces `undefined.chatMid`. Message boxes cover both
	 * direct and group conversations and are therefore the correct history API.
	 */
	async #fetchHistoryMessages(targetId: string): Promise<LineJsTalkMessage[]> {
		const client = this.#requireClient();
		const talk = client.base?.talk;
		if (!talk?.getMessageBoxes || !talk.getPreviousMessagesV2WithRequest) {
			throw new Error("Installed LINEJS does not expose direct message-box history");
		}
		const boxes = await talk.getMessageBoxes({ messageBoxListRequest: {} });
		const box = boxes.messageBoxes?.find((candidate) => candidate.id === targetId);
		// A brand-new conversation may not have a message box yet. That is
		// a valid empty baseline; the next poll after the OA sends will see it.
		if (!box) return [];
		if (
			box.lastDeliveredMessageId?.messageId === undefined ||
			box.lastDeliveredMessageId.deliveredTime === undefined
		) {
			throw new Error("LINE message box is missing its delivery cursor");
		}
		const rawMessages = await talk.getPreviousMessagesV2WithRequest({
			request: {
				messageBoxId: box.id,
				endMessageId: {
					messageId: box.lastDeliveredMessageId.messageId,
					deliveredTime: box.lastDeliveredMessageId.deliveredTime,
				},
				messagesCount: HISTORY_LOOKBACK_MESSAGES,
			},
		});
		const messages: LineJsTalkMessage[] = [];
		for (const rawMessage of rawMessages) {
			if (this.#fromRawTalk) {
				messages.push(await this.#fromRawTalk(rawMessage, client));
				continue;
			}
			let message = rawMessage;
			if (
				message.contentMetadata?.e2eeVersion &&
				client.base?.e2ee.decryptE2EEMessage
			) {
				message = await client.base.e2ee.decryptE2EEMessage(message);
			}
			messages.push(toTalkMessage(message, client.base?.profile?.mid));
		}
		return messages;
	}

	#rememberMessageId(messageId: string): void {
		this.#seenTalkMessageIds.set(messageId, true);
		if (this.#seenTalkMessageIds.size <= MAX_SEEN_MESSAGE_IDS) return;
		const oldest = this.#seenTalkMessageIds.keys().next().value;
		if (oldest) this.#seenTalkMessageIds.delete(oldest);
	}

	async #onSquareMessage(message: LineJsSquareMessage): Promise<void> {
		let isBot = false;
		try {
			isBot = await message.isMyMessage();
		} catch {
			// Keep the event, but do not assume it was authored by this bot.
		}
		await this.#emit({
			eventId: message.raw.message?.id ?? randomUUID(),
			targetId: message.to.id,
			targetKind: "openchat",
			senderId: message.from.id,
			text: message.text ?? "",
			timestamp: normalizeTimestamp(message.raw.message?.createdTime),
			source: "linejs",
			isBot,
			rawType: "square-message",
		});
	}

	async #emit(event: NormalizedInboundEvent): Promise<void> {
		for (const listener of [...this.#listeners]) await listener(event);
	}

	#emitAuth(event: AdapterAuthEvent): void {
		for (const listener of [...this.#authListeners]) listener(event);
	}

	/**
	 * Guarantee this account has a usable E2EE self-key before any send.
	 *
	 * LINE letter-sealing (E2EE) is enforced by many groups; sending into one
	 * without a stored private key throws "E2EE Key has not been saved". The key
	 * is normally registered during the interactive QR login, but token-based
	 * reconnects never re-run that step -- so with a fresh (or first-run)
	 * storage we register a key pair ourselves. With persistent storage this
	 * runs at most once per bot; afterwards the saved key is reused and no new
	 * key is churned onto the account.
	 */
	async #ensureE2EEKey(): Promise<void> {
		const base = this.#client?.base;
		if (!base) return;
		try {
			const mid = base.profile?.mid;
			if (mid) {
				try {
					// Throws if neither storage nor the server yields a usable
					// self-key; resolves (and back-fills storage) if one exists.
					await base.e2ee.getE2EESelfKeyData(mid);
					return;
				} catch {
					// No usable key -- fall through to register a fresh pair.
				}
			}
			await base.e2ee.registerE2EEKeyPair();
		} catch (error) {
			// Non-fatal: sends to non-E2EE targets still work, and a real send
			// into an E2EE group will surface its own actionable error.
			this.#lastError = error instanceof Error ? error.message : String(error);
		}
	}

	/**
	 * Compact-send a group message, skipping the doomed plain attempt for
	 * targets already known to enforce E2EE.
	 *
	 * LINE's compact endpoint tries a plain send first and only falls back to
	 * E2EE after the server rejects it -- a wasted round trip (~100ms) on every
	 * message to a letter-sealed group. Once we've seen a target require E2EE we
	 * send E2EE directly. Non-sealed groups keep succeeding on the plain path
	 * and are never marked, so they pay nothing.
	 */
	async #sendCompact(client: LineJsClient, targetId: string, text: string): Promise<void> {
		if (this.#e2eeTargets.has(targetId)) {
			await client.sendCompactMessage(targetId, { text, e2ee: true });
			return;
		}
		try {
			// `e2ee: false` disables the library's own (slower) internal retry so
			// a sealed group fails fast here and we can handle + remember it.
			await client.sendCompactMessage(targetId, { text, e2ee: false });
		} catch (plainError) {
			// Plain rejected (usually because the group enforces E2EE). Retry
			// E2EE; if that works this target is sealed, so remember it and skip
			// the plain attempt next time. If E2EE also fails it was a genuine
			// error -- surface the original.
			try {
				await client.sendCompactMessage(targetId, { text, e2ee: true });
			} catch {
				throw plainError;
			}
			this.#e2eeTargets.add(targetId);
			void this.#persistSealedTargets();
		}
	}

	async #restoreSealedTargets(): Promise<void> {
		try {
			const stored = await this.#storage.get(SEALED_TARGETS_KEY);
			if (typeof stored !== "string") return;
			const parsed: unknown = JSON.parse(stored);
			if (!Array.isArray(parsed)) return;
			for (const id of parsed) if (typeof id === "string") this.#e2eeTargets.add(id);
		} catch {
			// A missing or unreadable list only costs one wasted plain send per
			// sealed group, so it is never worth failing the connection over.
		}
	}

	async #persistSealedTargets(): Promise<void> {
		try {
			await this.#storage.set(SEALED_TARGETS_KEY, JSON.stringify([...this.#e2eeTargets]));
		} catch {
			// Same rationale as #restoreSealedTargets: best-effort only.
		}
	}

	#requireClient(): LineJsClient {
		if (!this.#client) throw new Error("LINEJS adapter is not connected");
		return this.#client;
	}
}

type FetchLike = (request: Request) => Promise<Response>;

let keepAliveFetch: FetchLike | null | undefined;

/**
 * Builds a `fetch` that reuses connections to LINE for {@link KEEP_ALIVE_TIMEOUT_MS}.
 *
 * Resolved once per process and shared by every client, so all traffic lands on
 * the same connection pool. Returns null when undici is unavailable, in which
 * case the client falls back to the platform default (correct, just slower).
 */
async function createKeepAliveFetch(): Promise<FetchLike | null> {
	if (keepAliveFetch !== undefined) return keepAliveFetch;
	try {
		// undici ships its own structural copies of Response/Headers, which do
		// not unify with the platform lib types; the values are interchangeable
		// at runtime, so the boundary is typed loosely here on purpose.
		const { Agent, fetch: undiciFetch } = await import("undici") as unknown as {
			Agent: new (options: Record<string, unknown>) => unknown;
			fetch: (input: unknown, init?: Record<string, unknown>) => Promise<Response>;
		};
		const dispatcher = new Agent({
			keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
			keepAliveMaxTimeout: KEEP_ALIVE_TIMEOUT_MS,
			// LINE's long-polling request occupies a connection for minutes at a
			// time; without headroom every outgoing message would have to open a
			// new one anyway.
			connections: 8,
		});
		keepAliveFetch = async (request: Request) => {
			// The caller hands us a global `Request`, which this bundled undici
			// would not recognise as its own; pass the parts explicitly instead.
			// LINE payloads are small Thrift frames, so buffering costs nothing.
			const body = request.method === "GET" || request.method === "HEAD"
				? undefined
				: new Uint8Array(await request.arrayBuffer());
			return await undiciFetch(request.url, {
				method: request.method,
				headers: [...request.headers],
				body,
				signal: request.signal,
				dispatcher,
			});
		};
	} catch {
		keepAliveFetch = null;
	}
	return keepAliveFetch;
}

function normalizeTalkTarget(value: unknown): TargetKind {
	if (value === "GROUP" || value === 2) return "group";
	if (value === "ROOM" || value === 1) return "room";
	return "user";
}

function toTalkMessage(raw: LineJsRawTalkMessage, selfMid?: string): LineJsTalkMessage {
	return {
		raw,
		to: {
			id: typeof raw.to === "string" ? raw.to : "",
			type: raw.toType,
		},
		from: {
			id: typeof raw.from === "string" ? raw.from : "",
		},
		text: typeof raw.text === "string" ? raw.text : undefined,
		isMyMessage: Boolean(selfMid && raw.from === selfMid),
	};
}

function normalizeTimestamp(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "bigint") return Number(value);
	if (value && typeof value === "object" && "toNumber" in value) {
		try {
			return Number((value as { toNumber(): number }).toNumber());
		} catch {
			return Date.now();
		}
	}
	return Date.now();
}
