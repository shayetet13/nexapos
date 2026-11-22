declare module "safe-regex2" {
	export default function safeRegex(
		value: string | RegExp,
		options?: { limit?: number },
	): boolean;
}
