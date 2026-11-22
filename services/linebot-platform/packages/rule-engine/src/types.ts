import type {
	JsonValue,
	NormalizedEvent,
	QueueStateSnapshot,
	QueueStatus,
	RuleAction,
} from "@linebot/contracts";
import type { CooldownStore } from "./cooldown.ts";
import type { TemplateIssue } from "./template.ts";

export type RuleEngineDiagnosticCode =
	| "invalid_rule"
	| "unsafe_regex"
	| "invalid_timezone"
	| "missing_queue_state"
	| "missing_cooldown_scope"
	| "cooldown_store_missing"
	| "cooldown_store_error"
	| "incompatible_action"
	| "invalid_template";

export interface RuleEngineDiagnostic {
	code: RuleEngineDiagnosticCode;
	message: string;
	ruleId?: string;
	conditionIndex?: number;
	actionIndex?: number;
	path?: readonly (string | number)[];
}

export interface ActionPlan {
	botId: string;
	ruleId: string;
	ruleName: string;
	priority: number;
	actionIndex: number;
	action: RuleAction;
	ready: boolean;
	deferredVariables: readonly string[];
	templateIssues: readonly TemplateIssue[];
}

export interface RuleEvaluationResult {
	event: NormalizedEvent;
	matchedRuleIds: readonly string[];
	actionPlans: readonly ActionPlan[];
	stopped: boolean;
	diagnostics: readonly RuleEngineDiagnostic[];
}

export interface RuleEvaluationContext {
	cooldownStore?: CooldownStore;
	queueStates?: Readonly<
		Record<string, QueueStatus | QueueStateSnapshot>
	>;
	currentQueue?: QueueStateSnapshot;
	variables?: Readonly<Record<string, unknown>>;
	now?: Date;
	dryRun?: boolean;
}

export interface RenderedJson {
	value: JsonValue;
	issues: readonly TemplateIssue[];
}

export interface ValidationIssue {
	path: readonly (string | number)[];
	message: string;
}

export class RuleEngineValidationError extends Error {
	readonly issues: readonly ValidationIssue[];

	constructor(message: string, issues: readonly ValidationIssue[]) {
		super(message);
		this.name = "RuleEngineValidationError";
		this.issues = issues;
	}
}
