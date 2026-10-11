import { capFirst, D, type Doc, type Line } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import type { TrpcPhrases } from "./phrases";

const TRPC = /^@trpc\//;
const PACKAGES = ["@trpc/server", "@trpc/client", "@trpc/react-query", "@trpc/tanstack-react-query", "@trpc/next"];

/** What a file imports from tRPC and which local names hold its builders, clients and helpers. */
export type Facts = {
	src: string;
	active: boolean;
	/** Local name -> exported name, for `@trpc/*` imports only. */
	imports: Map<string, string>;
	/** `initTRPC…create()` results. */
	ts: Set<string>;
	routers: Set<string>;
	procedures: Set<string>;
	middlewares: Set<string>;
	/** Vanilla clients, React hook roots (`api`, `trpc`) and `useTRPC()` helpers. */
	clients: Set<string>;
	/** `useUtils()` / `useContext()` results. */
	utils: Set<string>;
};

export type Ctx = { e: Engine; say: TrpcPhrases; facts: Facts };

/** A per-plugin-instance reader that scans each file once; no state lives at module level. */
export function factsReader(): (e: Engine) => Facts {
	const cache = new WeakMap<Engine, Facts>();
	return (e) => {
		const hit = cache.get(e);
		if (hit?.src === e.src) return hit;
		const f: Facts = {
			src: e.src,
			active: false,
			imports: new Map(),
			ts: new Set(),
			routers: new Set(),
			procedures: new Set(),
			middlewares: new Set(),
			clients: new Set(),
			utils: new Set(),
		};
		cache.set(e, f);
		for (const [local, { from, name }] of e.imports) if (TRPC.test(from)) f.imports.set(local, name);
		const helpers = [...e.imports].some(([k, { from }]) => /Procedure$|^createTRPCRouter$/.test(k) || /(^|\/)trpc(\/|$)/.test(from));
		f.active = f.imports.size > 0 || helpers || PACKAGES.some((p) => e.usesLibrary(p));
		if (f.active && e.program) visit(e.program, (n) => record(f, n));
		return f;
	};
}

export const importedAs = (f: Facts, n: N): string | null => {
	const u = unwrap(n);
	return u?.type === "Identifier" ? (f.imports.get(u.name) ?? null) : null;
};

/** `initTRPC.context<C>().meta<M>().create(opts)` -> its steps, or null. */
export function initChain(f: Facts, n: N): { m: string; node: N }[] | null {
	const steps: { m: string; node: N }[] = [];
	let cur = unwrap(n);
	while (cur?.type === "CallExpression" && unwrap(cur.callee)?.type === "MemberExpression") {
		const c = unwrap(cur.callee);
		steps.unshift({ m: c.property.name, node: cur });
		cur = unwrap(c.object);
	}
	return importedAs(f, cur) === "initTRPC" && steps.at(-1)?.m === "create" ? steps : null;
}

/** `t.router` / `t.procedure` / … on an `initTRPC` result. */
export function tMember(f: Facts, n: N, prop: string): boolean {
	const u = unwrap(n);
	return (
		u?.type === "MemberExpression" && !u.computed && u.property.name === prop && unwrap(u.object)?.type === "Identifier" && f.ts.has(unwrap(u.object).name)
	);
}

const ident = (n: N): string | null => (unwrap(n)?.type === "Identifier" ? unwrap(n).name : null);

export const isRouterFn = (f: Facts, n: N) => {
	const name = ident(n);
	return f.active && ((name !== null && (f.routers.has(name) || /^(router|createTRPCRouter|createRouter)$/.test(name))) || tMember(f, n, "router"));
};
export const isProcedureBase = (f: Facts, n: N) => {
	const name = ident(n);
	return f.active && ((name !== null && (f.procedures.has(name) || /^(procedure|\w+Procedure)$/.test(name))) || tMember(f, n, "procedure"));
};
export const isMiddlewareFn = (f: Facts, n: N) => {
	const name = ident(n);
	return f.active && ((name !== null && (f.middlewares.has(name) || name === "middleware")) || tMember(f, n, "middleware"));
};
export const isClientRoot = (f: Facts, n: N) => {
	const name = ident(n);
	return f.active && name !== null && (f.clients.has(name) || /^(api|trpc)$/.test(name));
};
export const isUtilsRoot = (f: Facts, n: N) => {
	const u = unwrap(n);
	if (!f.active) return false;
	if (u?.type === "Identifier") return f.utils.has(u.name);
	return u?.type === "CallExpression" && isUtilsCall(f, u);
};

/** `api.useUtils()` / v10 `trpc.useContext()`. */
export function isUtilsCall(f: Facts, n: N): boolean {
	const u = unwrap(n);
	const c = unwrap(u?.callee);
	return u?.type === "CallExpression" && c?.type === "MemberExpression" && ["useUtils", "useContext"].includes(c.property.name) && isClientRoot(f, c.object);
}

const CLIENT_FACTORIES = [
	"createTRPCClient",
	"createTRPCProxyClient",
	"createTRPCReact",
	"createTRPCNext",
	"createTRPCOptionsProxy",
	"useTRPC",
	"createTRPCQueryUtils",
];
const PROCEDURE_STEPS = ["input", "output", "use", "meta", "concat", "unstable_concat"];

