import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";

/** `autumn-js`, its subpaths (`autumn-js/react`, `autumn-js/next`, …) and the core SDK it re-exports. */
const SOURCE = /^(?:autumn-js|@useautumn\/sdk)(?:\/.*)?$/;
/** A local module that exports the app's own client: `@/lib/autumn`, `./autumn`, `~/server/autumn.server`. */
const LOCAL_CLIENT_MODULE = /(?:^|[/@~.])autumn(?:[./-][\w.-]*)?$/i;
const CLIENT_NAME = /^autumn(?:Client|Sdk|Api)?$/i;

export const HOOKS = [
	"useCustomer",
	"useEntity",
	"usePricingTable",
	"useListPlans",
	"useReferrals",
	"useListEvents",
	"useAggregateEvents",
	"usePaywall",
] as const;
export type Hook = (typeof HOOKS)[number];

/** Something a name in the file was bound to: an Autumn call's result or one field of it, or anything else (which shadows). */
export type Binding = { name: string; at: number; scope: [number, number]; call: N | null; field: string | null };

/** What a file imports from autumn-js and which local names hold its objects. */
export type Facts = {
	src: string;
	/** The file imports autumn-js, or its package depends on it. */
	active: boolean;
	/** Local name -> `{ from, name }`, for autumn-js imports only. */
	imports: Map<string, { from: string; name: string }>;
	/** Local names of the `Autumn` class. */
	ctors: Set<string>;
	/** Variables holding a client, plus the `Autumn` class itself (0.x has a static twin of every method). */
	clients: Set<string>;
	/** Class fields and object properties typed as a client: `this.autumn`. */
	clientProps: Set<string>;
	bindings: Map<string, Binding[]>;
};

const isFn = (n: N) => n?.type === "ArrowFunctionExpression" || n?.type === "FunctionExpression" || n?.type === "FunctionDeclaration";

/** The exported name a local refers to, when it comes from autumn-js. */
export const importedAs = (f: Facts, local: string): string | null => f.imports.get(local)?.name ?? null;

/** The hook a call is, when it's one of autumn-js's. */
export function hookOf(f: Facts, call: N): Hook | null {
	const u = unwrap(call);
	if (u?.type !== "CallExpression") return null;
	const c = unwrap(u.callee);
	if (c?.type !== "Identifier") return null;
	const name = importedAs(f, c.name);
	return (HOOKS as readonly string[]).includes(name ?? "") ? (name as Hook) : null;
}

const typeName = (ann: N): string | null => {
	const t = ann?.typeAnnotation ?? ann;
	return t?.type === "TSTypeReference" && t.typeName?.type === "Identifier" ? t.typeName.name : null;
};

/** The receiver is an Autumn client: a variable or field holding one, a `new Autumn(…)`, or the `Autumn` class. */
function isClient(f: Facts, n: N): boolean {
	const u = unwrap(n);
	if (!f.active || !u) return false;
	if (u.type === "Identifier") return f.clients.has(u.name);
	if (u.type === "MemberExpression" && !u.computed) return f.clientProps.has(u.property.name);
	return u.type === "NewExpression" && unwrap(u.callee)?.type === "Identifier" && f.ctors.has(unwrap(u.callee).name);
}

/** `autumn.billing.attach(…)` -> `billing.attach`; null when the receiver isn't an Autumn client. */
export function clientPath(f: Facts, call: N): string | null {
	const u = unwrap(call);
	if (u?.type !== "CallExpression") return null;
	const names: string[] = [];
	let cur = unwrap(u.callee);
	while (cur?.type === "MemberExpression" && !cur.computed && cur.property?.type === "Identifier") {
		names.unshift(cur.property.name);
		if (isClient(f, cur.object)) return names.join(".");
		cur = unwrap(cur.object);
	}
	return null;
}

/** The function a hook handed back that `callee` names: `attach` from `const { attach } = useCustomer()`, or `customer.attach`. */
export function hookAction(f: Facts, callee: N): { hook: Hook; method: string } | null {
	const c = unwrap(callee);
	const fromHook = (name: string, method: string | null, whole: boolean) => {
		const b = bindingAt(f, name, c.start);
		const hook = b?.call ? hookOf(f, b.call) : null;
		if (!hook || whole !== (b!.field === null)) return null;
		const m = whole ? method : b!.field;
		return m ? { hook, method: m } : null;
	};
	if (c?.type === "Identifier") return fromHook(c.name, null, false);
	if (c?.type === "MemberExpression" && !c.computed && unwrap(c.object)?.type === "Identifier") return fromHook(unwrap(c.object).name, c.property.name, true);
	return null;
}

/** A call whose result is worth remembering: a client call, a hook, or a hook's action. */
const isAutumnCall = (f: Facts, n: N) => {
	const u = unwrap(n);
	return u?.type === "CallExpression" && !!(clientPath(f, u) || hookOf(f, u) || hookAction(f, u.callee));
};

