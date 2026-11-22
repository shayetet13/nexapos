import { describe, expect, it } from "vitest";
import { assertSafeConfig, findUnsafeConfig } from "../src/boot-guard.ts";

const SAFE_EXPOSED = {
	NODE_ENV: "production",
	REQUIRE_AUTH: "true",
	ENCRYPTION_KEY: "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MDEyMzQ1Njc4OTA=",
	JWT_SECRET: "a-real-secret-with-more-than-thirty-two-chars",
	ADMIN_PASSWORD: "a-strong-admin-password",
} as NodeJS.ProcessEnv;

describe("boot guard", () => {
	it("allows loopback development with the built-in defaults", () => {
		expect(findUnsafeConfig({ NODE_ENV: "development" } as NodeJS.ProcessEnv, "127.0.0.1")).toEqual([]);
		expect(findUnsafeConfig({} as NodeJS.ProcessEnv, "localhost")).toEqual([]);
	});

	it("refuses an exposed bind without auth or real secrets", () => {
		const problems = findUnsafeConfig({ NODE_ENV: "development" } as NodeJS.ProcessEnv, "0.0.0.0");
		expect(problems).toHaveLength(4);
		expect(() => assertSafeConfig({ NODE_ENV: "development" } as NodeJS.ProcessEnv, "0.0.0.0")).toThrow(/Refusing to start/);
	});

	it("treats production as exposed even on loopback", () => {
		expect(findUnsafeConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv, "127.0.0.1").length).toBeGreaterThan(0);
	});

	it("rejects .env.example placeholders and the public code defaults", () => {
		const env = {
			...SAFE_EXPOSED,
			ENCRYPTION_KEY: "replace-with-a-base64-encoded-32-byte-key",
			JWT_SECRET: "replace-with-at-least-32-random-characters",
			ADMIN_PASSWORD: "change-me-before-production",
		} as NodeJS.ProcessEnv;
		expect(findUnsafeConfig(env, "0.0.0.0")).toHaveLength(3);
		expect(findUnsafeConfig({ ...SAFE_EXPOSED, ENCRYPTION_KEY: "local-development-encryption-key" } as NodeJS.ProcessEnv, "0.0.0.0")).toHaveLength(1);
	});

	it("rejects a short JWT secret", () => {
		expect(findUnsafeConfig({ ...SAFE_EXPOSED, JWT_SECRET: "short" } as NodeJS.ProcessEnv, "0.0.0.0")).toHaveLength(1);
	});

	it("accepts an exposed bind with auth and real secrets", () => {
		expect(findUnsafeConfig(SAFE_EXPOSED, "0.0.0.0")).toEqual([]);
		expect(() => assertSafeConfig(SAFE_EXPOSED, "0.0.0.0")).not.toThrow();
	});
});
