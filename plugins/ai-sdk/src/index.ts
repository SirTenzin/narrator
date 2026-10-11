import { D } from "@usenarrator/core";
import type { CallRule, Engine, MemberRule, StmtRule, TsPlugin } from "@usenarrator/lang-ts";
import { type Ctx, identName, newState, resetState, stepScope, type Version } from "./context";
import { coreCalls, type Render } from "./core";
import { en } from "./en";
import { resultName } from "./options";
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
	const state = newState();
	/** A pinned version wins; otherwise the file's package decides, and both readings apply when it's unknown. */
	const versionOf = (e: Engine): Version => {
		if (version) return version;
		const major = e.libraryMajor("ai");
		return major === 6 || major === 7 ? major : "auto";
	};
	const ctx = (e: Engine, say: P): Ctx => {
		const c = { e, say, version: versionOf(e), state };
		resetState(c);
		return c;
	};
	const active = (c: Ctx) => c.state.imports.size > 0 || c.e.usesLibrary("ai");
	const call =
		(r: Render): CallRule<P> =>
		({ node, args, obj, stmt, e, say }) => {
			const c = ctx(e, say);
			return active(c) ? r(c, { node, args, obj, stmt }) : null;
		};
	const statement =
		(f: (c: Ctx, node: any, d: number) => boolean): StmtRule<P> =>
		({ node, e, d, say }) => {
			const c = ctx(e, say);
			return active(c) && f(c, node, d);
		};
	const calls: Record<string, CallRule<P>> = {};
	for (const [k, r] of Object.entries({ ...coreCalls(), ...uiCalls() })) calls[k] = call(r);

	/** `result.usage`, `result.text` on a local holding a model call's result. */
	const resultField =
		(key: string): MemberRule<P> =>
		({ obj, e, say }) => {
			const c = ctx(e, say);
			const name = identName(obj);
			if (!name || !c.state.results.has(name)) return null;
			return D(say.results.of({ thing: resultName(c, key, stepScope(c)), owner: e.g.possessive(e.ref(name)) }));
		};
	const members: Record<string, MemberRule<P>> = {};
	for (const key of [...Object.keys(en.results.fields), ...Object.keys(en.results.stepFields)]) members[`*.${key}`] = resultField(key);
	return {
		name: "ai-sdk",
		library: { name: "ai", versions: ">=6 <8" },
		phrases: { en },
		calls,
		members,
		statements: [statement(declaration), statement(streamLoop)],
	};
};