/** The binding `name` refers to at `pos`: the innermost scope that declares it, latest declaration first. */
export function bindingAt(f: Facts, name: string, pos: number): Binding | null {
	let best: Binding | null = null;
	for (const b of f.bindings.get(name) ?? []) {
		if (pos < b.scope[0] || pos > b.scope[1] || b.at > pos) continue;
		const size = b.scope[1] - b.scope[0];
		const bestSize = best ? best.scope[1] - best.scope[0] : Number.POSITIVE_INFINITY;
		if (size < bestSize || (size === bestSize && b.at >= (best?.at ?? -1))) best = b;
	}
	return best;
}

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
			ctors: new Set(),
			clients: new Set(),
			clientProps: new Set(),
			bindings: new Map(),
		};
		cache.set(e, f);
		for (const [local, info] of e.imports) if (SOURCE.test(info.from)) f.imports.set(local, info);
		f.active = f.imports.size > 0 || e.usesLibrary("autumn-js") || e.usesLibrary("@useautumn/sdk");
		if (!f.active || !e.program) return f;
		for (const [local, { from, name }] of f.imports)
			if ((name === "Autumn" || name === "default") && !/\/(react|better-auth)$/.test(from)) {
				f.ctors.add(local);
				f.clients.add(local);
			}
		for (const [local, { from }] of e.imports) if (!SOURCE.test(from) && CLIENT_NAME.test(local) && LOCAL_CLIENT_MODULE.test(from)) f.clients.add(local);
		walk(e.program, [[0, e.src.length]], (n, scopes) => declare(f, n, scopes));
		walk(e.program, [[0, e.src.length]], (n, scopes) => bind(f, n, scopes));
		return f;
	};
}

type Scopes = [number, number][];

/** Visits every node with the stack of scopes (program, functions, blocks) around it. */
function walk(n: N, scopes: Scopes, f: (n: N, scopes: Scopes) => void) {
	if (!n || typeof n !== "object") return;
	if (Array.isArray(n)) {
		for (const x of n) walk(x, scopes, f);
		return;
	}
	if (typeof n.type !== "string") return;
	f(n, scopes);
	const inner = isFn(n) || n.type === "BlockStatement" || n.type === "StaticBlock" ? [...scopes, [n.start, n.end] as [number, number]] : scopes;
	for (const k in n) if (k !== "parent" && n[k] && typeof n[k] === "object") walk(n[k], inner, f);
}

/** First pass: which names hold a client or a hook's result. */
function declare(f: Facts, n: N, _scopes: Scopes) {
	const typed = (id: N) => {
		const t = typeName(id?.typeAnnotation);
		return t !== null && f.ctors.has(t);
	};
	if (n.type === "VariableDeclarator" && n.id.type === "Identifier") {
		const init = unwrap(n.init);
		if (typed(n.id) || (init?.type === "NewExpression" && isClient(f, init))) f.clients.add(n.id.name);
	}
	if (n.type === "Identifier" && typed(n)) f.clients.add(n.name);
	if ((n.type === "PropertyDefinition" || n.type === "TSPropertySignature") && !n.computed && n.key?.type === "Identifier") {
		const value = unwrap(n.value);
		if (typed(n) || (value?.type === "NewExpression" && isClient(f, value))) f.clientProps.add(n.key.name);
	}
	if (n.type === "TSParameterProperty" && n.parameter?.type === "Identifier" && typed(n.parameter)) f.clientProps.add(n.parameter.name);
	// `({ autumn }: { autumn: Autumn })`: the pattern's own type names the field.
	if (n.type === "ObjectPattern" && n.typeAnnotation?.typeAnnotation?.type === "TSTypeLiteral") {
		const typedKeys = new Set(
			n.typeAnnotation.typeAnnotation.members
				.filter((m: N) => m.type === "TSPropertySignature" && m.key?.type === "Identifier" && typed(m))
				.map((m: N) => m.key.name),
		);
		for (const p of n.properties)
			if (p.type === "Property" && p.key?.type === "Identifier" && typedKeys.has(p.key.name) && p.value?.type === "Identifier") f.clients.add(p.value.name);
	}
}

const record = (f: Facts, b: Binding) => {
	const list = f.bindings.get(b.name) ?? [];
	list.push(b);
	f.bindings.set(b.name, list);
};

/** Second pass: every name a declaration or parameter binds, and the Autumn call it holds, if any. */
function bind(f: Facts, n: N, scopes: Scopes) {
	const scope = scopes.at(-1)!;
	if (isFn(n))
		for (const p of n.params ?? []) for (const name of patternNames(p)) record(f, { name, at: n.start, scope: [n.start, n.end], call: null, field: null });
	if (n.type !== "VariableDeclarator") return;
	const call = isAutumnCall(f, n.init) ? unwrap(n.init) : null;
	if (n.id.type === "Identifier") {
		record(f, { name: n.id.name, at: n.end, scope, call, field: null });
		return;
	}
	if (n.id.type === "ObjectPattern")
		for (const p of n.id.properties) {
			if (p.type !== "Property" || p.computed || p.key.type !== "Identifier") {
				for (const name of patternNames(p)) record(f, { name, at: n.end, scope, call: null, field: null });
				continue;
			}
			const v = p.value.type === "AssignmentPattern" ? p.value.left : p.value;
			if (v.type === "Identifier") record(f, { name: v.name, at: n.end, scope, call, field: p.key.name });
			else for (const name of patternNames(v)) record(f, { name, at: n.end, scope, call: null, field: null });
		}
	else for (const name of patternNames(n.id)) record(f, { name, at: n.end, scope, call: null, field: null });
}

function patternNames(p: N): string[] {
	if (!p) return [];
	if (p.type === "Identifier") return [p.name];
	if (p.type === "AssignmentPattern") return patternNames(p.left);
	if (p.type === "RestElement") return patternNames(p.argument);
	if (p.type === "TSParameterProperty") return patternNames(p.parameter);
	if (p.type === "ArrayPattern") return p.elements.flatMap(patternNames);
	if (p.type === "ObjectPattern") return p.properties.flatMap((x: N) => patternNames(x.type === "Property" ? x.value : x));
	return [];
}
