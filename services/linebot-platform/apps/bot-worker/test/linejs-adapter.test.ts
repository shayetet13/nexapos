import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { extractTalkMessageText, LineJsAdapter } from "../src/adapters/linejs-adapter.ts";
import type { SendTextRequest } from "../src/contracts.ts";

/**
 * Stands in for `@evex/linejs`. Counts how often the adapter asks LINE to
 * resolve a chat, which is a network round trip per call.
 */
function createFakeModule(
	users: Array<{ mid: string; raw: { targetProfileDetail: { profileName: string } } }> = [],
	contactUsers: Array<{ mid: string; raw: { targetProfileDetail: { profileName: string } } }> = [],
	historyMessages: Array<Record<string, unknown>> = [],
) {
	const calls = {
		getChat: 0,
		getSquareChat: 0,
		getMessageBoxes: 0,
		getPreviousMessages: 0,
		sent: [] as string[],
	};
	const chat = {
		sendMessage(input: { text: string }) {
			calls.sent.push(input.text);
			return Promise.resolve({});
		},
		fetchMessages() {
			return Promise.resolve([...historyMessages]);
		},
	};
	const client = {
		authToken: "token",
		base: {
			profile: { mid: "u1" },
			e2ee: { getE2EESelfKeyData: () => Promise.resolve({}), registerE2EEKeyPair: () => Promise.resolve({}) },
			relation: {
				getUserFriendIds: () => Promise.resolve({
					userFriendMids: contactUsers.map((user) => user.mid),
					nextUserPageToken: "",
				}),
			},
			talk: {
				getAllContactIds: () => Promise.resolve(contactUsers.map((user) => user.mid)),
				getMessageBoxes: () => {
					calls.getMessageBoxes++;
					return Promise.resolve({
						messageBoxes: [{
							id: "u-kbank",
							lastDeliveredMessageId: { messageId: 1, deliveredTime: Date.now() },
						}],
					});
				},
				getPreviousMessagesV2WithRequest: () => {
					calls.getPreviousMessages++;
					return Promise.resolve(historyMessages.map((message) => {
						const raw = (message.raw ?? {}) as Record<string, unknown>;
						const to = message.to as { id?: string; type?: unknown } | undefined;
						const from = message.from as { id?: string } | undefined;
						return {
							...raw,
							to: to?.id ?? raw.to,
							toType: to?.type ?? raw.toType,
							from: from?.id ?? raw.from,
							text: message.text ?? raw.text,
						};
					}));
				},
			},
		},
		on() {},
		listen() {},
		fetchJoinedChats: () => Promise.resolve([]),
		fetchUsers: () => Promise.resolve(users),
		getUser: (id: string) => {
			const user = contactUsers.find((item) => item.mid === id);
			return user ? Promise.resolve(user) : Promise.reject(new Error("not found"));
		},
		fetchJoinedSquareChats: () => Promise.resolve([]),
		getChat(_id: string) {
			calls.getChat++;
			return Promise.resolve(chat);
		},
		getSquareChat(_id: string) {
			calls.getSquareChat++;
			return Promise.resolve(chat);
		},
		sendCompactMessage: () => Promise.resolve({}),
	};
	return {
		calls,
		module: {
			TalkMessage: {
				fromRawTalk: (
					raw: Record<string, unknown>,
					sourceClient: { base: { profile?: { mid?: string } } },
				) => Promise.resolve({
					raw,
					to: { id: raw.to, type: raw.toType },
					from: { id: raw.from },
					text: raw.text,
					isMyMessage: sourceClient.base.profile?.mid === raw.from,
				}),
			},
			loginWithAuthToken: () => Promise.resolve(client),
			loginWithQR: () => Promise.resolve(client),
		},
	};
}

let fakeCounter = 0;

test("extracts visible text nodes from a LINE bank Flex message", async () => {
	const text = await extractTalkMessageText({
		raw: { id: "m1" },
		to: { id: "u-me", type: 0 },
		from: { id: "u-kbank" },
		isMyMessage: false,
		getFlex: () => Promise.resolve({
			flexJson: JSON.stringify({
				type: "bubble",
				body: {
					type: "box",
					contents: [
						{ type: "text", text: "รายการเงินเข้า" },
						{ type: "text", text: "จำนวนเงิน" },
						{ type: "text", text: "1.00 บาท" },
					],
				},
			}),
		}),
	});
	assert.equal(text, "รายการเงินเข้า\nจำนวนเงิน\n1.00 บาท");
});

