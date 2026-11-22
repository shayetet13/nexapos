import type { AdapterConfig, BotAdapter } from "../contracts.ts";
import { LineJsAdapter } from "./linejs-adapter.ts";
import { OfficialLineAdapter } from "./official-line-adapter.ts";

export function createAdapter(config: AdapterConfig): BotAdapter {
	switch (config.kind) {
		case "official":
			return new OfficialLineAdapter(config);
		case "linejs":
			return new LineJsAdapter(config);
		default:
			throw new TypeError("Unsupported bot adapter");
	}
}

export * from "./linejs-adapter.ts";
export * from "./official-line-adapter.ts";
