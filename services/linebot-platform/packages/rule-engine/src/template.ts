import type { JsonValue, NormalizedEvent } from "@linebot/contracts";

const PATH_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const TOKEN_PATTERN = /{{\s*([^{}]*?)\s*}}/g;
const EXACT_TOKEN_PATTERN = /^{{\s*([^{}]*?)\s*}}$/;
const BLOCKED_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export type MissingVariablePolicy = "preserve" | "empty" | "error";

export interface TemplateIssue {
	code: "invalid_path" | "missing_variable" | "unsupported_value";
	path: string;
}

export interface TemplateRenderResult<T = string> {
	value: T;
	issues: TemplateIssue[];
}

export type TemplateContext = Readonly<Record<string, unknown>>;

interface ResolvedPath {
	found: boolean;
	value?: unknown;
}

function isAllowedPath(path: string): boolean {
	return PATH_PATTERN.test(path) &&
		path.split(".").every((segment) => !BLOCKED_SEGMENTS.has(segment));
}

/** Own data-properties only: getters and prototype traversal are never invoked. */
function resolvePath(context: TemplateContext, path: string): ResolvedPath {
	if (!isAllowedPath(path)) return { found: false };
	let current: unknown = context;
	for (const segment of path.split(".")) {
		if ((typeof current !== "object" || current === null) &&
			typeof current !== "function") {
			return { found: false };
		}
		const descriptor = Object.getOwnPropertyDescriptor(current, segment);
		if (descriptor === undefined || !("value" in descriptor)) {
			return { found: false };
		}
		current = descriptor.value;
	}
	return { found: true, value: current };
}

function scalarToString(value: unknown): string | undefined {
	if (value === null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}
	return undefined;
}

export function renderTemplate(
	template: string,
	context: TemplateContext,
	options: { missing?: MissingVariablePolicy } = {},
): TemplateRenderResult {
	const missing = options.missing ?? "preserve";
	const issues: TemplateIssue[] = [];
	const value = template.replace(TOKEN_PATTERN, (token, rawPath: string) => {
		const path = rawPath.trim();
		if (!isAllowedPath(path)) {
			issues.push({ code: "invalid_path", path });
			return missing === "empty" ? "" : token;
		}
		const resolved = resolvePath(context, path);
		if (!resolved.found) {
			issues.push({ code: "missing_variable", path });
			return missing === "empty" ? "" : token;
		}
		const scalar = scalarToString(resolved.value);
		if (scalar === undefined) {
			issues.push({ code: "unsupported_value", path });
			return missing === "empty" ? "" : token;
		}
		return scalar;
	});
	if (missing === "error" && issues.length > 0) {
		return { value: template, issues };
	}
	return { value, issues };
}

function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === "string" ||
		typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	if (typeof value !== "object") return false;
	for (const [key, child] of Object.entries(value)) {
		if (BLOCKED_SEGMENTS.has(key) || !isJsonValue(child)) return false;
	}
	return true;
}

export function renderJsonTemplate(
	value: JsonValue,
	context: TemplateContext,
): TemplateRenderResult<JsonValue> {
	if (typeof value === "string") {
		const exact = EXACT_TOKEN_PATTERN.exec(value);
		if (exact !== null) {
			const path = exact[1]?.trim() ?? "";
			if (!isAllowedPath(path)) {
				return { value, issues: [{ code: "invalid_path", path }] };
			}
			const resolved = resolvePath(context, path);
			if (!resolved.found) {
				return { value, issues: [{ code: "missing_variable", path }] };
			}
			if (isJsonValue(resolved.value)) {
				return { value: resolved.value, issues: [] };
			}
			return { value, issues: [{ code: "unsupported_value", path }] };
		}
		return renderTemplate(value, context);
	}
	if (Array.isArray(value)) {
		const output: JsonValue[] = [];
		const issues: TemplateIssue[] = [];
		for (const item of value) {
			const rendered = renderJsonTemplate(item, context);
			output.push(rendered.value);
			issues.push(...rendered.issues);
		}
		return { value: output, issues };
	}
	if (value !== null && typeof value === "object") {
		const output: Record<string, JsonValue> = Object.create(null) as Record<
			string,
			JsonValue
		>;
		const issues: TemplateIssue[] = [];
		for (const [key, item] of Object.entries(value)) {
			if (BLOCKED_SEGMENTS.has(key)) {
				issues.push({ code: "invalid_path", path: key });
				continue;
			}
			const rendered = renderJsonTemplate(item, context);
			output[key] = rendered.value;
			issues.push(...rendered.issues);
		}
		return { value: output, issues };
	}
	return { value, issues: [] };
}

export function createEventTemplateContext(
	event: NormalizedEvent,
	customVariables: Readonly<Record<string, unknown>> = {},
): TemplateContext {
	const actor = "actor" in event
		? event.actor
		: event.type === "member_joined"
		? event.members[0]
		: undefined;
	return {
		event: {
			id: event.id,
			type: event.type,
			occurredAt: event.occurredAt,
			receivedAt: event.receivedAt,
		},
		bot: { id: event.botId },
		...(event.target === undefined ? {} : { target: event.target }),
		...(actor === undefined ? {} : { user: actor }),
		...(event.type === "message_received" ? { message: event.message } : {}),
		...(event.type === "queue_state_changed" ? { queue: event.queue } : {}),
		...(event.type === "external_event" ? { payload: event.payload } : {}),
		variables: customVariables,
	};
}
