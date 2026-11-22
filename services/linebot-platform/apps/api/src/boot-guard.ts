/**
 * Fail-fast when the control API would be reachable beyond this machine (or runs in production)
 * with unauthenticated routes or publicly known fallback secrets.
 *
 * Local loopback development keeps working with the built-in defaults; anything exposed must
 * run with REQUIRE_AUTH=true and real secrets. Otherwise every /v1 route (bots, API keys,
 * LINE credentials, emergency stop, sending messages as the bot) is open to whoever can reach it,
 * and LINE session files are encrypted with a key that is printed in the source tree.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const KNOWN_DEFAULTS = new Set([
	"local-development-encryption-key",
	"local-development-secret-change-me",
	"change-me-before-production",
]);

function isPlaceholder(value: string | undefined): boolean {
	const v = value?.trim();
	return !v || KNOWN_DEFAULTS.has(v) || v.startsWith("replace-with");
}

export function isExposed(env: NodeJS.ProcessEnv, hostname: string): boolean {
	return !LOOPBACK_HOSTS.has(hostname) || env.NODE_ENV === "production";
}

/** Returns human-readable problems; empty when the configuration is safe for its exposure. */
export function findUnsafeConfig(env: NodeJS.ProcessEnv, hostname: string): string[] {
	if (!isExposed(env, hostname)) return [];
	const problems: string[] = [];
	if (env.REQUIRE_AUTH !== "true") problems.push("REQUIRE_AUTH must be \"true\" (every /v1 route is otherwise unauthenticated)");
	if (isPlaceholder(env.ENCRYPTION_KEY)) problems.push("ENCRYPTION_KEY must be set to a real secret (it encrypts LINE sessions and credentials)");
	if (isPlaceholder(env.JWT_SECRET) || (env.JWT_SECRET?.length ?? 0) < 32) problems.push("JWT_SECRET must be set to a real secret of at least 32 characters");
	if (isPlaceholder(env.ADMIN_PASSWORD)) problems.push("ADMIN_PASSWORD must be changed from the default");
	return problems;
}

export function assertSafeConfig(env: NodeJS.ProcessEnv, hostname: string): void {
	const problems = findUnsafeConfig(env, hostname);
	if (problems.length === 0) return;
	throw new Error(
		`Refusing to start: the API is exposed (API_HOST=${hostname}, NODE_ENV=${env.NODE_ENV ?? "unset"}) with an unsafe configuration:\n- ${problems.join("\n- ")}\n` +
		"Bind to 127.0.0.1 for local use, or fix the settings above.",
	);
}
