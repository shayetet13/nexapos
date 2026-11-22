import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_MESSAGES_PER_SECOND, MIN_MESSAGE_INTERVAL_MS, validateBotConfig } from "../src/contracts.ts";

function baseConfig() {
	return {
		botId: "bot_1",
		adapter: { kind: "official" as const, channelAccessToken: "token" },
	};
}

test("MIN_MESSAGE_INTERVAL_MS is the exact inverse of MAX_MESSAGES_PER_SECOND", () => {
	assert.equal(MIN_MESSAGE_INTERVAL_MS, 1000 / MAX_MESSAGES_PER_SECOND);
});

test("validateBotConfig accepts a rate exactly at the ceiling", () => {
	assert.doesNotThrow(() =>
		validateBotConfig({ ...baseConfig(), rateLimit: { messagesPerSecond: MAX_MESSAGES_PER_SECOND, burst: 1 } })
	);
});

test("validateBotConfig rejects a rate above the ceiling, matching the API's own limit", () => {
	assert.throws(
		() => validateBotConfig({ ...baseConfig(), rateLimit: { messagesPerSecond: MAX_MESSAGES_PER_SECOND + 1, burst: 1 } }),
		RangeError,
	);
});
