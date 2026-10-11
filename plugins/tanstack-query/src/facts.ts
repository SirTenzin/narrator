import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";

/** `@tanstack/react-query`, the Vue/Solid/Svelte/Angular/Preact adapters, `query-core`, and v3's `react-query`. */
const SOURCE = /^(?:@tanstack\/(?:react|vue|solid|svelte|angular|preact|lit)-query(?:-experimental)?|@tanstack\/query-core|react-query)(?:\/.*)?$/;
export const PACKAGES = [
	"@tanstack/react-query",
	"@tanstack/vue-query",
	"@tanstack/solid-query",
	"@tanstack/svelte-query",
	"@tanstack/angular-query-experimental",
	"@tanstack/preact-query",
	"@tanstack/query-core",
	"react-query",
];

export type HookKind = "query" | "mutation";

/** What a file imports from TanStack Query and which local names hold its objects. */
export type Facts = {
	src: string;
	/** The file imports TanStack Query, or its package depends on it. */
	active: boolean;
	/** Local name -> exported name, for TanStack Query imports only. */
	imports: Map<string, string>;
	/** Variables holding a query client. */
	clients: Set<string>;
	/** Variables holding a whole query or mutation result: `const todos = useQuery(…)`. */
	results: Map<string, HookKind>;
	/** Functions destructured from a result under their own name: `const { mutate } = useMutation(…)`. */
	actions: Map<string, HookKind>;
};

export const QUERY_HOOKS = [
	"useQuery",
	"useSuspenseQuery",
	"useInfiniteQuery",
	"useSuspenseInfiniteQuery",
	"useQueries",
	"useSuspenseQueries",
	"createQuery",
	"createInfiniteQuery",
	"injectQuery",
	"injectInfiniteQuery",
];
export const MUTATION_HOOKS = ["useMutation", "createMutation", "injectMutation"];

/** A per-plugin-instance reader that scans each file once; no state lives at module level. */
export function factsReader(): (e: Engine) => Facts {
	const cache = new WeakMap<Engine, Facts>();
	return (e) => {
		const hit = cache.get(e);
		if (hit?.src === e.src) return hit;
		const f: Facts = { src: e.src, active: false, imports: new Map(), clients: new Set(), results: new Map(), actions: new Map() };
		cache.set(e, f);
		for (const [local, { from, name }] of e.imports) if (SOURCE.test(from)) f.imports.set(local, name);
		f.active = f.imports.size > 0 || PACKAGES.some((p) => e.usesLibrary(p));
		if (f.active && e.program) visit(e.program, (n) => record(f, n));
		return f;
	};
}

/** The TanStack Query export a callee was imported as (`useQuery`), or null. */
export function importedAs(f: Facts, callee: N): string | null {
	const u = unwrap(callee);
	return u?.type === "Identifier" ? (f.imports.get(u.name) ?? null) : null;
}

/** `useQueryClient()`, `new QueryClient()`, a variable holding one, or `queryClient` / `qc` / `context.queryClient`. */
export function isClient(f: Facts, n: N): boolean {
	const u = unwrap(n);
	if (!f.active || !u) return false;
	if (u.type === "Identifier") return f.clients.has(u.name) || /^(queryClient|qc)$/.test(u.name);
	if (u.type === "MemberExpression" && !u.computed) return u.property.name === "queryClient";
	if (u.type === "CallExpression") return importedAs(f, u.callee) === "useQueryClient" || (isIdentNamed(u.callee, "getQueryClient") && !u.arguments.length);
	if (u.type === "NewExpression") return importedAs(f, u.callee) === "QueryClient";
	return false;
}

const isIdentNamed = (n: N, name: string) => unwrap(n)?.type === "Identifier" && unwrap(n).name === name;

/** The hook a call is, when it's one of TanStack Query's. */
export function hookKind(f: Facts, n: N): HookKind | null {
	const u = unwrap(n?.type === "AwaitExpression" ? n.argument : n);
	if (u?.type !== "CallExpression") return null;
	const name = importedAs(f, u.callee);
	if (!name) return null;
	if (QUERY_HOOKS.includes(name)) return "query";
	if (MUTATION_HOOKS.includes(name)) return "mutation";
	return null;
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

function record(f: Facts, n: N) {
	if (n.type !== "VariableDeclarator" || !n.init) return;
	const init = unwrap(n.init);
	if (n.id.type === "Identifier") {
		if (isClient(f, init)) f.clients.add(n.id.name);
		const kind = hookKind(f, init);
		if (kind) f.results.set(n.id.name, kind);
		return;
	}
	const kind = hookKind(f, init);
	if (!kind || n.id.type !== "ObjectPattern") return;
	for (const p of n.id.properties) {
		if (p.type !== "Property" || p.key.type !== "Identifier" || p.value.type !== "Identifier") continue;
		if (p.key.name === p.value.name && ["mutate", "mutateAsync", "refetch", "fetchNextPage", "fetchPreviousPage", "reset"].includes(p.key.name))
			f.actions.set(p.key.name, kind);
	}
}
