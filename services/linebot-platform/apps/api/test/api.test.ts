import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

/** Pulls just the `name=value` pair back out of a Set-Cookie header for reuse as a request Cookie header. */
function sessionCookieFrom(response: Response): string {
	const setCookie = response.headers.get("set-cookie");
	if (!setCookie) throw new Error("Expected a Set-Cookie header");
	return setCookie.split(";")[0]!;
}

describe("control API", () => {
	it("returns an aggregate local dashboard payload", async () => {
		const { app } = createApp();
		const response = await app.request("/v1/dashboard/overview");
		const body = await response.json();
		expect(response.status).toBe(200);
		expect(body.error).toBeNull();
		expect(body.data.bots).toHaveLength(0);
		expect(body.data.rules).toHaveLength(0);
	});

	it("requires risk acknowledgement for a LINEJS bot", async () => {
		const { app } = createApp();
		const response = await app.request("/v1/bots", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "OpenChat Bot", adapter: "linejs" }),
		});
		expect(response.status).toBe(422);
		const body = await response.json();
		expect(body.error.code).toBe("RISK_ACKNOWLEDGEMENT_REQUIRED");
	});

	it("rejects sending to a target without consent", async () => {
		const { app } = createApp();
		const botResponse = await app.request("/v1/bots", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Official Bot", adapter: "official" }),
		});
		const bot = (await botResponse.json()).data;
		const targetResponse = await app.request(`/v1/bots/${bot.id}/targets`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ externalId: "C-group-1", type: "group", name: "Test group", consentConfirmed: false }),
		});
		const target = (await targetResponse.json()).data;
		const response = await app.request(`/v1/bots/${bot.id}/messages`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ targetId: target.id, text: "hello" }),
		});
		expect(response.status).toBe(403);
	});

	it("accepts the extreme speed profile and fills in its numeric defaults", async () => {
		const { app } = createApp();
		const response = await app.request("/v1/bots", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Fast Bot", adapter: "official", speedProfile: "extreme" }),
		});
		expect(response.status).toBe(201);
		const bot = (await response.json()).data;
		expect(bot.speedProfile).toBe("extreme");
		expect(bot.maxMessagesPerSecond).toBeGreaterThan(0);
		expect(bot.burst).toBeGreaterThan(0);
	});

	it("rejects a custom rate above what the worker's rate limiter will ever accept", async () => {
		// Regression test: this schema ceiling and the runtime's own limit
		// (MAX_MESSAGES_PER_SECOND in @linebot/bot-worker) used to disagree --
		// 2000 here vs. 1000 at runtime -- so a bot could pass creation and then
		// fail to start with an uncaught RangeError from validateBotConfig.
		const { app } = createApp();
		const response = await app.request("/v1/bots", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Too Fast Bot", adapter: "official", speedProfile: "custom", maxMessagesPerSecond: 1500, burst: 10 }),
		});
		expect(response.status).toBe(422);
		const body = await response.json();
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});

	it("returns fleet-wide settings with sane defaults and persists a patch", async () => {
		const { app } = createApp();
		const initial = await app.request("/v1/settings");
		expect(initial.status).toBe(200);
		const before = (await initial.json()).data;
		expect(before.defaultSpeedProfile).toBe("balanced");
		expect(before.defaultTimezone).toBe("Asia/Bangkok");

		const patched = await app.request("/v1/settings", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ defaultSpeedProfile: "extreme", gracefulDrainTimeoutMs: 15_000 }),
		});
		expect(patched.status).toBe(200);
		const after = (await patched.json()).data;
		expect(after.defaultSpeedProfile).toBe("extreme");
		expect(after.gracefulDrainTimeoutMs).toBe(15_000);
		// Untouched fields survive the patch.
		expect(after.firstResponseWindowMs).toBe(before.firstResponseWindowMs);

		const refetched = await (await app.request("/v1/settings")).json();
		expect(refetched.data.defaultSpeedProfile).toBe("extreme");
	});

	it("rejects a settings patch outside the allowed range", async () => {
		const { app } = createApp();
		const response = await app.request("/v1/settings", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ gracefulDrainTimeoutMs: 999_999 }),
		});
		expect(response.status).toBe(422);
	});

	it("reports security checks as booleans without ever leaking the compared secret", async () => {
		const { app } = createApp();
		const response = await app.request("/v1/system/security");
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(typeof body.data.score).toBe("number");
		expect(Array.isArray(body.data.checks)).toBe(true);
		const serialized = JSON.stringify(body.data);
		expect(serialized).not.toContain("change-me-before-production");
		expect(serialized).not.toContain("local-development-secret-change-me");
		expect(serialized).not.toContain("local-development-encryption-key");
	});

	it("reports real resource usage instead of the removed mockup numbers", async () => {
		const { app } = createApp();
		const response = await app.request("/v1/system/resources");
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.data.storage.persistent).toBe(false); // tests run against :memory:
		expect(body.data.totalBots).toBe(0);
		expect(body.data.activeBots).toBe(0);
	});

	it("can immediately stop every bot", async () => {
		const { app } = createApp();
		const botResponse = await app.request("/v1/bots", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Official Bot", adapter: "official" }),
		});
		const bot = (await botResponse.json()).data;
		const response = await app.request("/v1/control/emergency-stop", { method: "POST" });
		expect(response.status).toBe(200);
		const botStatusResponse = await app.request(`/v1/bots/${bot.id}`);
		const body = await botStatusResponse.json();
		expect(body.data.status).toBe("stopped");
	});
});

