import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";

/** `hono`, `hono/cors`, `@hono/zod-validator`, `jsr:@hono/hono/cors`, `npm:hono/client`. */
const HONO_SOURCE = /^(?:(?:npm|jsr):)?(?:@hono\/|hono(?:\/|$))/;

/** What a file imports from Hono and which local names hold apps, contexts, clients and streams. */
export type Facts = {
	src: string;
	hono: boolean;
	/** Local name -> imported name and module, for Hono imports only. */
	imports: Map<string, { name: string; source: string }>;
	apps: Set<string>;
	contexts: Set<string>;
	nexts: Set<string>;
	clients: Set<string>;
	factories: Set<string>;
	streams: Set<string>;
};

/** Every `app.*` method that adds to or configures an app; chains of these keep returning the app. */
export const ROUTE_METHODS = ["get", "post", "put", "patch", "delete", "options", "all", "on", "use", "route", "basePath", "onError", "notFound", "mount"];
const STREAM_HELPERS = ["stream", "streamText", "streamSSE"];
export const VALIDATORS = ["validator", "zValidator", "vValidator", "tbValidator", "typiaValidator", "arktypeValidator", "sValidator", "effectValidator"];

/** What guards need: the engine and the current file's facts. */
export type Scope = { e: Engine; facts: Facts };

/** A per-plugin-instance reader that scans each file once; no state lives at module level. */
export function factsReader(): (e: Engine) => Facts {
	const cache = new WeakMap<Engine, Facts>();
	return (e) => {
		const hit = cache.get(e);
		if (hit?.src === e.src) return hit;
		const facts = empty(e.src);
		cache.set(e, facts);
		scan({ e, facts });
		return facts;
	};
}

/** The Hono export a local identifier was imported as (`cors`, `Hono`), or null when it isn't one. */
export function importedAs(s: Scope, n: N): string | null {
	const u = unwrap(n);
	if (u?.type !== "Identifier") return null;
	return s.facts.imports.get(u.name)?.name ?? null;
}

/** The module a local identifier was imported from, for Hono imports. */
export const sourceOf = (s: Scope, name: string): string | null => s.facts.imports.get(name)?.source ?? null;

const isFn = (n: N) => n?.type === "ArrowFunctionExpression" || n?.type === "FunctionExpression";

/** `a.b(x).c(y)` -> root `a`, steps `[b(x), c(y)]`. */
export function chainOf(node: N): { root: N; steps: { m: string; args: N[]; node: N }[] } {
	const steps: { m: string; args: N[]; node: N }[] = [];
	let cur = unwrap(node);
	while (cur?.type === "CallExpression") {
		const c = unwrap(cur.callee);
		if (c?.type !== "MemberExpression" || c.computed) break;
		steps.unshift({ m: c.property.name, args: cur.arguments, node: cur });
		cur = unwrap(c.object);
	}
	return { root: cur, steps };
}

/** An app chain; `factory.createApp()` counts as its root, not as a step on `factory`. */
export function appChainOf(s: Scope, node: N): { root: N; steps: { m: string; args: N[]; node: N }[] } {
	const ch = chainOf(node);
	const first = ch.steps[0];
	if (first?.m === "createApp" && isFactoryCall(s, first.node, "createApp")) return { root: first.node, steps: ch.steps.slice(1) };
	return ch;
}

/** `new Hono()`, `factory.createApp()`, an identifier holding one, or `app` (usually imported from the app's module). */
export function isAppRoot(s: Scope, n: N): boolean {
	const u = unwrap(n);
	const f = s.facts;
	if (!f.hono || !u) return false;
	if (u.type === "NewExpression") return importedAs(s, u.callee) === "Hono";
	if (u.type === "CallExpression") return isFactoryCall(s, u, "createApp");
	if (u.type === "Identifier") return f.apps.has(u.name) || u.name === "app";
	return false;
}

/** An app expression: a root followed only by app methods (`new Hono().basePath("/api")`). */
export function isApp(s: Scope, n: N): boolean {
	const { root, steps } = appChainOf(s, n);
	return isAppRoot(s, root) && steps.every((s) => ROUTE_METHODS.includes(s.m));
}

/** A handler's context parameter (`c`), by declaration or by Hono's naming convention. */
export function isContext(s: Scope, n: N): boolean {
	const u = unwrap(n);
	const f = s.facts;
	return f.hono && u?.type === "Identifier" && (f.contexts.has(u.name) || u.name === "c");
}

/** `c.req`. */
export const isRequest = (s: Scope, n: N): boolean => {
	const u = unwrap(n);
	return u?.type === "MemberExpression" && !u.computed && u.property.name === "req" && isContext(s, u.object);
};

export function isFactoryCall(s: Scope, call: N, method: string): boolean {
	const c = unwrap(call?.callee);
	if (c?.type !== "MemberExpression" || c.computed || c.property.name !== method) return false;
	const obj = unwrap(c.object);
	const f = s.facts;
	return f.hono && obj?.type === "Identifier" && (f.factories.has(obj.name) || /factory$/i.test(obj.name));
}

