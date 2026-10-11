import type { Doc } from "@usenarrator/core";
import { type CallRule, type CondRule, definePlugin, type Engine, type MemberRule, type StmtRule, type TsPlugin } from "@usenarrator/lang-ts";
import { createReact, type ReactOptions } from "@usenarrator/plugin-react";
import { nextElements } from "./elements";
import { en } from "./en";
import { factsReader } from "./facts";
import { statements } from "./files";
import type { NextPhrases } from "./phrases";
import { calls, conditions, members } from "./server";
import type { Ctx } from "./shared";

export { en } from "./en";
export type { DynamicMode, FileKind, MatchType, NextPhrases, ScriptStrategy } from "./phrases";
export { type FileInfo, fileInfo } from "./routes";

export type NextOptions = {
	/** The current file's path, so `app/users/[id]/page.tsx` reads as "the page at /users/:id". See `trackPaths`. */
	pathOf?: (e: Engine) => string | null;
	/** Options for the bundled React plugin (extra element readings). */
	react?: ReactOptions;
};

/** Remembers each file's path through the TS language's `setup` hook, for `nextjs({ pathOf })`. */
export function trackPaths(): { setup: (ctx: { engine: Engine; path: string }) => void; pathOf: (e: Engine) => string | null } {
	const paths = new WeakMap<Engine, string>();
	return {
		setup: ({ engine, path }) => {
			paths.set(engine, path);
		},
		pathOf: (e) => paths.get(e) ?? null,
	};
}

/**
 * Next.js (nextjs.org): App Router files by path, route handlers, middleware/proxy, server actions and caching, request APIs, navigation.
 * Returns the Next.js rules plus a React plugin that knows `next/link`, `next/image`, `next/script` and `next/form`; don't add `react()` again.
 */
export function nextjs(options: NextOptions = {}): TsPlugin[] {
	let core: TsPlugin<NextPhrases> | null = null;
	const sayOf = (e: Engine) => e.phrasesFor(core!) as NextPhrases;
	const kit = createReact({ elements: { ...nextElements(sayOf), ...options.react?.elements } });
	const read = factsReader(options.pathOf ?? ((e) => e.path || null));
	const ctx = (e: Engine, say: NextPhrases): Ctx => ({ e, say, facts: read(e), kit });

	const callTable: Record<string, CallRule<NextPhrases>> = {};
	for (const [k, r] of Object.entries(calls()))
		callTable[k] = ({ e, say, node, args, obj, stmt }) => r(ctx(e, say), { node, args, obj, stmt }) as Doc | string | null;
	const condTable: Record<string, CondRule<NextPhrases>> = {};
	for (const [k, r] of Object.entries(conditions())) condTable[k] = ({ e, say, obj, args, neg }) => r(ctx(e, say), { obj, args, neg });
	const memberTable: Record<string, MemberRule<NextPhrases>> = {};
	for (const [k, r] of Object.entries(members())) memberTable[k] = ({ e, say, obj, prop }) => r(ctx(e, say), { obj, prop });
	const stmtRules: StmtRule<NextPhrases>[] = statements().map(
		(s) =>
			({ node, e, d, say }) =>
				s(ctx(e, say), node, d),
	);

	core = definePlugin<NextPhrases>({
		name: "nextjs",
		library: { name: "next", versions: ">=13.4 <17" },
		phrases: { en },
		calls: callTable,
		conditions: condTable,
		members: memberTable,
		statements: stmtRules,
	});
	return [core, kit.plugin];
}
