import safeRegex from "safe-regex2";

export const MAX_REGEX_LENGTH = 256;

export interface SafeRegexResult {
	safe: boolean;
	regex?: RegExp;
	reason?: "empty" | "too_long" | "unsafe" | "invalid";
}

/**
 * Compiles only expressions that pass a conservative ReDoS check. Flags are
 * controlled by the engine; admins cannot enable global/sticky state.
 */
export function compileSafeRegex(
	pattern: string,
	caseSensitive = false,
): SafeRegexResult {
	if (pattern.length === 0) return { safe: false, reason: "empty" };
	if (pattern.length > MAX_REGEX_LENGTH) {
		return { safe: false, reason: "too_long" };
	}
	if (!safeRegex(pattern, { limit: 25 })) {
		return { safe: false, reason: "unsafe" };
	}
	try {
		return {
			safe: true,
			regex: new RegExp(pattern, caseSensitive ? "u" : "iu"),
		};
	} catch {
		return { safe: false, reason: "invalid" };
	}
}