describe("auth enforcement", () => {
	const ORIGINAL_ENV = { ...process.env };
	afterEach(() => {
		for (const key of ["REQUIRE_AUTH", "ADMIN_EMAIL", "ADMIN_PASSWORD", "JWT_SECRET", "NODE_ENV"] as const) {
			if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
			else process.env[key] = ORIGINAL_ENV[key];
		}
	});

	it("leaves every route open when REQUIRE_AUTH is unset, matching the single-operator local default", async () => {
		delete process.env.REQUIRE_AUTH;
		const { app } = createApp();
		const response = await app.request("/v1/dashboard/overview");
		expect(response.status).toBe(200);
		const me = await (await app.request("/v1/auth/me")).json();
		expect(me.data).toMatchObject({ localMode: true, authenticated: true });
	});

	it("blocks protected routes without a session once REQUIRE_AUTH is true", async () => {
		process.env.REQUIRE_AUTH = "true";
		const { app } = createApp();
		const response = await app.request("/v1/dashboard/overview");
		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("rejects the wrong password instead of issuing a session", async () => {
		process.env.REQUIRE_AUTH = "true";
		process.env.ADMIN_EMAIL = "admin@localhost";
		process.env.ADMIN_PASSWORD = "correct-horse-battery-staple";
		const { app } = createApp();
		const response = await app.request("/v1/auth/login", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "admin@localhost", password: "wrong" }),
		});
		expect(response.status).toBe(401);
		expect(response.headers.get("set-cookie")).toBeNull();
	});

	it("issues a secure cross-site session cookie in production", async () => {
		process.env.NODE_ENV = "production";
		process.env.ADMIN_EMAIL = "admin@localhost";
		process.env.ADMIN_PASSWORD = "correct-horse-battery-staple";
		process.env.JWT_SECRET = "test-only-secret-at-least-32-characters-long";
		const { app } = createApp();

		const response = await app.request("/v1/auth/login", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "admin@localhost", password: "correct-horse-battery-staple" }),
		});

		expect(response.status).toBe(200);
		const setCookie = response.headers.get("set-cookie");
		expect(setCookie).toContain("HttpOnly");
		expect(setCookie).toContain("Secure");
		expect(setCookie).toContain("SameSite=None");

		const logout = await app.request("/v1/auth/logout", { method: "POST" });
		const clearedCookie = logout.headers.get("set-cookie");
		expect(clearedCookie).toContain("Secure");
		expect(clearedCookie).toContain("SameSite=None");
	});

	it("grants access after login and revokes it on logout", async () => {
		process.env.REQUIRE_AUTH = "true";
		process.env.ADMIN_EMAIL = "admin@localhost";
		process.env.ADMIN_PASSWORD = "correct-horse-battery-staple";
		process.env.JWT_SECRET = "test-only-secret-at-least-32-characters-long";
		const { app } = createApp();

		const login = await app.request("/v1/auth/login", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "admin@localhost", password: "correct-horse-battery-staple" }),
		});
		expect(login.status).toBe(200);
		const cookie = sessionCookieFrom(login);

		const authed = await app.request("/v1/dashboard/overview", { headers: { cookie } });
		expect(authed.status).toBe(200);

		const meAuthed = await (await app.request("/v1/auth/me", { headers: { cookie } })).json();
		expect(meAuthed.data).toMatchObject({ localMode: false, authenticated: true });

		const logout = await app.request("/v1/auth/logout", { method: "POST", headers: { cookie } });
		expect(logout.status).toBe(200);
		const clearedCookie = sessionCookieFrom(logout);

		const afterLogout = await app.request("/v1/dashboard/overview", { headers: { cookie: clearedCookie } });
		expect(afterLogout.status).toBe(401);
	});
});
