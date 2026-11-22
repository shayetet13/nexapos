import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { MemoryStore } from "./store.js";
import { SecretVault } from "./secret-vault.js";
import { assertSafeConfig } from "./boot-guard.js";

// Local secrets live in .env.local next to this app (never committed --
// see .env.example at the repo root for the full list). Containerized
// deploys skip this file entirely and inject real env vars directly.
try {
	process.loadEnvFile(new URL("../.env.local", import.meta.url));
} catch {
	// No .env.local present -- fall back to whatever the environment provides.
}

const port = Number.parseInt(process.env.API_PORT ?? "8787", 10);
// Loopback by default: with REQUIRE_AUTH off the control API is unauthenticated, so
// binding every interface must be an explicit choice (containers set API_HOST=0.0.0.0).
const hostname = process.env.API_HOST ?? "127.0.0.1";
assertSafeConfig(process.env, hostname);
const dbPath = process.env.DATABASE_PATH ?? "./data/linebot.sqlite3";
const store = new MemoryStore(dbPath);
const vault = new SecretVault(process.env.ENCRYPTION_KEY, dbPath);
const { app, shutdown: shutdownApp } = createApp({ store, vault });

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
	console.log(JSON.stringify({
		level: "info",
		message: "LINE Bot Control API ready",
		url: `http://${hostname}:${info.port}`,
		mode: process.env.NODE_ENV ?? "development",
	}));
});

let shuttingDown = false;
const shutdown = (signal: string) => {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(JSON.stringify({ level: "info", message: "Graceful shutdown requested", signal }));
	void shutdownApp()
		.catch((error) => {
			console.error(error);
			process.exitCode = 1;
		})
		.finally(() => {
			server.close((error) => {
				if (error) {
					console.error(error);
					process.exitCode = 1;
				}
			});
		});
	setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export { createApp } from "./app.js";
export { MemoryStore } from "./store.js";
export { SecretVault } from "./secret-vault.js";
