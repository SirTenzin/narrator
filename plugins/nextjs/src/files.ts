import { capFirst, D, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { isHandlerName, nextName } from "./facts";
import type { DynamicMode, FileKind, MatchType } from "./phrases";
import { isResponseClass, urlText } from "./server";
import { type Ctx, codeText, isFn, keyOf, num, objectArg, propOf, secondsText, str } from "./shared";

export type Stmt = (c: Ctx, node: N, d: number) => boolean;

const exported = (node: N) => (node.type === "ExportNamedDeclaration" ? node.declaration : null);

/** `"use client"` / `"use server"` / `"use cache"` at the top of a file or function. */
export const directive: Stmt = (c, node, d) => {
	if (node.type !== "ExpressionStatement" || typeof node.directive !== "string" || !c.facts.active) return false;
	const { say, e } = c;
	const atTop = e.program.body.includes(node);
	const v = node.directive;
	let text: string | null = null;
	if (v === "use client") text = atTop ? say.directives.client : null;
	else if (v === "use server") text = atTop ? say.directives.server : say.directives.serverFunction;
	else if (v === "use cache") text = atTop ? say.directives.cacheFile : say.directives.cache;
	else if (v.startsWith("use cache:")) text = say.directives.cacheKind({ kind: v.slice(10).trim() });
	if (!text) return false;
	e.emit(d, `${capFirst(text)}.`, node, "note");
	return true;
};

const SPECIAL: FileKind[] = [
	"page",
	"layout",
	"rootLayout",
	"template",
	"loading",
	"error",
	"globalError",
	"notFound",
	"default",
	"forbidden",
	"unauthorized",
	"socialImage",
	"icon",
	"sitemap",
	"robots",
	"manifest",
	"app",
	"document",
];

/** A special file's default export: "The page at /users/:id, given params:" over the component's steps. */
export const specialFile: Stmt = (c, node, d) => {
	const f = c.facts.file;
	if (node.type !== "ExportDefaultDeclaration" || !f?.kind || !SPECIAL.includes(f.kind as FileKind)) return false;
	const { e, say, kit } = c;
	const route = mk("c", f.route);
	const file = say.files[f.kind as FileKind]({ route });
	const comp = kit.find(e, node);
	if (comp) {
		kit.render(e, {
			fn: comp.fn,
			node,
			d,
			title: f.route,
			traits: comp.traits,
			heads: { head: (p) => say.head({ file, ...p }), inline: (p) => say.inline({ file, ...p }) },
		});
		return true;
	}
	const decl = node.declaration;
	if (decl.type !== "FunctionDeclaration" && !isFn(decl)) return false;
	const fn = unwrap(decl);
	e.emitHead(d, capFirst(say.generators.given({ head: say.plainHead({ file }), params: paramsText(c, fn) })), f.route, node);
	if (fn.body.type === "BlockStatement") e.block(fn.body, d + 1);
	else e.returnLike(fn.body, d + 1, fn.body);
	return true;
};

const paramsText = (c: Ctx, fn: N): string | null => {
	const names = fn.params.flatMap((p: N) => c.e.patternNames(p));
	return names.length ? c.e.g.list(names) : null;
};

/** The route a handler answers, from the file path, or null when the path is unknown. */
const routeText = (c: Ctx) => {
	const f = c.facts.file;
	return f && (f.kind === "route" || f.kind === "api") ? mk("c", f.route) : null;
};

/** Whether exported `GET`/`POST` functions here are route handlers: a `route.ts`, or no path but `next/server` in use. */
const handlesRoutes = (c: Ctx) => {
	const f = c.facts.file;
	if (f) return f.kind === "route";
	return c.facts.active && [...c.facts.imports.values()].some((i) => i.from === "next/server");
};

function handlerOf(node: N): { name: string; fn: N } | null {
	const decl = exported(node);
	if (decl?.type === "FunctionDeclaration" && decl.id) return { name: decl.id.name, fn: decl };
	if (decl?.type === "VariableDeclaration" && decl.declarations.length === 1) {
		const v = decl.declarations[0];
		if (v.id.type === "Identifier" && v.init) return { name: v.id.name, fn: unwrap(v.init) };
	}
	return null;
}

/** `export async function GET(request) { … }` -> "Answer GET /api/users:" plus its steps. */
export const routeHandler: Stmt = (c, node, d) => {
	if (!handlesRoutes(c) || node.type !== "ExportNamedDeclaration") return false;
	const { e, say } = c;
	const route = routeText(c);
	if (!node.declaration && node.specifiers?.length) {
		const methods = node.specifiers.filter((s: N) => isHandlerName(s.exported?.name ?? s.exported?.value));
		if (methods.length !== node.specifiers.length) return false;
		const handlers = new Set(methods.map((s: N) => s.local.name));
		const names = e.g.list(methods.map((s: N) => mk("l", s.exported.name ?? s.exported.value)));
		const handler = handlers.size === 1 ? e.ref([...handlers][0] as string) : e.g.list([...handlers].map((h) => e.ref(h as string)));
		e.emit(d, `${capFirst(say.routes.answerWith({ methods: names, route, handler }))}.`, node);
		return true;
	}
	const h = handlerOf(node);
	if (!h || !isHandlerName(h.name)) return false;
	const method = mk("l", h.name);
	if (!isFn(h.fn) && h.fn.type !== "FunctionDeclaration") {
		e.emit(d, `${capFirst(say.routes.answerWith({ methods: method, route, handler: e.text(h.fn) }))}.`, node);
		return true;
	}
	e.recordParamTypes(h.fn.params);
	e.emitHead(d, capFirst(say.routes.answer({ methods: method, route })), h.name, node);
	if (h.fn.body.type === "BlockStatement") e.block(h.fn.body, d + 1);
	else e.returnLike(h.fn.body, d + 1, h.fn.body);
	return true;
};

/** Pages Router `pages/api/*` default export. */
export const pagesApi: Stmt = (c, node, d) => {
	if (node.type !== "ExportDefaultDeclaration" || c.facts.file?.kind !== "api") return false;
	const fn = unwrap(node.declaration);
	if (fn.type !== "FunctionDeclaration" && !isFn(fn)) return false;
	const { e, say } = c;
	e.recordParamTypes(fn.params);
	e.emitHead(d, capFirst(say.routes.pagesApi({ route: routeText(c) })), "default", node);
	e.block(fn.body, d + 1);
	return true;
};

type Kind = "proxy" | "middleware";

/** Which of middleware/proxy this file is, by path or by its exported function's name. */
function middlewareKind(c: Ctx, name: string | null): Kind | null {
	const k = c.facts.file?.kind;
	if (k === "middleware" || k === "proxy") return k;
	if (c.facts.file || !c.facts.active) return null;
	return name === "middleware" || name === "proxy" ? name : null;
}

/** `export function proxy(request) { … }` (Next.js 16) or `middleware` (earlier). */
export const middleware: Stmt = (c, node, d) => {
	let fn: N = null;
	let name: string | null = null;
	if (node.type === "ExportDefaultDeclaration") [fn, name] = [unwrap(node.declaration), node.declaration.id?.name ?? null];
	if (fn?.type === "CallExpression" && node.type === "ExportDefaultDeclaration") {
		const kind = middlewareKind(c, null);
		if (!kind) return false;
		c.e.emitHead(d, capFirst(c.say.middleware.head({ kind })), kind, node);
		c.e.emitDoc(d + 1, c.e.call(fn, true), fn);
		return true;
	} else {
		const h = handlerOf(node);
		if (h) [fn, name] = [h.fn, h.name];
	}
	if (!fn || (fn.type !== "FunctionDeclaration" && !isFn(fn))) return false;
	if (node.type !== "ExportDefaultDeclaration" && name !== "middleware" && name !== "proxy") return false;
	const kind = middlewareKind(c, name);
	if (!kind) return false;
	const { e, say } = c;
	e.recordParamTypes(fn.params);
	e.emitHead(d, capFirst(say.middleware.head({ kind })), name ?? kind, node);
	if (fn.body.type === "BlockStatement") e.block(fn.body, d + 1);
	else e.returnLike(fn.body, d + 1, fn.body);
	return true;
};

/** One `matcher` entry: a path, or `{ source, has, missing }`. */
function matcherItem(c: Ctx, n: N): string {
	const o = objectArg(n);
	if (!o) return codeText(c.e, n);
	const conds: string[] = [];
	for (const key of ["has", "missing"] as const) {
		const list = unwrap(propOf(o, key));
		for (const x of list?.type === "ArrayExpression" ? list.elements : []) {
			const xo = objectArg(x);
			const type = str(propOf(xo, "type")) as MatchType | null;
			const k = propOf(xo, "key");
			if (!type || !k) continue;
			conds.push(c.say.middleware[key]({ type: c.say.middleware.types[type] ?? type, key: codeText(c.e, k) }));
		}
	}
	const path = codeText(c.e, propOf(o, "source"));
	return conds.length ? c.say.middleware.withConditions({ path, conditions: c.e.g.list(conds) }) : path;
}

/** `export const config = { matcher: [...] }` next to middleware. */
export const matcherConfig: Stmt = (c, node, d) => {
	const decl = exported(node);
	const v = decl?.type === "VariableDeclaration" && decl.declarations.length === 1 ? decl.declarations[0] : null;
	if (v?.id.name !== "config") return false;
	const kind = middlewareKind(c, hasMiddleware(c));
	const matcher = propOf(objectArg(v.init), "matcher");
	if (!kind || !matcher) return false;
	const list = unwrap(matcher);
	const items = list.type === "ArrayExpression" ? list.elements.filter(Boolean).map((x: N) => matcherItem(c, x)) : [matcherItem(c, list)];
	const { e, say } = c;
	if (items.length > 3) {
		e.emitDoc(
			d,
			D(
				say.middleware.matcherList({ kind }),
				items.flatMap((i: string) => e.bullet(D(i))),
			),
			node,
		);
		return true;
	}
	e.emit(d, `${capFirst(say.middleware.matcher({ kind, paths: e.g.list(items) }))}.`, node);
	return true;
};

const hasMiddleware = (c: Ctx): string | null => {
	for (const st of c.e.program.body) {
		const h = st.type === "ExportNamedDeclaration" ? handlerOf(st) : null;
		if (h?.name === "middleware" || h?.name === "proxy") return h.name;
	}
	return null;
};

/** Route segment config: `export const dynamic = "force-dynamic"`, `revalidate`, `runtime`, metadata and viewport. */
export const segmentConfig: Stmt = (c, node, d) => {
	const decl = exported(node);
	if (!c.facts.active || decl?.type !== "VariableDeclaration" || decl.declarations.length !== 1) return false;
	const v = decl.declarations[0];
	if (v.id.type !== "Identifier" || !v.init) return false;
	const f = c.facts.file;
	if (f && f.router !== "app") return false;
	const text = configText(c, v.id.name, unwrap(v.init));
	if (!text) return false;
	const { e } = c;
	if (typeof text === "string") e.emit(d, `${capFirst(text)}.`, node);
	else e.emitDoc(d, text, node);
	return true;
};

function configText(c: Ctx, name: string, init: N) {
	const { e, say } = c;
	const cfg = say.config;
	const s = str(init);
	switch (name) {
		case "dynamic":
			return s && s in cfg.dynamic ? cfg.dynamic[s as DynamicMode] : null;
		case "revalidate": {
			if (init.type === "Literal" && init.value === false) return cfg.revalidate.never;
			const n = num(init);
			if (n === 0) return cfg.revalidate.always;
			return n === null && init.type !== "BinaryExpression" ? null : cfg.revalidate.every({ duration: secondsText(c, init) });
		}
		case "runtime":
			return s && s in cfg.runtimes ? cfg.runtime({ runtime: cfg.runtimes[s as keyof typeof cfg.runtimes] }) : null;
		case "dynamicParams":
			return init.type === "Literal" && typeof init.value === "boolean" ? cfg.dynamicParams[String(init.value) as "true" | "false"] : null;
		case "maxDuration":
			return num(init) !== null ? cfg.maxDuration({ duration: secondsText(c, init) }) : null;
		case "preferredRegion":
			return cfg.preferredRegion({ regions: init.type === "ArrayExpression" ? e.g.list(init.elements.map((x: N) => codeText(e, x))) : codeText(e, init) });
		case "fetchCache":
			return s ? cfg.fetchCache({ value: mk("c", s) }) : null;
		case "experimental_ppr":
			return init.value === true ? cfg.ppr : null;
		case "metadata":
		case "viewport": {
			if (init.type !== "ObjectExpression") return null;
			const items = init.properties.map((p: N) => {
				const k = keyOf(p);
				const label = (k && cfg.fields[k]) || (k ? e.prop(k) : e.text(p.key));
				const value = e.text(p.value);
				return D(str(p.value) !== null ? cfg.labeledText({ name: label, value }) : cfg.labeled({ name: label, value }));
			});
			const phrase = name === "metadata" ? cfg.metadata : cfg.viewport;
			const joined = e.g.list(items.map((i: { t: string }) => i.t));
			if (items.length <= 2 && joined.length < 100) return phrase({ items: joined });
			return D(
				name === "metadata" ? cfg.metadataList : cfg.viewportList,
				items.flatMap((i: ReturnType<typeof D>) => e.bullet(i)),
			);
		}
		default:
			return null;
	}
}

const GENERATORS = [
	"generateMetadata",
	"generateViewport",
	"generateStaticParams",
	"generateSitemaps",
	"generateImageMetadata",
	"getServerSideProps",
	"getStaticProps",
	"getStaticPaths",
] as const;

/** `export async function generateMetadata({ params })` and the Pages Router data functions. */
export const generator: Stmt = (c, node, d) => {
	if (!c.facts.active) return false;
	const h = handlerOf(node);
	if (!h || !(GENERATORS as readonly string[]).includes(h.name) || (!isFn(h.fn) && h.fn.type !== "FunctionDeclaration")) return false;
	const { e, say } = c;
	e.recordParamTypes(h.fn.params);
	const head = say.generators[h.name as (typeof GENERATORS)[number]];
	e.emitHead(d, capFirst(say.generators.given({ head, params: paramsText(c, h.fn) })), h.name, node);
	if (h.fn.body.type === "BlockStatement") e.block(h.fn.body, d + 1);
	else e.returnLike(h.fn.body, d + 1, h.fn.body);
	return true;
};

/** Calls that end the request themselves, so `return redirect(…)` reads as the redirect. */
const TERMINAL = ["redirect", "permanentRedirect", "notFound", "forbidden", "unauthorized"];

/** `return NextResponse.json(…)` -> "Reply with …"; `return NextResponse.next()` -> "Let the request continue." */
export const replyStatement: Stmt = (c, node, d) => {
	if (node.type !== "ReturnStatement" || !node.argument || !c.facts.active) return false;
	const arg = unwrap(node.argument);
	const { e, say } = c;
	const callee = unwrap(arg.callee);
	if (arg.type === "CallExpression" && TERMINAL.includes(nextName({ e, facts: c.facts }, callee) ?? "")) {
		e.emitDoc(d, e.call(arg, true), node);
		return true;
	}
	const isNR = (x: N) => isResponseClass(c, x);
	if (arg.type === "NewExpression" && isNR(callee)) {
		const r = e.noun(arg);
		e.emitDoc(d, D(say.responses.reply({ response: r.t }), r.kids), node);
		return true;
	}
	if (arg.type !== "CallExpression" || callee?.type !== "MemberExpression" || !isNR(callee.object)) return false;
	const m = callee.property.name;
	if (m === "next" && !arg.arguments.length) {
		e.emit(d, `${capFirst(say.responses.continue)}.`, node);
		return true;
	}
	if (m === "redirect") {
		e.emit(d, `${capFirst(say.server.redirect({ path: urlText(c, arg.arguments[0]) }))}.`, node);
		return true;
	}
	const r = e.noun(arg);
	e.emitDoc(d, D(say.responses.reply({ response: r.t }), r.kids), node);
	return true;
};

/** `const { slug } = await params` -> "Take slug from the route parameters." */
export const routeProps: Stmt = (c, node, d) => {
	if (node.type !== "VariableDeclaration" || node.declarations.length !== 1 || !c.facts.active) return false;
	const v = node.declarations[0];
	const init = unwrap(v.init);
	if (v.id.type !== "ObjectPattern" || init?.type !== "Identifier" || (init.name !== "params" && init.name !== "searchParams")) return false;
	if (!c.facts.file && !c.facts.imports.size) return false;
	const { e, say } = c;
	const names = e.patternNames(v.id);
	if (!names.length) return false;
	e.emit(d, `${capFirst(e.say.declarations.takeFrom({ source: say.server[init.name as "params" | "searchParams"], names: e.g.list(names) }))}.`, node);
	return true;
};

export const statements = (): Stmt[] => [
	directive,
	specialFile,
	routeHandler,
	pagesApi,
	middleware,
	matcherConfig,
	segmentConfig,
	generator,
	replyStatement,
	routeProps,
];