export const isStream = (s: Scope, n: N): boolean => {
	const u = unwrap(n);
	return u?.type === "Identifier" && s.facts.streams.has(u.name);
};

export const isNext = (s: Scope, n: N): boolean => {
	const u = unwrap(n);
	const f = s.facts;
	return f.hono && u?.type === "Identifier" && (f.nexts.has(u.name) || u.name === "next");
};

export const isClient = (s: Scope, n: N): boolean => {
	const u = unwrap(n);
	const f = s.facts;
	return f.hono && u?.type === "Identifier" && (f.clients.has(u.name) || /client$/i.test(u.name));
};

const paramName = (p: N): string | null => {
	const u = p?.type === "AssignmentPattern" ? p.left : p;
	return u?.type === "Identifier" ? u.name : null;
};

const typeName = (id: N): string | null => {
	const t = id?.typeAnnotation?.typeAnnotation;
	return t?.type === "TSTypeReference" && t.typeName.type === "Identifier" ? t.typeName.name : null;
};

const empty = (src: string): Facts => ({
	src,
	hono: false,
	imports: new Map(),
	apps: new Set(),
	contexts: new Set(),
	nexts: new Set(),
	clients: new Set(),
	factories: new Set(),
	streams: new Set(),
});

/** Imports first, so the guards used while walking already know what came from Hono. */
function scan(sc: Scope) {
	const { e, facts: f } = sc;
	if (!/hono/.test(e.src)) return;
	const program = parse(e);
	for (const st of program.body) {
		if (st.type !== "ImportDeclaration" || !HONO_SOURCE.test(st.source.value)) continue;
		f.hono = true;
		for (const sp of st.specifiers) {
			const name = sp.type === "ImportSpecifier" ? (sp.imported.name ?? sp.imported.value) : sp.type === "ImportDefaultSpecifier" ? "default" : "*";
			f.imports.set(sp.local.name, { name, source: st.source.value });
		}
	}
	if (f.hono) visit(program, (n) => record(sc, n));
}

/** JSX parses only as TSX and `<T>x` assertions only as TS; take whichever reads the file cleanly. */
function parse(e: Engine): N {
	const ts = e.parse("facts.ts", e.src);
	if (!ts.errors.length) return ts.program;
	const tsx = e.parse("facts.tsx", e.src);
	return tsx.errors.length < ts.errors.length ? tsx.program : ts.program;
}

function visit(n: N, f: (n: N) => void) {
	if (!n || typeof n !== "object") return;
	if (Array.isArray(n)) {
		for (const x of n) visit(x, f);
		return;
	}
	if (typeof n.type === "string") f(n);
	for (const k in n) if (k !== "parent" && n[k] && typeof n[k] === "object") visit(n[k], f);
}

function record(s: Scope, n: N) {
	const f = s.facts;
	if (n.type === "Identifier" && n.typeAnnotation) {
		const t = typeName(n);
		if (t && f.imports.get(t)?.name === "Hono") f.apps.add(n.name);
		if (t && f.imports.get(t)?.name === "Context") f.contexts.add(n.name);
		return;
	}
	if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && n.init) {
		const init = unwrap(n.init);
		if (isApp(s, init)) f.apps.add(n.id.name);
		if (init.type === "CallExpression" && importedAs(s, init.callee) === "hc") f.clients.add(n.id.name);
		if (init.type === "CallExpression" && importedAs(s, init.callee) === "createFactory") f.factories.add(n.id.name);
		return;
	}
	if (n.type === "CallExpression") recordCallbacks(s, n);
}

/** Names the parameters of handlers, middleware, validator hooks and stream callbacks passed to Hono. */
function recordCallbacks(s: Scope, n: N) {
	const f = s.facts;
	const fns = n.arguments.map(unwrap).filter(isFn);
	const ctx = (fn: N, i: number) => {
		const p = paramName(fn.params[i]);
		if (p) f.contexts.add(p);
		const next = paramName(fn.params[i + 1]);
		if (next) f.nexts.add(next);
	};
	const name = importedAs(s, n.callee);
	if (name && STREAM_HELPERS.includes(name)) {
		const [cb, onError] = fns;
		const st = paramName(cb?.params[0]);
		if (st) f.streams.add(st);
		const es = paramName(onError?.params[1]);
		if (es) f.streams.add(es);
		return;
	}
	if (name && VALIDATORS.includes(name)) {
		for (const fn of fns) ctx(fn, 1);
		return;
	}
	if (name === "createMiddleware" || isFactoryCall(s, n, "createMiddleware") || isFactoryCall(s, n, "createHandlers")) {
		for (const fn of fns) ctx(fn, 0);
		return;
	}
	const { root, steps } = appChainOf(s, n);
	const last = steps.at(-1);
	if (!last || !isAppRoot(s, root) || !steps.every((x) => ROUTE_METHODS.includes(x.m))) return;
	for (const fn of fns) ctx(fn, last.m === "onError" ? 1 : 0);
}