function record(f: Facts, n: N) {
	if (n.type !== "VariableDeclarator" || !n.init) return;
	const init = unwrap(n.init?.type === "AwaitExpression" ? n.init.argument : n.init);
	if (n.id.type === "ObjectPattern" && importedAs(f, init?.callee) === "createTRPCContext") {
		for (const p of n.id.properties)
			if (p.type === "Property" && p.key.name === "useTRPC" && p.value.type === "Identifier") f.clients.add(`fn:${p.value.name}`);
		return;
	}
	if (n.id.type !== "Identifier") return;
	const name = n.id.name;
	if (initChain(f, init)) return void f.ts.add(name);
	if (tMember(f, init, "router")) return void f.routers.add(name);
	if (tMember(f, init, "middleware")) return void f.middlewares.add(name);
	if (tMember(f, init, "procedure")) return void f.procedures.add(name);
	if (init?.type === "CallExpression") {
		const callee = unwrap(init.callee);
		const created = importedAs(f, callee);
		if ((created && CLIENT_FACTORIES.includes(created)) || (callee?.type === "Identifier" && f.clients.has(`fn:${callee.name}`)))
			return void f.clients.add(name);
		if (isUtilsCall(f, init)) return void f.utils.add(name);
		if (callee?.type === "MemberExpression" && PROCEDURE_STEPS.includes(callee.property.name) && isProcedureBase(f, rootOf(init))) f.procedures.add(name);
	}
}

/** The identifier or expression a call/member chain starts from. */
export function rootOf(n: N): N {
	let cur = unwrap(n);
	while (cur) {
		if (cur.type === "CallExpression") cur = unwrap(cur.callee);
		else if (cur.type === "MemberExpression") cur = unwrap(cur.object);
		else break;
	}
	return cur;
}

function visit(n: N, fn: (n: N) => void) {
	if (!n || typeof n !== "object") return;
	if (Array.isArray(n)) {
		for (const x of n) visit(x, fn);
		return;
	}
	if (typeof n.type === "string") fn(n);
	for (const k in n) if (k !== "parent" && n[k] && typeof n[k] === "object") visit(n[k], fn);
}

export const str = (n: N): string | null => {
	const u = unwrap(n);
	if (u?.type === "Literal" && typeof u.value === "string") return u.value;
	if (u?.type === "TemplateLiteral" && !u.expressions.length) return u.quasis[0].value.cooked;
	return null;
};

export const keyOf = (p: N): string | null => {
	if (p?.type !== "Property" || p.computed) return null;
	if (p.key.type === "Identifier") return p.key.name;
	return p.key.type === "Literal" ? String(p.key.value) : null;
};

export const objectArg = (n: N): N | null => (unwrap(n)?.type === "ObjectExpression" ? unwrap(n) : null);
export const propOf = (obj: N | null, key: string): N | null => obj?.properties.find((p: N) => keyOf(p) === key)?.value ?? null;

export const isFn = (n: N) => {
	const u = unwrap(n);
	return u?.type === "ArrowFunctionExpression" || u?.type === "FunctionExpression";
};

/** A callback's steps; an expression body reads as "give back …" unless it's a call. */
export function fnLines(e: Engine, fn: N, exprAsAction = false): Line[] {
	const f = unwrap(fn);
	if (f.body.type === "BlockStatement") return e.body(f.body, 0);
	const call = unwrap(f.body)?.type === "CallExpression" || unwrap(f.body)?.type === "AwaitExpression";
	const at = { start: f.body.start, end: f.body.end };
	return e.body(exprAsAction && call ? { type: "ExpressionStatement", expression: f.body, ...at } : { type: "ReturnStatement", argument: f.body, ...at }, 0);
}

export const bullets = (e: Engine, docs: Doc[]): Line[] => docs.flatMap((d) => e.bullet(D(capFirst(d.t), d.kids)));

/** "label: value" items for an options object, skipping `skip`. */
export function optionItems(c: Ctx, o: N | null, skip: string[] = []): Doc[] {
	return (o?.properties ?? []).flatMap((p: N): Doc[] => {
		if (p.type === "SpreadElement") return [c.e.noun(p)];
		const k = keyOf(p);
		if (!k || skip.includes(k)) return [];
		const v = unwrap(p.value);
		if (v?.type === "Literal" && typeof v.value === "boolean")
			return [D(c.say.common.option({ name: c.e.prop(k), value: v.value ? c.say.common.yes : c.say.common.no }))];
		const t = p.shorthand ? D(c.e.ref(k)) : c.e.noun(v);
		return [D(c.say.common.option({ name: c.e.prop(k), value: t.t }), t.kids)];
	});
}

/** The dotted procedure path of `api.post.byId` (the root excluded). */
export function pathOf(n: N): string[] | null {
	const names: string[] = [];
	let cur = unwrap(n);
	while (cur?.type === "MemberExpression" && !cur.computed) {
		names.unshift(cur.property.name);
		cur = unwrap(cur.object);
	}
	return names;
}
