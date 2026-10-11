import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";

/** Every React export the rules name; anything else imported from React is left to the engine. */
export const HOOKS = [
	"useState",
	"useReducer",
	"useRef",
	"useMemo",
	"useCallback",
	"useEffect",
	"useLayoutEffect",
	"useInsertionEffect",
	"useContext",
	"useTransition",
	"useDeferredValue",
	"useId",
	"useActionState",
	"useOptimistic",
	"useSyncExternalStore",
	"useImperativeHandle",
	"useDebugValue",
	"useEffectEvent",
	"use",
	"useFormStatus",
] as const;
export type Hook = (typeof HOOKS)[number];

const REACT_SOURCES = new Set(["react", "react-dom", "react-dom/client", "react-dom/server"]);
/** Other libraries that compile JSX; their files are left alone unless React is also in play. */
const OTHER_JSX = ["solid-js", "preact", "vue", "@builder.io/qwik", "hono/jsx", "@stencil/core", "react-email"];

/** What the current file imports from React and which local names hold state setters, refs and contexts. */
export type Facts = {
	src: string;
	active: boolean;
	/** Local name -> React export, for imports from `react` / `react-dom`. */
	imports: Map<string, string>;
	/** `import React from "react"` / `import * as React`. */
	namespaces: Set<string>;
	/** Setter -> state name, from `useState` and `useOptimistic`. */
	setters: Map<string, string>;
	/** `dispatch` -> the reducer it feeds. */
	dispatchers: Map<string, string>;
	/** Refs that point at an element (`ref={inputRef}` or `useRef<HTMLInputElement>`) vs plain values. */
	refs: Map<string, "element" | "value">;
	transitions: Set<string>;
	contexts: Set<string>;
	roots: Set<string>;
	/** Return statements that produce what a component shows, so they read "show …" rather than "give back …". */
	shows: Set<N>;
};

export type Scope = { e: Engine; facts: Facts };

const empty = (src: string): Facts => ({
	src,
	active: false,
	imports: new Map(),
	namespaces: new Set(),
	setters: new Map(),
	dispatchers: new Map(),
	refs: new Map(),
	transitions: new Set(),
	contexts: new Set(),
	roots: new Set(),
	shows: new Set(),
});

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

export function visit(n: N, f: (n: N) => boolean | undefined): void {
	if (!n || typeof n !== "object") return;
	if (Array.isArray(n)) {
		for (const x of n) visit(x, f);
		return;
	}
	if (typeof n.type === "string" && f(n) === false) return;
	for (const k in n) if (k !== "parent" && n[k] && typeof n[k] === "object") visit(n[k], f);
}

const hasJsx = (program: N) => {
	let found = false;
	visit(program, (n) => {
		if (n.type === "JSXElement" || n.type === "JSXFragment") found = true;
		return !found;
	});
	return found;
};

/** React when the file or its package uses it, or when the file has JSX and no other JSX library. */
function isReactFile(e: Engine): boolean {
	if (e.usesLibrary("react") || e.usesLibrary("next") || e.usesLibrary("react-dom")) return true;
	if (OTHER_JSX.some((lib) => e.usesLibrary(lib))) return false;
	return hasJsx(e.program);
}

function scan(s: Scope) {
	const { e, facts: f } = s;
	f.active = isReactFile(e);
	if (!f.active) return;
	for (const [local, { from, name }] of e.imports) {
		if (!REACT_SOURCES.has(from)) continue;
		if (name === "default" || name === "*") f.namespaces.add(local);
		else f.imports.set(local, name);
	}
	visit(e.program, (n) => {
		if (n.type === "VariableDeclarator") record(s, n);
		if (n.type === "JSXAttribute" && n.name?.name === "ref") {
			const v = unwrap(n.value?.expression);
			if (v?.type === "Identifier") f.refs.set(v.name, "element");
		}
		return true;
	});
}

const idName = (p: N): string | null => (p?.type === "Identifier" ? p.name : null);

function record(s: Scope, d: N) {
	const f = s.facts;
	const init = unwrap(d.init);
	if (init?.type !== "CallExpression") return;
	const hook = reactName(s, init.callee);
	const els: N[] = d.id.type === "ArrayPattern" ? d.id.elements : [];
	const [a, b] = [idName(els[0]), idName(els[1])];
	if ((hook === "useState" || hook === "useOptimistic") && a && b) f.setters.set(b, a);
	if (hook === "useState" && !a && b)
		f.setters.set(
			b,
			b.replace(/^set([A-Z])/, (_, c) => c.toLowerCase()),
		);
	if (hook === "useReducer" && a && b) f.dispatchers.set(b, a);
	if (hook === "useTransition" && b) f.transitions.add(b);
	if (hook === "useRef" && d.id.type === "Identifier" && !f.refs.has(d.id.name)) f.refs.set(d.id.name, elementType(init) ? "element" : "value");
	if (hook === "createContext" && d.id.type === "Identifier") f.contexts.add(d.id.name);
	if ((hook === "createRoot" || hook === "hydrateRoot") && d.id.type === "Identifier") f.roots.add(d.id.name);
}

/** `useRef<HTMLInputElement>(null)` -> "HTMLInputElement". */
export function elementType(call: N): string | null {
	const t = call.typeArguments?.params?.[0];
	const name = t?.type === "TSTypeReference" && t.typeName.type === "Identifier" ? t.typeName.name : null;
	return name && /^(HTML|SVG)\w*Element$/.test(name) ? name : null;
}

/** The React export a callee names: an imported `useState`, `React.useState`, or a namespace member. */
export function reactName(s: Scope, callee: N): string | null {
	const c = unwrap(callee);
	if (!s.facts.active || !c) return null;
	if (c.type === "Identifier") return s.facts.imports.get(c.name) ?? null;
	if (c.type === "MemberExpression" && !c.computed && c.object.type === "Identifier" && (s.facts.namespaces.has(c.object.name) || c.object.name === "React"))
		return c.property.name;
	return null;
}

/** A custom hook call: `useOrg()`, any `use…` function that isn't React's own. */
export function customHook(s: Scope, call: N): string | null {
	if (!s.facts.active || call?.type !== "CallExpression") return null;
	const c = unwrap(call.callee);
	const name = c?.type === "Identifier" ? c.name : c?.type === "MemberExpression" && !c.computed ? c.property.name : null;
	if (!name || !/^use[A-Z0-9]/.test(name) || reactName(s, c) || (HOOKS as readonly string[]).includes(name)) return null;
	return name;
}