test("extracts styled span text from a double-encoded bank Flex payload", async () => {
	const flex = JSON.stringify(JSON.stringify({
		type: "bubble",
		body: {
			type: "box",
			contents: [
				{ type: "text", contents: [{ type: "span", text: "รายการเงินเข้า" }] },
				{ type: "text", text: "จำนวนเงิน" },
				{ type: "text", contents: [{ type: "span", text: "1.00" }, { type: "span", text: " บาท" }] },
			],
		},
	}));
	const text = await extractTalkMessageText({
		raw: { id: "m2", contentMetadata: { FLEX_JSON: flex, ALT_TEXT: "แจ้งเตือนเงินเข้า" } },
		to: { id: "u-me", type: 0 },
		from: { id: "u-kbank" },
		isMyMessage: false,
		getFlex: () => { throw new TypeError("numeric content type"); },
	});
	assert.equal(text, "รายการเงินเข้า\nจำนวนเงิน\n1.00\nบาท\nแจ้งเตือนเงินเข้า");
});

test("discovers direct friend/OA chats as user targets", async () => {
	const dir = mkdtempSync(join(tmpdir(), "linejs-adapter-"));
	process.env.LINEJS_STORAGE_DIR = dir;
	try {
		const fake = createFakeModule([{ mid: "u-kbank", raw: { targetProfileDetail: { profileName: "KBank Live" } } }]);
		const adapter = new LineJsAdapter({
			kind: "linejs",
			loginMode: "token",
			authToken: "token-value",
			moduleSpecifier: fakeSpecifier(fake),
		});
		await adapter.connect();
		assert.deepEqual(await adapter.listTargets(), [{
			id: "u-kbank",
			kind: "user",
			name: "KBank Live",
			memberCount: 1,
		}]);
	} finally {
		delete process.env.LINEJS_STORAGE_DIR;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("discovers a bank OA present only in the full contact roster", async () => {
	const dir = mkdtempSync(join(tmpdir(), "linejs-adapter-"));
	process.env.LINEJS_STORAGE_DIR = dir;
	try {
		const fake = createFakeModule([], [{ mid: "u-scb", raw: { targetProfileDetail: { profileName: "SCB Connect" } } }]);
		const adapter = new LineJsAdapter({
			kind: "linejs",
			loginMode: "token",
			authToken: "token-value",
			moduleSpecifier: fakeSpecifier(fake),
		});
		await adapter.connect();
		assert.deepEqual(await adapter.listTargets(), [{
			id: "u-scb",
			kind: "user",
			name: "SCB Connect",
			memberCount: 1,
		}]);
	} finally {
		delete process.env.LINEJS_STORAGE_DIR;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("history fallback emits a bank message missed by the push listener exactly once", async () => {
	const dir = mkdtempSync(join(tmpdir(), "linejs-adapter-"));
	process.env.LINEJS_STORAGE_DIR = dir;
	const history: Array<Record<string, unknown>> = [{
		raw: { id: "old-message", createdTime: Date.now() - 60_000 },
		to: { id: "u-me", type: 0 },
		from: { id: "u-kbank" },
		isMyMessage: false,
		text: "old",
	}];
	try {
		const fake = createFakeModule([], [], history);
		const adapter = new LineJsAdapter({
			kind: "linejs",
			loginMode: "token",
			authToken: "token-value",
			moduleSpecifier: fakeSpecifier(fake),
			historyPollIntervalMs: 20,
		});
		const received: string[] = [];
		adapter.subscribeEvents((event) => { received.push(event.eventId); });
		await adapter.connect();
		await adapter.watchTarget("u-kbank", 1_000);
		assert.deepEqual(received, []);
		history.push({
			raw: { id: "new-bank-message", createdTime: Date.now() },
			to: { id: "u-me", type: 0 },
			from: { id: "u-kbank" },
			isMyMessage: false,
			text: "รายการเงินเข้า จำนวนเงิน 1.00 บาท",
		});
		await new Promise((resolve) => setTimeout(resolve, 80));
		assert.deepEqual(received, ["new-bank-message"]);
		assert.equal(fake.calls.getChat, 0, "direct OA history must not use the group-only getChat API");
		assert.ok(fake.calls.getMessageBoxes >= 2);
		assert.ok(fake.calls.getPreviousMessages >= 2);
		await adapter.disconnect();
	} finally {
		delete process.env.LINEJS_STORAGE_DIR;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("history fallback can arm before a direct OA message box exists", async () => {
	const dir = mkdtempSync(join(tmpdir(), "linejs-adapter-"));
	process.env.LINEJS_STORAGE_DIR = dir;
	const history: Array<Record<string, unknown>> = [];
	try {
		const fake = createFakeModule([], [], history);
		const originalLogin = fake.module.loginWithAuthToken;
		let boxReads = 0;
		fake.module.loginWithAuthToken = async () => {
			const client = await originalLogin() as Awaited<ReturnType<typeof originalLogin>>;
			const originalBoxes = client.base.talk.getMessageBoxes;
			client.base.talk.getMessageBoxes = () => {
				boxReads++;
				return boxReads === 1
					? Promise.resolve({ messageBoxes: [] })
					: originalBoxes();
			};
			return client;
		};
		const adapter = new LineJsAdapter({
			kind: "linejs",
			loginMode: "token",
			authToken: "token-value",
			moduleSpecifier: fakeSpecifier(fake),
			historyPollIntervalMs: 20,
		});
		const received: string[] = [];
		adapter.subscribeEvents((event) => { received.push(event.eventId); });
		await adapter.connect();
		await adapter.watchTarget("u-kbank", 1_000);
		history.push({
			raw: { id: "first-oa-message", createdTime: Date.now() },
			to: { id: "u-me", type: 0 },
			from: { id: "u-kbank" },
			isMyMessage: false,
			text: "รายการเงินเข้า จำนวนเงิน 1.00 บาท",
		});
		await new Promise((resolve) => setTimeout(resolve, 80));
		assert.deepEqual(received, ["first-oa-message"]);
		assert.equal(fake.calls.getChat, 0);
		await adapter.disconnect();
	} finally {
		delete process.env.LINEJS_STORAGE_DIR;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("missing direct-history capability fails clearly without calling getChat", async () => {
	const dir = mkdtempSync(join(tmpdir(), "linejs-adapter-"));
	process.env.LINEJS_STORAGE_DIR = dir;
	try {
		const fake = createFakeModule();
		const originalLogin = fake.module.loginWithAuthToken;
		fake.module.loginWithAuthToken = async () => {
			const client = await originalLogin() as Awaited<ReturnType<typeof originalLogin>>;
			const talk = client.base.talk as Partial<typeof client.base.talk>;
			delete talk.getMessageBoxes;
			delete talk.getPreviousMessagesV2WithRequest;
			return client;
		};
		const adapter = new LineJsAdapter({
			kind: "linejs",
			loginMode: "token",
			authToken: "token-value",
			moduleSpecifier: fakeSpecifier(fake),
		});
		await adapter.connect();
		await assert.rejects(
			() => adapter.watchTarget("u-kbank", 1_000),
			/does not expose direct message-box history/,
		);
		assert.equal(fake.calls.getChat, 0);
		await adapter.disconnect();
	} finally {
		delete process.env.LINEJS_STORAGE_DIR;
		rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * Publishes the fake as an importable module specifier. The slot name is unique
 * per fake because the module registry caches `data:` URLs by content, so two
 * identical stubs would otherwise share the first one's client.
 */
function fakeSpecifier(fake: ReturnType<typeof createFakeModule>): string {
	const slot = `__linejsFake${fakeCounter++}`;
	(globalThis as Record<string, unknown>)[slot] = fake.module;
	const encoded = Buffer.from(
		`export const loginWithAuthToken = (...args) => globalThis.${slot}.loginWithAuthToken(...args);
		 export const loginWithQR = (...args) => globalThis.${slot}.loginWithQR(...args);
		 export const TalkMessage = globalThis.${slot}.TalkMessage;`,
	).toString("base64");
	return `data:text/javascript;base64,${encoded}`;
}

for (const loginMode of ["token", "qr"] as const) {
	test(`${loginMode} login disables LINE's encrypted /enc gateway`, async () => {
		const dir = mkdtempSync(join(tmpdir(), "linejs-adapter-"));
		process.env.LINEJS_STORAGE_DIR = dir;
		try {
			const fake = createFakeModule();
			const originalToken = fake.module.loginWithAuthToken;
			const originalQr = fake.module.loginWithQR;
			let received: { legy?: { encrypted?: unknown } } | undefined;
			fake.module.loginWithAuthToken = (_token?: string, options?: typeof received) => {
				received = options;
				return originalToken();
			};
			fake.module.loginWithQR = (_hooks?: unknown, options?: typeof received) => {
				received = options;
				return originalQr();
			};
			const adapter = new LineJsAdapter({
				kind: "linejs",
				loginMode,
				authToken: "token-value",
				moduleSpecifier: fakeSpecifier(fake),
			});
			await adapter.connect();
			assert.equal(received?.legy?.encrypted, false);
			await adapter.disconnect();
		} finally {
			delete process.env.LINEJS_STORAGE_DIR;
			rmSync(dir, { recursive: true, force: true });
		}
	});
}

function request(overrides: Partial<SendTextRequest> = {}): SendTextRequest {
	return { targetId: "c1", targetKind: "openchat", text: "hello", ...overrides };
}

test("repeat sends to one chat resolve the chat handle only once", async () => {
	const dir = mkdtempSync(join(tmpdir(), "linejs-adapter-"));
	process.env.LINEJS_STORAGE_DIR = dir;
	try {
		const fake = createFakeModule();
		const adapter = new LineJsAdapter({
			kind: "linejs",
			loginMode: "token",
			authToken: "token-value",
			moduleSpecifier: fakeSpecifier(fake),
		});
		await adapter.connect();

		for (let index = 0; index < 5; index++) await adapter.sendText(request());
		assert.equal(fake.calls.sent.length, 5);
		assert.equal(fake.calls.getSquareChat, 1, "chat lookup should be cached across sends");

		// Talk replies (which carry relatedMessageId, so they cannot use the
		// compact endpoint) get the same treatment.
		for (let index = 0; index < 3; index++) {
			await adapter.sendText(request({ targetKind: "group", relatedMessageId: "m1" }));
		}
		assert.equal(fake.calls.getChat, 1);
	} finally {
		delete process.env.LINEJS_STORAGE_DIR;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a failed send drops the cached handle so the next attempt re-resolves it", async () => {
	const dir = mkdtempSync(join(tmpdir(), "linejs-adapter-"));
	process.env.LINEJS_STORAGE_DIR = dir;
	try {
		const fake = createFakeModule();
		let failNext = true;
		const original = fake.module.loginWithAuthToken;
		fake.module.loginWithAuthToken = async () => {
			const client = await original() as Record<string, unknown> & {
				getSquareChat: (id: string) => Promise<unknown>;
			};
			const wrapped = client.getSquareChat.bind(client);
			client.getSquareChat = async (id: string) => {
				const chat = await wrapped(id) as { sendMessage: (input: { text: string }) => Promise<unknown> };
				return {
					sendMessage: (input: { text: string }) => {
						if (failNext) {
							failNext = false;
							return Promise.reject(new Error("transient"));
						}
						return chat.sendMessage(input);
					},
				};
			};
			return client as never;
		};

		const adapter = new LineJsAdapter({
			kind: "linejs",
			loginMode: "token",
			authToken: "token-value",
			moduleSpecifier: fakeSpecifier(fake),
		});
		await adapter.connect();

		await assert.rejects(() => adapter.sendText(request()), /transient/);
		await adapter.sendText(request());
		assert.equal(fake.calls.getSquareChat, 2, "a stale handle must not be reused after a failure");
	} finally {
		delete process.env.LINEJS_STORAGE_DIR;
		rmSync(dir, { recursive: true, force: true });
	}
});
