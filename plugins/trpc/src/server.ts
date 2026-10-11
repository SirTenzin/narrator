import { D, type Doc, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import type { ErrorCode, ProcedureKind } from "./phrases";
import {
	bullets,
	type Ctx,
	fnLines,
	importedAs,
	initChain,
	isFn,
	isMiddlewareFn,
	isProcedureBase,
	isRouterFn,
	keyOf,
	objectArg,
	optionItems,
	propOf,
	str,
	tMember,
} from "./shared";

const KINDS: ProcedureKind[] = ["query", "mutation", "subscription"];
/** Bases that add nothing worth saying: the plain procedure. */
const PLAIN = /^(procedure|publicProcedure|baseProcedure)$/;

/** A schema in words: a schema plugin's description when one is loaded, else its noun. */
const shape = (c: Ctx, n: N): string => c.e.schemaText(n) ?? c.e.text(n);

/** `initTRPC.context<Context>().create({ transformer })`. */
export function initDoc(c: Ctx, node: N): Doc | null {
	const steps = initChain(c.facts, node);
	if (!steps) return null;
	const { e, say } = c;
	const items: string[] = [];
	for (const s of steps) {
		const t = s.node.typeArguments?.params?.[0];
		if (s.m === "context" && t) items.push(say.server.context({ type: mk("c", e.code(t)) }));
		if (s.m === "meta" && t) items.push(say.server.meta({ type: mk("c", e.code(t)) }));
		if (s.m === "create") items.push(...optionItems(c, objectArg(s.node.arguments[0])).map((d) => d.t));
	}
	return D(say.server.init({ details: items.length ? say.common.details({ items }) : null }));
}

/** `t.router`, `t.procedure`, … read as the builder they are. */
export function tMemberDoc(c: Ctx, n: N): Doc | null {
	const s = c.say.server;
	for (const [prop, text] of [
		["router", s.routerBuilder],
		["procedure", s.procedureBuilder],
		["middleware", s.middlewareBuilder],
		["mergeRouters", s.mergeBuilder],
		["createCallerFactory", s.callerFactoryBuilder],
	] as const)
		if (tMember(c.facts, n, prop)) return D(text);
	return null;
}

type Step = { m: string; args: N[] };

/** `base.input(…).use(…).query(fn)` -> base and steps, or null when the root isn't a procedure. */
function procedureChain(c: Ctx, node: N): { base: N; steps: Step[] } | null {
	const steps: Step[] = [];
	let cur = unwrap(node);
	while (cur?.type === "CallExpression" && unwrap(cur.callee)?.type === "MemberExpression" && !unwrap(cur.callee).computed) {
		const callee = unwrap(cur.callee);
		steps.unshift({ m: callee.property.name, args: cur.arguments });
		cur = unwrap(callee.object);
	}
	if (!steps.length || !isProcedureBase(c.facts, cur)) return null;
	if (
		!steps.every(
			(s, i) =>
				["input", "output", "use", "meta", "concat", "unstable_concat"].includes(s.m) || (i === steps.length - 1 && KINDS.includes(s.m as ProcedureKind)),
		)
	)
		return null;
	return { base: cur, steps };
}

/** What a procedure is built from and what it checks, as details. */
function detailsOf(c: Ctx, base: N, steps: Step[]): Doc[] {
	const { e, say } = c;
	const p = say.procedure;
	const out: Doc[] = [];
	const name = unwrap(base)?.type === "Identifier" ? unwrap(base).name : null;
	if (name && !PLAIN.test(name)) out.push(D(p.using({ base: e.text(base) })));
	for (const s of steps) {
		const [a] = s.args;
		if (!a) continue;
		if (s.m === "input") out.push(D(p.input({ shape: shape(c, a) })));
		if (s.m === "output") out.push(D(p.output({ shape: shape(c, a) })));
		if (s.m === "meta") out.push(D(p.meta({ meta: e.text(a) })));
		if (s.m === "use" || s.m === "concat" || s.m === "unstable_concat")
			out.push(isFn(a) ? D(p.after({ middleware: say.middleware.noun }), fnLines(e, a, true)) : D(p.after({ middleware: e.text(a) })));
	}
	return out;
}

/** One procedure. `path` is its dotted path inside a router, or null. */
export function procedureDoc(c: Ctx, node: N, path: string | null): Doc | null {
	const ch = procedureChain(c, node);
	if (!ch) return null;
	const { e, say } = c;
	const last = ch.steps.at(-1)!;
	const kind = KINDS.includes(last.m as ProcedureKind) ? (last.m as ProcedureKind) : null;
	const details = detailsOf(c, ch.base, kind ? ch.steps.slice(0, -1) : ch.steps);
	const inline = details.filter((d) => !d.kids.length);
	const blocks = details.filter((d) => d.kids.length);
	const joined = inline.length ? say.common.details({ items: inline.map((d) => d.t) }) : null;
	if (!kind) return D(say.procedure.builder({ base: e.text(ch.base), details: joined }), bullets(e, blocks));
	const head = say.procedure.head({ kind, path: path ? mk("c", path) : null });
	const [resolver] = last.args;
	const title = joined ? say.common.withDetails({ subject: head, details: joined }) : head;
	if (!resolver) return D(title, bullets(e, blocks));
	if (!isFn(resolver)) {
		const v = e.noun(resolver);
		return D(say.common.option({ name: title, value: v.t }), [...bullets(e, blocks), ...v.kids]);
	}
	const lines = fnLines(e, resolver);
	return D(title, blocks.length ? [...bullets(e, blocks), ...bullets(e, [D(say.procedure.resolve, lines)])] : lines);
}

/** `router({ … })` / `createTRPCRouter({ … })`, nested routers giving dotted paths. */
export function routerDoc(c: Ctx, node: N, prefix = ""): Doc | null {
	const u = unwrap(node);
	if (u?.type !== "CallExpression" || !isRouterFn(c.facts, u.callee)) return null;
	const o = objectArg(u.arguments[0]);
	if (!o) return null;
	return D(c.say.router.noun, bullets(c.e, entries(c, o, prefix)));
}

function entries(c: Ctx, o: N, prefix: string): Doc[] {
	const { e, say } = c;
	return o.properties.flatMap((p: N): Doc[] => {
		if (p.type === "SpreadElement") return [e.noun(p)];
		const k = keyOf(p);
		if (k === null) return [e.noun(p)];
		const path = prefix + k;
		const v = unwrap(p.value);
		const proc = procedureDoc(c, v, path);
		if (proc) return [proc];
		if (v?.type === "CallExpression" && isRouterFn(c.facts, v.callee) && objectArg(v.arguments[0])) return entries(c, objectArg(v.arguments[0])!, `${path}.`);
		if (v?.type === "ObjectExpression") return entries(c, v, `${path}.`);
		const r = e.noun(v);
		return [D(say.router.nested({ path: mk("c", path), router: r.t }), r.kids)];
	});
}

/** `t.middleware(async ({ ctx, next }) => …)`. */
export function middlewareDoc(c: Ctx, node: N): Doc | null {
	const u = unwrap(node);
	if (u?.type !== "CallExpression" || !isMiddlewareFn(c.facts, u.callee) || !isFn(u.arguments[0])) return null;
	return D(c.say.middleware.noun, fnLines(c.e, u.arguments[0], true));
}

/** `next()` / `next({ ctx: { user } })` inside a middleware. */
export function nextDoc(c: Ctx, node: N): Doc | null {
	const u = unwrap(node);
	if (u?.type !== "CallExpression" || unwrap(u.callee)?.name !== "next" || !c.facts.active) return null;
	const [a] = u.arguments;
	if (!a) return D(c.say.middleware.next);
	const ctx = propOf(objectArg(a), "ctx");
	if (!ctx) return null;
	const v = c.e.noun(ctx);
	return D(c.say.middleware.nextWith({ context: v.t }), v.kids);
}

/** `new TRPCError({ code: "NOT_FOUND", message })`. */
export function errorDoc(c: Ctx, node: N): Doc | null {
	const u = unwrap(node);
	if (importedAs(c.facts, u.callee) !== "TRPCError") return null;
	const o = objectArg(u.arguments[0]);
	const code = str(propOf(o, "code"));
	const msg = propOf(o, "message");
	const codeText = code ? (c.say.errors.codes[code as ErrorCode] ?? mk("c", code)) : c.e.text(propOf(o, "code") ?? u);
	return D(c.say.errors.error({ code: codeText, message: msg ? c.e.text(msg) : null }));
}

/** `mergeRouters(a, b)` / `createCallerFactory(appRouter)` / `t.createCallerFactory(appRouter)`. */
export function helperDoc(c: Ctx, node: N): Doc | null {
	const u = unwrap(node);
	if (u?.type !== "CallExpression") return null;
	const { e, say } = c;
	const name = importedAs(c.facts, u.callee);
	const isT = (p: string) => tMember(c.facts, u.callee, p) || name === p || (unwrap(u.callee)?.name === p && c.facts.active);
	if (isT("mergeRouters")) return D(say.router.merged({ routers: e.g.list(u.arguments.map((a: N) => e.text(a))) }));
	if (isT("createCallerFactory") && u.arguments[0]) return D(say.router.callerFactory({ router: e.text(u.arguments[0]) }));
	return null;
}

const ADAPTERS: Record<string, "httpServer" | "fetch" | "nextApi" | "express" | "standalone"> = {
	createHTTPServer: "httpServer",
	createHTTPHandler: "standalone",
	fetchRequestHandler: "fetch",
	createNextApiHandler: "nextApi",
	createExpressMiddleware: "express",
};

/** Server adapters: `fetchRequestHandler({ endpoint, req, router, createContext })` and friends. */
export function adapterDoc(c: Ctx, node: N): Doc | null {
	const u = unwrap(node);
	const name = importedAs(c.facts, u?.callee);
	const kind = name ? ADAPTERS[name] : undefined;
	if (!kind) return null;
	const { e, say } = c;
	const o = objectArg(u.arguments[0]);
	const router = propOf(o, "router");
	if (!router) return null;
	const r = e.text(router);
	const endpoint = propOf(o, "endpoint");
	const base =
		kind === "fetch"
			? say.adapters.fetch({ router: r, endpoint: endpoint ? (str(endpoint) !== null ? mk("c", str(endpoint)!) : e.text(endpoint)) : null })
			: say.adapters[kind]({ router: r });
	const ctx = propOf(o, "createContext");
	return D(ctx ? say.adapters.withContext({ handler: base, context: e.text(ctx) }) : base);
}

export { keyOf };
