import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const proxyFor = (target: string) => target ? { "/v1": { target, changeOrigin: true } } : undefined;

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	// Only an operator-provided target is ever used by `vite preview` (see below).
	const explicitTarget = env.VITE_API_PROXY_TARGET || "";
	// Embedded in NexaPos the API runs on loopback 127.0.0.1:8787, so the dev server proxies /v1 there
	// by default. The dev server stays on loopback too: it forwards to an API that is unauthenticated
	// unless REQUIRE_AUTH=true, so exposing it on the LAN would expose the whole control API.
	const devTarget = explicitTarget || (env.VITE_API_BASE_URL ? "" : "http://127.0.0.1:8787");
	return {
		plugins: [react()],
		server: {
			host: env.DASHBOARD_HOST || "127.0.0.1",
			port: 5173,
			strictPort: true,
			proxy: proxyFor(devTarget),
		},
		preview: {
			host: "0.0.0.0",
			port: 4173,
			// Vite's preview server rejects requests whose Host header doesn't
			// match a known value (DNS-rebinding protection) -- fine for local
			// dev, but it also blocks Railway's own public domain once deployed.
			// The actual sensitive surface (the API) has its own session auth
			// independent of this, so disabling the check here is safe.
			allowedHosts: true,
			// Preview binds every interface; without an explicit value it would inherit the dev
			// default above and forward /v1 from the LAN to a loopback API. {} = no proxy.
			proxy: proxyFor(explicitTarget) ?? {},
		},
	};
});
