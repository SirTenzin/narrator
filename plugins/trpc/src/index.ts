import { D, type Doc } from "@usenarrator/core";
import { type CallRule, definePlugin, type Engine, type MemberRule, type StmtRule, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { clientCreateDoc, HELPERS, HOOKS, helperCall, hookCall, mutateTracked, UTILS, utilsCall, vanillaCall } from "./client";
import { en } from "./en";
import type { TrpcPhrases as __PluginPhrases, TrpcPhrases } from "./phrases";
import { adapterDoc, errorDoc, helperDoc, initDoc, middlewareDoc, nextDoc, procedureDoc, routerDoc, tMemberDoc } from "./server";
import { type Ctx, factsReader, isClientRoot, isUtilsCall } from "./shared";

export { en } from "./en";
export type { ErrorCode, Link, OptionsHelper, ProcedureKind, TrpcPhrases, UtilsMethod } from "./phrases";

type Rule = CallRule<TrpcPhrases>;

function add(calls: Record<string, Rule>, key: string, r: Rule) {
	const prev = calls[key];
	calls[key] = prev ? (p) => prev(p) ?? r(p) : r;
}

/** tRPC (trpc.io) v11 and v10: routers, procedures, middleware, errors, adapters, the vanilla client, React Query hooks and the TanStack integration. */
export const trpc = (): TsPlugin<TrpcPhrases> => {
	const read = factsReader();
	const ctx = (e: Engine, say: TrpcPhrases): Ctx => ({ e, say, facts: read(e) });
	const calls: Record<string, Rule> = {};
	const on = (key: string, f: (c: Ctx, p: Parameters<Rule>[0]) => Doc | null) =>
		add(calls, key, (p) => {
			const c = ctx(p.e, p.say);
			return c.facts.active ? f(c, p) : null;
		});

	for (const m of ["create"]) on(`*.${m}`, (c, { node }) => initDoc(c, node));
	for (const m of ["query", "mutation", "subscription", "input", "output", "use", "meta", "concat", "unstable_concat"])
		on(`*.${m}`, (c, { node }) => procedureDoc(c, node, null));
	for (const m of ["query", "mutate", "subscribe"]) on(`*.${m}`, (c, { obj, args, stmt }) => vanillaCall(c, m, obj, args, stmt));
	for (const m of HOOKS) on(`*.${m}`, (c, { obj, args }) => hookCall(c, m, obj, args));
	for (const m of UTILS) on(`*.${m}`, (c, { obj, args }) => utilsCall(c, m, obj, args));
	for (const m of HELPERS) on(`*.${m}`, (c, { obj, args }) => helperCall(c, m, obj, args));
	for (const m of ["useUtils", "useContext"]) on(`*.${m}`, (c, { node }) => (isUtilsCall(c.facts, node) ? D(c.say.client.utils) : null));
	for (const name of ["router", "createTRPCRouter", "createRouter", "*.router"]) on(name, (c, { node }) => routerDoc(c, node));
	for (const name of ["middleware", "*.middleware"]) on(name, (c, { node }) => middlewareDoc(c, node));
	for (const name of ["mergeRouters", "createCallerFactory", "*.mergeRouters", "*.createCallerFactory"]) on(name, (c, { node }) => helperDoc(c, node));
	on("next", (c, { node, stmt }) => nextDoc(c, node, !stmt));
	on("*.createClient", (c, { node, obj }) => (obj && isClientRoot(c.facts, obj) ? clientCreateDoc(c, node, true) : null));
	on("*.mutate", (c, { obj, args }) => mutateTracked(c, obj, args));
	on("new TRPCError", (c, { node }) => errorDoc(c, node));
	for (const name of ["createHTTPServer", "createHTTPHandler", "fetchRequestHandler", "createNextApiHandler", "createExpressMiddleware"])
		on(name, (c, { node }) => adapterDoc(c, node));
	for (const name of ["createTRPCClient", "createTRPCProxyClient", "createTRPCReact", "createTRPCNext", "createTRPCContext", "useTRPC"])
		on(name, (c, { node }) => clientCreateDoc(c, node));

	const members: Record<string, MemberRule<TrpcPhrases>> = {};
	for (const m of ["router", "procedure", "middleware", "mergeRouters", "createCallerFactory"])
		members[`*.${m}`] = ({ e, say, node }) => {
			const c = ctx(e, say);
			return c.facts.active ? tMemberDoc(c, node) : null;
		};

	/** A middleware's `return next({ ctx })` reads as the step itself. */
	const returnNext: StmtRule<TrpcPhrases> = ({ node, e, d, say }) => {
		if (node.type !== "ReturnStatement" || !node.argument) return false;
		const c = ctx(e, say);
		if (!c.facts.active) return false;
		const doc = nextDoc(c, unwrap(node.argument));
		if (!doc) return false;
		e.emitDoc(d, doc, node);
		return true;
	};

	return definePlugin<TrpcPhrases>({
		name: "trpc",
		library: { name: "@trpc/server", versions: ">=10 <12" },
		phrases: { en },
		calls,
		members,
		statements: [returnNext],
		errors: ["TRPCError"],
	});
};

declare module "@usenarrator/core" {
	interface PluginPhrases {
		trpc: __PluginPhrases;
	}
}
