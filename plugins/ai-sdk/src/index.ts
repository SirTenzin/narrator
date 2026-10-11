import type { CallRule, Engine, StmtRule, TsPlugin } from "@usenarrator/lang-ts";
import { type Ctx, newState, resetState, type Version } from "./context";
import { coreCalls, type Render } from "./core";
import { en } from "./en";
import type { AiSdkPhrases } from "./phrases";
import { declaration, streamLoop } from "./statements";
import { uiCalls } from "./ui";

export { en } from "./en";
export type { AiSdkPhrases, CallbackOption, ModelKind, ResultField, StepField, StepScope } from "./phrases";

export type AiSdkOptions = {
	/** Pin the AI SDK major for names whose meaning changed in v7 (`usage`, `toolCalls`, `onChunk`, `.stream`). Defaults to reading both. */
	version?: 6 | 7;
};

type P = AiSdkPhrases;

/** Vercel AI SDK (ai-sdk.dev), v6 and v7: model calls, tools, agents, providers, middleware, stream responses, and UI hooks. */
export const aiSdk = ({ version }: AiSdkOptions = {}): TsPlugin<P> => {
	const v: Version = version ?? "auto";
	const state = newState();
	const ctx = (e: Engine, say: P): Ctx => {
		const c = { e, say, version: v, state };
		resetState(c);
		return c;
	};
	const call =
		(r: Render): CallRule<P> =>
		({ node, args, obj, stmt, e, say }) => {
			const c = ctx(e, say);
			return c.state.imports.size ? r(c, { node, args, obj, stmt }) : null;
		};
	const statement =
		(f: (c: Ctx, node: any, d: number) => boolean): StmtRule<P> =>
		({ node, e, d, say }) => {
			const c = ctx(e, say);
			return c.state.imports.size > 0 && f(c, node, d);
		};
	const calls: Record<string, CallRule<P>> = {};
	for (const [k, r] of Object.entries({ ...coreCalls(), ...uiCalls() })) calls[k] = call(r);
	return {
		name: "ai-sdk",
		library: { name: "ai", versions: ">=6 <8" },
		phrases: { en },
		calls,
		statements: [statement(declaration), statement(streamLoop)],
	};
};

declare module "@usenarrator/core" {
	interface PluginPhrases {
		"ai-sdk": AiSdkPhrases;
	}
}
