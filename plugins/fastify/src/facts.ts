import { type Engine, type ImportInfo, type N, unwrap } from "@usenarrator/lang-ts";

/** What a file imports from Fastify and which local names hold servers, requests and replies. */
export type Facts = {
	src: string;
	active: boolean;
	/** Every import and `require`, ESM or CommonJS: local name -> where it came from. */
	imports: Map<string, ImportInfo>;
	servers: Set<string>;
	reqs: Set<string>;
	replies: Set<string>;
};

export const ROUTE_METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "all", "search"];
export const SERVER_METHODS = [
	...ROUTE_METHODS,
	"route",
	"addHook",
	"register",
	"decorate",
	"decorateRequest",
	"decorateReply",
	"listen",
	"setErrorHandler",
	"setNotFoundHandler",
	"inject",
	"ready",
	"close",
	"after",
];

/** A per-plugin-instance reader that scans each file once; no state lives at module level. */
export function factsReader(): (e: Engine) => Facts {
	const cache = new WeakMap<Engine, Facts>();
	return (e) => {
		const hit = cache.get(e);
		if (hit?.src === e.src) return hit;
		const f: Facts = { src: e.src, active: false, imports: new Map(e.imports), servers: new Set(), reqs: new Set(), replies: new Set() };
		cache.set(e, f);
		if (e.program) for (const [k, v] of requiresOf(e.program)) f.imports.set(k, v);
		f.active =
			e.usesLibrary("fastify") ||
			[...f.imports.values()].some((i) => i.from === "fastify" || i.from === "fastify-plugin") ||
			/\brequire\(\s*["']fastify["']\s*\)/.test(e.src);
		if (f.active && e.program) visit(e.program, (n) => record(f, n));
		return f;
	};
}

const isRequire = (n: N): string | null => {
	const u = unwrap(n);
	return u?.type === "CallExpression" && unwrap(u.callee)?.name === "require" && typeof u.arguments[0]?.value === "string" ? u.arguments[0].value : null;
};

/** `const fastify = require("fastify")` and `const { fastify } = require("fastify")`, top-level only. */
function requiresOf(program: N): Map<string, ImportInfo> {
	const out = new Map<string, ImportInfo>();
	for (const st of program.body ?? []) {
		if (st.type !== "VariableDeclaration") continue;
		for (const d of st.declarations) {
			const from = isRequire(d.init);
			if (!from) continue;
			if (d.id.type === "Identifier") out.set(d.id.name, { from, name: "default" });
			if (d.id.type === "ObjectPattern")
				for (const p of d.id.properties)
					if (p.type === "Property" && p.value.type === "Identifier") out.set(p.value.name, { from, name: p.key.name ?? p.key.value });
		}
	}
	return out;
}

/** The module a local name or `require("x")` call comes from, and the export. */
export function importOf(f: Facts, n: N): ImportInfo | null {
	const u = unwrap(n);
	if (u?.type === "Identifier") return f.imports.get(u.name) ?? null;
	const from = isRequire(u);
	return from ? { from, name: "default" } : null;
}

/** `Fastify(opts)`, `fastify(opts)` (named export) and `require("fastify")(opts)`. */
export function createsServer(f: Facts, n: N): boolean {
	const u = unwrap(n);
	if (u?.type !== "CallExpression") return false;
	const i = importOf(f, u.callee);
	return !!i && i.from === "fastify" && (i.name === "default" || i.name === "fastify" || i.name === "*");
}

/** A Fastify instance: created here, typed `FastifyInstance`, a plugin's first parameter, or named like one. */
export function isServer(f: Facts, n: N): boolean {
	const u = unwrap(n);
	if (!f.active || !u) return false;
	if (u.type === "Identifier") return f.servers.has(u.name) || /^(fastify|app|server|instance)$/.test(u.name);
	if (u.type === "CallExpression") {
		const c = unwrap(u.callee);
		if (c?.type === "MemberExpression" && !c.computed && c.property.name === "withTypeProvider") return isServer(f, c.object);
		return createsServer(f, u);
	}
	return false;
}

const named = (f: Facts, set: Set<string>, n: N, re: RegExp) => {
	const u = unwrap(n);
	return f.active && u?.type === "Identifier" && (set.has(u.name) || re.test(u.name));
};
export const isRequest = (f: Facts, n: N) => named(f, f.reqs, n, /^(request|req)$/);
export const isReply = (f: Facts, n: N) => named(f, f.replies, n, /^(reply|rep)$/);

export const isFn = (n: N) => {
	const u = unwrap(n);
	return u?.type === "ArrowFunctionExpression" || u?.type === "FunctionExpression" || u?.type === "FunctionDeclaration";
};

function visit(n: N, f: (n: N) => void) {
	if (!n || typeof n !== "object") return;
	if (Array.isArray(n)) {
		for (const x of n) visit(x, f);
		return;
	}
	if (typeof n.type === "string") f(n);
	for (const k in n) if (k !== "parent" && n[k] && typeof n[k] === "object") visit(n[k], f);
}

const paramName = (p: N): string | null => {
	const u = p?.type === "AssignmentPattern" ? p.left : p;
	return u?.type === "Identifier" ? u.name : null;
};

const typeName = (p: N): string | null => {
	const t = p?.typeAnnotation?.typeAnnotation;
	if (t?.type !== "TSTypeReference") return null;
	return t.typeName.type === "Identifier" ? t.typeName.name : null;
};

function handlerParams(f: Facts, fn: N, offset = 0) {
	const [req, rep] = [fn.params?.[offset], fn.params?.[offset + 1]].map(paramName);
	if (req) f.reqs.add(req);
	if (rep) f.replies.add(rep);
}

function record(f: Facts, n: N) {
	if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && n.init && createsServer(f, n.init)) {
		f.servers.add(n.id.name);
		return;
	}
	if (n.type === "Identifier" && n.typeAnnotation) {
		const t = typeName(n);
		const i = t ? f.imports.get(t) : undefined;
		if (i?.from !== "fastify") return;
		if (i.name === "FastifyInstance") f.servers.add(n.name);
		if (i.name === "FastifyRequest") f.reqs.add(n.name);
		if (i.name === "FastifyReply") f.replies.add(n.name);
		return;
	}
	if (n.type !== "CallExpression") return;
	const c = unwrap(n.callee);
	const i = importOf(f, c);
	if (i?.from === "fastify-plugin") {
		const fn = unwrap(n.arguments[0]);
		const name = isFn(fn) ? paramName(fn.params[0]) : null;
		if (name) f.servers.add(name);
		return;
	}
	if (c?.type !== "MemberExpression" || c.computed || !SERVER_METHODS.includes(c.property.name) || !isServer(f, c.object)) return;
	const m = c.property.name;
	for (const a of n.arguments) {
		const u = unwrap(a);
		if (isFn(u)) {
			if (m === "register") {
				const name = paramName(u.params[0]);
				if (name) f.servers.add(name);
			} else handlerParams(f, u, m === "setErrorHandler" || (m === "addHook" && n.arguments[0]?.value === "onError") ? 1 : 0);
		}
		if (u?.type === "ObjectExpression")
			for (const p of u.properties) if (p.type === "Property" && isFn(p.value)) handlerParams(f, unwrap(p.value), p.key.name === "errorHandler" ? 1 : 0);
	}
}
