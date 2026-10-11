import { D, type Doc } from "@usenarrator/core";
import { type CallRule, definePlugin, type Engine, type N, type StmtRule, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { appCalls, appStatements, type Stmt } from "./app";
import { clientCalls } from "./client";
import { contextCalls, responseDoc } from "./context";
import { en } from "./en";
import { factsReader, isNext } from "./facts";
import { middlewareCalls } from "./middleware";
import type { HonoPhrases } from "./phrases";
import type { Ctx, Rule } from "./shared";
import { streamCalls, streamDoc } from "./streaming";

export { en } from "./en";
export type { Builtin, HonoPhrases, OptionKey, Platform, Target } from "./phrases";

/** Rules that share a key (`*.get` is both a route and `c.get`) are tried in order. */
function merge(tables: Record<string, Rule>[]): Record<string, Rule> {
	const out: Record<string, Rule> = {};
	for (const t of tables)
		for (const [k, r] of Object.entries(t)) {
			const prev = out[k];
			out[k] = prev ? (c, site) => prev(c, site) ?? r(c, site) : r;
		}
	return out;
}

/** A handler's `return c.json(…)` reads as "reply with …"; `return next()` as the step itself. */
const replyStatement: Stmt = (c, node, d) => {
	if (node.type !== "ReturnStatement" || !node.argument) return false;
	const arg = unwrap(node.argument);
	const r = responseDoc(c, arg) ?? streamDoc(c, arg);
	if (r) {
		c.e.emitDoc(d, D(c.say.response.reply({ response: r.t }), r.kids), node);
		return true;
	}
	if (arg?.type !== "CallExpression" || arg.arguments.length || !isNext(c, arg.callee)) return false;
	c.e.emitDoc(d, D(c.say.middleware.next), node);
	return true;
};

/** Hono (hono.dev): apps and routes, the request context, middleware, validation, the RPC client, streaming and factories. */
export const hono = (): TsPlugin<HonoPhrases> => {
	const read = factsReader();
	const ctx = (e: Engine, say: HonoPhrases): Ctx => ({ e, say, facts: read(e) });
	const rules = merge([appCalls(), contextCalls(), middlewareCalls(), clientCalls(), streamCalls()]);
	const calls: Record<string, CallRule<HonoPhrases>> = {};
	for (const [k, r] of Object.entries(rules)) calls[k] = ({ e, say, node, args, obj, stmt }) => r(ctx(e, say), { node, args, obj, stmt }) as Doc | null;
	const statements: StmtRule<HonoPhrases>[] = [replyStatement, ...appStatements()].map(
		(s) =>
			({ node, e, d, say }: { node: N; e: Engine; d: number; say: HonoPhrases }) =>
				s(ctx(e, say), node, d),
	);
	return definePlugin<HonoPhrases>({
		name: "hono",
		library: { name: "hono", versions: ">=4 <6" },
		phrases: { en },
		calls,
		statements,
	});
};

declare module "@usenarrator/core" {
	interface PluginPhrases {
		hono: HonoPhrases;
	}
}
