import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import { type FileInfo, fileInfo } from "./routes";

/** Local name -> Next.js export, for imports from `next` and `next/*`. */
type Imports = Map<string, { from: string; name: string }>;

/** What the current file is (from its path) and which local names hold Next.js objects. */
export type Facts = {
	src: string;
	active: boolean;
	file: FileInfo | null;
	imports: Imports;
	routers: Set<string>;
	searchParams: Set<string>;
	cookieStores: Set<string>;
	headerStores: Set<string>;
	requests: Set<string>;
	urls: Set<string>;
	/** Locals bound to the route's `params` / `searchParams` props (`const { id } = await params`). */
	routeProps: Map<string, "params" | "searchParams">;
};

export type Scope = { e: Engine; facts: Facts };

const HANDLERS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
export const isHandlerName = (n: string | undefined) => !!n && HANDLERS.has(n);

const empty = (src: string, file: FileInfo | null): Facts => ({
	src,
	active: false,
	file,
	imports: new Map(),
	routers: new Set(),
	searchParams: new Set(),
	cookieStores: new Set(),
	headerStores: new Set(),
	requests: new Set(),
	urls: new Set(),
	routeProps: new Map(),
});

/** A per-plugin-instance reader that scans each file once; `pathOf` supplies the file's path when the host knows it. */
export function factsReader(pathOf: (e: Engine) => string | null): (e: Engine) => Facts {
	const cache = new WeakMap<Engine, Facts>();
	return (e) => {
		const hit = cache.get(e);
		if (hit?.src === e.src) return hit;
		const facts = empty(e.src, fileInfo(pathOf(e)));
		cache.set(e, facts);
		scan({ e, facts });
		return facts;
	};
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

function scan(s: Scope) {
	const { e, facts: f } = s;
	for (const [local, { from, name }] of e.imports) if (from === "next" || from.startsWith("next/")) f.imports.set(local, { from, name });
	f.active = e.usesLibrary("next");
	if (!f.active) return;
	visit(e.program, (n) => {
		if (n.type === "VariableDeclarator") record(s, n);
		if (n.type === "Identifier" && n.typeAnnotation) {
			const t = n.typeAnnotation.typeAnnotation;
			const name = t?.type === "TSTypeReference" && t.typeName.type === "Identifier" ? t.typeName.name : null;
			if (name === "NextRequest" || name === "NextApiRequest" || (name === "Request" && f.file?.kind === "route")) f.requests.add(n.name);
		}
		const fn = handlerFn(n);
		const p = fn?.params?.[0];
		if (p?.type === "Identifier") f.requests.add(p.name);
	});
}

/** A route handler or middleware function a statement exports, if any. */
function handlerFn(n: N): N | null {
	if (n.type === "FunctionDeclaration" && (isHandlerName(n.id?.name) || n.id?.name === "middleware" || n.id?.name === "proxy")) return n;
	if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && isHandlerName(n.id.name)) {
		const init = unwrap(n.init);
		if (init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression") return init;
	}
	return null;
}

/** The Next.js export a callee names (`redirect`, `NextResponse`), with the module it came from. */
export function nextName(s: Scope, callee: N): string | null {
	const c = unwrap(callee);
	if (c?.type === "Identifier") return s.facts.imports.get(c.name)?.name ?? null;
	return null;
}

const calledAs = (s: Scope, n: N, name: string) => {
	const u = unwrap(n);
	return u?.type === "CallExpression" && nextName(s, u.callee) === name;
};

function record(s: Scope, d: N) {
	const f = s.facts;
	const init = unwrap(d.init);
	if (d.id.type === "Identifier") {
		const name = d.id.name;
		if (calledAs(s, init, "useRouter")) f.routers.add(name);
		if (calledAs(s, init, "useSearchParams")) f.searchParams.add(name);
		if (calledAs(s, init, "cookies")) f.cookieStores.add(name);
		if (calledAs(s, init, "headers")) f.headerStores.add(name);
		if (init?.type === "MemberExpression" && !init.computed && init.property.name === "searchParams") f.searchParams.add(name);
		if (init?.type === "NewExpression" && unwrap(init.callee)?.name === "URLSearchParams") f.searchParams.add(name);
		return;
	}
	if (d.id.type === "ObjectPattern" && init?.type === "Identifier" && (init.name === "params" || init.name === "searchParams"))
		for (const p of d.id.properties) if (p.value?.type === "Identifier") f.routeProps.set(p.value.name, init.name);
}

export const isRouter = (s: Scope, n: N) => {
	const u = unwrap(n);
	return u?.type === "Identifier" && s.facts.routers.has(u.name);
};

export const isRequest = (s: Scope, n: N) => {
	const u = unwrap(n);
	return u?.type === "Identifier" && (s.facts.requests.has(u.name) || (s.facts.active && /^(req|request)$/.test(u.name)));
};

/** `cookies()`, `await cookies()`, or a local holding it; `request.cookies` too. */
export const isCookieStore = (s: Scope, n: N) => {
	const u = unwrap(n);
	if (u?.type === "Identifier") return s.facts.cookieStores.has(u.name);
	if (u?.type === "MemberExpression" && !u.computed && u.property.name === "cookies") return isRequest(s, u.object);
	return calledAs(s, u, "cookies");
};

export const isHeaderStore = (s: Scope, n: N) => {
	const u = unwrap(n);
	if (u?.type === "Identifier") return s.facts.headerStores.has(u.name);
	if (u?.type === "MemberExpression" && !u.computed && u.property.name === "headers") return isRequest(s, u.object);
	return calledAs(s, u, "headers");
};

/** `useSearchParams()`, `request.nextUrl.searchParams`, `new URL(…).searchParams`, or a local holding one. */
export const isSearchParams = (s: Scope, n: N) => {
	const u = unwrap(n);
	if (u?.type === "Identifier") return s.facts.searchParams.has(u.name);
	if (u?.type === "MemberExpression" && !u.computed && u.property.name === "searchParams") return s.facts.active;
	return calledAs(s, u, "useSearchParams");
};

/** `request.nextUrl`. */
export const isNextUrl = (s: Scope, n: N) => {
	const u = unwrap(n);
	return u?.type === "MemberExpression" && !u.computed && u.property.name === "nextUrl" && isRequest(s, u.object);
};
