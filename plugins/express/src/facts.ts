import { type Engine, type ImportInfo, type N, unwrap } from "@usenarrator/lang-ts";
import type { Source } from "./phrases";

/** Third-party middleware the plugin names, by the package and export it comes from. */
export const SOURCES: Record<string, { name: string; builtin: Source }> = {
	cors: { name: "default", builtin: "cors" },
	helmet: { name: "default", builtin: "helmet" },
	morgan: { name: "default", builtin: "morgan" },
	"cookie-parser": { name: "default", builtin: "cookieParser" },
	compression: { name: "default", builtin: "compression" },
	"express-rate-limit": { name: "rateLimit", builtin: "rateLimit" },
	"express-session": { name: "default", builtin: "session" },
	"method-override": { name: "default", builtin: "methodOverride" },
	"serve-favicon": { name: "default", builtin: "favicon" },
};

/** What a file imports from Express and which local names hold apps, routers, requests and responses. */
export type Facts = {
	src: string;
	active: boolean;
	/** Every import and `require`, ESM or CommonJS: local name -> where it came from. */
	imports: Map<string, ImportInfo>;
	apps: Set<string>;
	routers: Set<string>;
	reqs: Set<string>;
	ress: Set<string>;
	nexts: Set<string>;
};

export const ROUTE_METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "all", "del"];
export const APP_METHODS = [...ROUTE_METHODS, "use", "route", "param", "listen", "set", "enable", "disable", "engine"];

/** A per-plugin-instance reader that scans each file once; no state lives at module level. */
export function factsReader(): (e: Engine) => Facts {
	const cache = new WeakMap<Engine, Facts>();
	return (e) => {
		const hit = cache.get(e);
		if (hit?.src === e.src) return hit;
		const f: Facts = {
			src: e.src,
			active: false,
			imports: new Map(e.imports),
			apps: new Set(),
			routers: new Set(),
			reqs: new Set(),
			ress: new Set(),
			nexts: new Set(),
		};
		cache.set(e, f);
		if (e.program) for (const [k, v] of requiresOf(e.program)) f.imports.set(k, v);
		f.active = e.usesLibrary("express") || [...f.imports.values()].some((i) => i.from === "express");
		if (f.active && e.program) visit(e.program, (n) => record(f, n));
		return f;
	};
}

/** `const express = require("express")` and `const { Router } = require("express")`, top-level only. */
function requiresOf(program: N): Map<string, ImportInfo> {
	const out = new Map<string, ImportInfo>();
	for (const st of program.body ?? []) {
		if (st.type !== "VariableDeclaration") continue;
		for (const d of st.declarations) {
			const init = unwrap(d.init);
			if (init?.type !== "CallExpression" || unwrap(init.callee)?.name !== "require") continue;
			const from = init.arguments[0]?.value;
			if (typeof from !== "string") continue;
			if (d.id.type === "Identifier") out.set(d.id.name, { from, name: "default" });
			if (d.id.type === "ObjectPattern")
				for (const p of d.id.properties)
					if (p.type === "Property" && p.value.type === "Identifier") out.set(p.value.name, { from, name: p.key.name ?? p.key.value });
		}
	}
	return out;
}

const fromExpress = (f: Facts, local: string, name?: string) => {
	const i = f.imports.get(local);
	return !!i && i.from === "express" && (name === undefined ? i.name === "default" || i.name === "*" : i.name === name);
};

/** `express()` / `express.Router()` / `Router()`; null when the call isn't Express's. */
export function creates(f: Facts, n: N): "app" | "router" | null {
	const u = unwrap(n);
	if (u?.type !== "CallExpression") return null;
	const c = unwrap(u.callee);
	if (c?.type === "Identifier") {
		if (fromExpress(f, c.name)) return "app";
		if (fromExpress(f, c.name, "Router")) return "router";
		return null;
	}
	if (
		c?.type === "MemberExpression" &&
		!c.computed &&
		c.property.name === "Router" &&
		unwrap(c.object)?.type === "Identifier" &&
		fromExpress(f, unwrap(c.object).name)
	)
		return "router";
	return null;
}

/** An app or router: created here, typed as one, or named `app` / `router` in a file that uses Express. */
export function isApp(f: Facts, n: N): boolean {
	const u = unwrap(n);
	if (!f.active || !u) return false;
	if (u.type === "Identifier") return f.apps.has(u.name) || f.routers.has(u.name) || /^(app|router|[a-z]\w*Router)$/.test(u.name);
	return !!creates(f, u);
}

const named = (f: Facts, set: Set<string>, n: N, re: RegExp) => {
	const u = unwrap(n);
	return f.active && u?.type === "Identifier" && (set.has(u.name) || re.test(u.name));
};
export const isReq = (f: Facts, n: N) => named(f, f.reqs, n, /^(req|request)$/);
export const isRes = (f: Facts, n: N) => named(f, f.ress, n, /^(res|response)$/);
export const isNext = (f: Facts, n: N) => named(f, f.nexts, n, /^next$/);

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
	return t.typeName.type === "Identifier" ? t.typeName.name : t.typeName.type === "TSQualifiedName" ? t.typeName.right.name : null;
};

/** Handler parameters: `(req, res, next)`, or `(err, req, res, next)` for error handlers. */
function handlerParams(f: Facts, fn: N) {
	const ps = fn.params ?? [];
	const off = ps.length === 4 ? 1 : 0;
	const [req, res, next] = [ps[off], ps[off + 1], ps[off + 2]].map(paramName);
	if (req) f.reqs.add(req);
	if (res) f.ress.add(res);
	if (next) f.nexts.add(next);
}

function record(f: Facts, n: N) {
	if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && n.init) {
		const kind = creates(f, n.init);
		if (kind === "app") f.apps.add(n.id.name);
		if (kind === "router") f.routers.add(n.id.name);
		return;
	}
	if (n.type === "Identifier" && n.typeAnnotation) {
		const t = typeName(n);
		const i = t ? f.imports.get(t) : undefined;
		if (i?.from !== "express") return;
		if (i.name === "Request") f.reqs.add(n.name);
		if (i.name === "Response") f.ress.add(n.name);
		if (i.name === "NextFunction") f.nexts.add(n.name);
		if (i.name === "Express" || i.name === "Application") f.apps.add(n.name);
		if (i.name === "Router") f.routers.add(n.name);
		return;
	}
	if (n.type !== "CallExpression") return;
	const c = unwrap(n.callee);
	if (c?.type !== "MemberExpression" || c.computed || !APP_METHODS.includes(c.property.name) || !isApp(f, rootOf(c.object))) return;
	for (const a of n.arguments) if (isFn(a)) handlerParams(f, unwrap(a));
}

/** The object a chain like `app.route("/a").get(…)` starts from. */
export function rootOf(n: N): N {
	let cur = unwrap(n);
	while (cur?.type === "CallExpression" && unwrap(cur.callee)?.type === "MemberExpression") cur = unwrap(unwrap(cur.callee).object);
	return cur;
}
