import { capFirst, D, type Doc, type Line, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { responseDoc } from "./context";
import { appChainOf, importedAs, isApp, isAppRoot, ROUTE_METHODS, sourceOf } from "./facts";
import { beforeDoc, spreadHandlers } from "./middleware";
import type { Platform } from "./phrases";
import { type Ctx, details, fnLines, isFn, objectArg, optionItems, pathText, propOf, type Rule, str, typeArgs } from "./shared";
import { streamDoc } from "./streaming";

/** Takes over a statement; returns true once it emitted lines. */
export type Stmt = (c: Ctx, node: N, d: number) => boolean;
type Step = { m: string; args: N[] };

/** A first argument that names a path rather than a handler: a string, or a constant like `USERS_PATH`. */
function isPath(n: N): boolean {
	const u = unwrap(n);
	if (str(u) !== null || u?.type === "TemplateLiteral") return true;
	if (u?.type === "ArrayExpression") return u.elements.length > 0 && u.elements.every((x: N) => str(x) !== null);
	return u?.type === "Identifier" && /^[A-Z][A-Z0-9_]*$|path|route/i.test(u.name);
}

const pathsText = (c: Ctx, n: N): string => {
	const u = unwrap(n);
	if (u?.type !== "ArrayExpression") return pathText(c.e, n);
	return c.e.g.list(u.elements.filter(Boolean).map((x: N) => pathText(c.e, x)));
};

/** `"purge"` / `["PUT", "DELETE"]` in `app.on(…)`, as upper-case method names. */
function methodsText(c: Ctx, n: N): string {
	const u = unwrap(n);
	const one = (x: N) => {
		const s = str(x);
		return s === null ? c.e.text(x) : mk("l", s.toUpperCase());
	};
	if (u?.type !== "ArrayExpression") return one(u);
	return c.e.g.list(u.elements.filter(Boolean).map(one), "or");
}

/** A handler that is one short reply reads inline ("with the text …"); anything else keeps its steps. */
function handlerDoc(c: Ctx, n: N): { inline: string | null; lines: Line[] } {
	const u = unwrap(n);
	if (u?.type === "SpreadElement") {
		const v = c.e.noun(u.argument);
		return { inline: c.say.routes.everythingIn({ value: v.t }), lines: v.kids };
	}
	if (!isFn(u)) {
		const v = c.e.noun(u);
		return { inline: v.t, lines: v.kids };
	}
	if (u.body.type !== "BlockStatement") {
		const r = responseDoc(c, u.body) ?? streamDoc(c, u.body);
		if (r && !r.kids.length) return { inline: r.t, lines: [] };
	}
	return { inline: null, lines: fnLines(c.e, u) };
}

/** One route: `app.get("/users/:id", auth, (c) => …)` -> "answer GET /users/:id, after auth:" plus the handler's steps. */
function routeDoc(c: Ctx, step: Step, prevPath: string | null): { doc: Doc; path: string | null } | null {
	const { m } = step;
	let args = step.args;
	let method: string | null = null;
	if (m === "on") {
		method = methodsText(c, args[0]);
		args = args.slice(1);
	} else if (m !== "all") method = mk("l", m.toUpperCase());
	const path = args[0] && isPath(args[0]) ? pathsText(c, args[0]) : prevPath;
	if (args[0] && isPath(args[0])) args = args.slice(1);
	const handlers = spreadHandlers(c, args);
	const last = handlers.at(-1);
	if (!last) return null;
	const before = beforeDoc(c, handlers.slice(0, -1));
	const h = handlerDoc(c, last);
	const title = c.say.routes.answer({ method, path: path ?? "", handler: h.inline, before: before?.t ?? null });
	return { doc: D(title, [...(before?.kids ?? []), ...h.lines]), path };
}

/** `app.use("/api/*", cors(), logger())`; a lone inline middleware reads as its steps. */
function useDoc(c: Ctx, args: N[]): Doc {
	const path = args[0] && isPath(args[0]) ? pathsText(c, args[0]) : null;
	const mws = path ? args.slice(1) : args;
	const only = mws.length === 1 ? unwrap(mws[0]) : null;
	const onlyFn =
		only && isFn(only) ? only : only?.type === "CallExpression" && importedAs(c, only.callee) === "createMiddleware" ? unwrap(only.arguments[0]) : null;
	if (onlyFn && isFn(onlyFn)) return D(c.say.routes.useInline({ path }), fnLines(c.e, onlyFn));
	const list = beforeDoc(c, mws);
	return D(c.say.routes.use({ middleware: list?.t ?? "", path }), list?.kids ?? []);
}

/** `app.onError(fn)` / `app.notFound(fn)`. */
function hookDoc(c: Ctx, fn: N, heading: string, named: (p: { handler: string }) => string): Doc {
	if (isFn(fn)) return D(heading, fnLines(c.e, fn));
	const h = c.e.noun(fn);
	return D(named({ handler: h.t }), h.kids);
}

function stepDoc(c: Ctx, step: Step, prevPath: string | null): { doc: Doc; path: string | null } | null {
	const { e, say } = c;
	const [a, b] = step.args;
	switch (step.m) {
		case "use":
			return { doc: useDoc(c, step.args), path: prevPath };
		case "route":
			return { doc: D(say.routes.mount({ app: e.text(b ?? a), path: b ? pathText(e, a) : mk("c", "/") })), path: prevPath };
		case "mount":
			return { doc: D(say.routes.mountHandler({ handler: e.text(b), path: pathText(e, a) })), path: prevPath };
		case "basePath":
			return { doc: D(say.app.basePath({ path: pathText(e, a) })), path: prevPath };
		case "onError":
			return { doc: hookDoc(c, a, say.routes.onError, say.routes.onErrorWith), path: prevPath };
		case "notFound":
			return { doc: hookDoc(c, a, say.routes.notFound, say.routes.notFoundWith), path: prevPath };
		default:
			return routeDoc(c, step, prevPath);
	}
}

/** Each step of an app chain, chained routes without a path reusing the one before; null if a step isn't Hono's. */
function stepDocs(c: Ctx, steps: Step[]): Doc[] | null {
	let path: string | null = null;
	const docs: Doc[] = [];
	for (const s of steps) {
		const r = stepDoc(c, s, path);
		if (!r) return null;
		path = r.path;
		docs.push(r.doc);
	}
	return docs;
}

const bullets = (c: Ctx, docs: Doc[]): Line[] => docs.flatMap((d) => c.e.bullet(D(capFirst(d.t), d.kids)));

/** The details `new Hono<{ Bindings; Variables }>({ strict })` was created with. */
function creationDetails(c: Ctx, root: N): string[] {
	const u = unwrap(root);
	if (u?.type !== "NewExpression") return [];
	const { e, say } = c;
	const typeText = (t: N) => {
		if (t?.type !== "TSTypeLiteral") return mk("c", e.code(t));
		return e.g.list(t.members.map((m: N) => mk("c", m.key?.name ?? e.code(m))));
	};
	const [env] = typeArgs(u);
	const types: string[] =
		env?.type === "TSTypeLiteral"
			? env.members.flatMap((m: N) => {
					const t = typeText(m.typeAnnotation?.typeAnnotation);
					if (m.key?.name === "Bindings") return [say.app.bindings({ type: t })];
					if (m.key?.name === "Variables") return [say.app.variables({ type: t })];
					return [];
				})
			: env
				? [say.app.env({ type: mk("c", e.code(env)) })]
				: [];
	const opts = objectArg(u.arguments[0]);
	const strict = unwrap(propOf(opts, "strict"));
	return [
		...types,
		...(strict?.type === "Literal" && typeof strict.value === "boolean" ? [say.app.strict({ strict: strict.value })] : []),
		...(opts ? optionItems(c, opts, ["strict"]) : []),
	];
}

/** The app a chain starts from, with any leading `.basePath(…)`. */
function subjectOf(c: Ctx, root: N, steps: Step[]): { subject: Doc; rest: Step[] } {
	const u = unwrap(root);
	let subject = u.type === "Identifier" ? D(c.e.ref(u.name)) : D(c.say.app.noun);
	const details_ = creationDetails(c, u);
	const d = details(c, details_);
	if (d) subject = D(c.say.response.withDetails({ response: subject.t, details: d }));
	let i = 0;
	while (steps[i]?.m === "basePath") {
		subject = D(c.say.app.under({ app: subject.t, path: pathText(c.e, steps[i]!.args[0]) }));
		i++;
	}
	return { subject, rest: steps.slice(i) };
}

/** An app chain as one value: a single step reads as itself, several as the app with its routes beneath. */
export function appChainDoc(c: Ctx, node: N): Doc | null {
	const { root, steps } = appChainOf(c, node);
	if (!steps.length || !isAppRoot(c, root) || !steps.every((s) => ROUTE_METHODS.includes(s.m))) return null;
	const { subject, rest } = subjectOf(c, root, steps);
	if (!rest.length) return subject;
	const docs = stepDocs(c, rest);
	if (!docs) return null;
	if (docs.length === 1 && rest.length === steps.length && unwrap(root).type === "Identifier") return docs[0]!;
	return D(c.say.app.withRoutes({ app: subject.t }), bullets(c, docs));
}

const appRule: Rule = (c, { node }) => appChainDoc(c, node);

/** `app.request("/hello", init)` in tests. */
const testRequest: Rule = (c, { obj, args }) => {
	if (!obj || !isApp(c, obj) || !args[0]) return null;
	const { e, say } = c;
	return D(say.routes.testRequest({ app: e.text(obj), path: pathText(e, args[0]), init: args[1] ? e.text(args[1]) : null }));
};

/** `app.fetch` passed to a server: the app it belongs to. */
function fetchedApp(c: Ctx, n: N): N | null {
	const u = unwrap(n);
	if (u?.type === "MemberExpression" && !u.computed && u.property.name === "fetch" && isApp(c, u.object)) return u.object;
	return null;
}

/** `{ fetch: app.fetch, port: 3000 }` as "serve app on port 3000". */
function serveDoc(c: Ctx, opts: N, app: N | null): Doc | null {
	const o = objectArg(opts);
	const target = app ?? fetchedApp(c, propOf(o, "fetch"));
	if (!target) return null;
	const port = propOf(o, "port");
	const rest = o ? details(c, optionItems(c, o, ["fetch", "port"])) : null;
	return D(c.say.serve.serve({ app: c.e.text(target), port: port ? c.e.text(port) : null, details: rest }));
}

/** `serve({ fetch: app.fetch, port }, (info) => …)` from `@hono/node-server`. */
const nodeServe: Rule = (c, { node, args }) => {
	if (importedAs(c, node.callee) !== "serve" || !sourceOf(c, "serve")?.includes("node-server")) return null;
	const { e, say } = c;
	const [opts, cb] = args;
	const d = isApp(c, opts) ? serveDoc(c, null, opts) : serveDoc(c, opts, null);
	if (!d) return null;
	return cb && isFn(cb) ? D(d.t, e.bullet(D(say.serve.listening, fnLines(e, cb)))) : d;
};

/** `Bun.serve({ fetch: app.fetch })`, `Deno.serve(app.fetch)`, `Deno.serve({ port }, app.fetch)`. */
const runtimeServe: Rule = (c, { args }) => {
	const fetchArg = args.find((a) => fetchedApp(c, a));
	if (fetchArg) {
		const opts = args.find((a) => objectArg(a));
		return serveDoc(c, opts, fetchedApp(c, fetchArg));
	}
	return args[0] ? serveDoc(c, args[0], null) : null;
};

const PLATFORMS: Platform[] = ["vercel", "aws-lambda", "lambda-edge", "netlify", "cloudflare-pages"];

const platformOf = (c: Ctx, callee: N): Platform | null => {
	const u = unwrap(callee);
	if (u?.type !== "Identifier" || importedAs(c, u) !== "handle") return null;
	const src = sourceOf(c, u.name) ?? "";
	return PLATFORMS.find((p) => src.endsWith(`/${p}`)) ?? null;
};

/** `handle(app)` from `hono/vercel` and the other serverless adapters. */
const adapter: Rule = (c, { node, args }) => {
	const platform = platformOf(c, node.callee);
	if (!platform || !args[0] || !isApp(c, args[0])) return null;
	return D(c.say.serve.adapter({ app: c.e.text(args[0]), platform: c.say.serve.platforms[platform] }));
};

/** Routes, middleware mounting, app creation, test requests, and serving. */
export function appCalls(): Record<string, Rule> {
	const calls: Record<string, Rule> = {};
	for (const m of ROUTE_METHODS) calls[`*.${m}`] = appRule;
	return {
		...calls,
		"new Hono": (c, { node }) => (importedAs(c, node.callee) === "Hono" ? subjectOf(c, node, []).subject : null),
		"*.createApp": (c, { node }) => (isAppRoot(c, node) ? D(c.say.app.noun) : null),
		"*.request": testRequest,
		serve: nodeServe,
		"Bun.serve": runtimeServe,
		"Deno.serve": runtimeServe,
		handle: adapter,
	};
}

/** `const app = new Hono()…`: "create a Hono app as app", with any chained routes beneath. */
const createStatement: Stmt = (c, node, d) => {
	const { e, say } = c;
	if (node.type !== "VariableDeclaration" || node.declarations.length !== 1) return false;
	const v = node.declarations[0];
	if (v.id.type !== "Identifier" || !v.init) return false;
	const { root, steps } = appChainOf(c, v.init);
	const r = unwrap(root);
	const fresh = r?.type === "NewExpression" || r?.type === "CallExpression";
	if (!fresh || !isAppRoot(c, r) || !steps.every((s) => ROUTE_METHODS.includes(s.m))) return false;
	const items = creationDetails(c, r);
	let i = 0;
	for (; steps[i]?.m === "basePath"; i++) items.push(say.app.basePath({ path: pathText(e, steps[i]!.args[0]) }));
	const docs = stepDocs(c, steps.slice(i));
	if (!docs) return false;
	const title = say.app.create({ name: e.ref(v.id.name), details: details(c, items) });
	e.emitDoc(d, D(title, bullets(c, docs)), node);
	return true;
};

/** `app.get(…).post(…)` as a statement: one line per route. */
const chainStatement: Stmt = (c, node, d) => {
	if (node.type !== "ExpressionStatement") return false;
	const { root, steps } = appChainOf(c, node.expression);
	if (steps.length < 2 || unwrap(root)?.type !== "Identifier" || !isAppRoot(c, root) || !steps.every((s) => ROUTE_METHODS.includes(s.m))) return false;
	const docs = stepDocs(c, steps);
	if (!docs) return false;
	for (const doc of docs) c.e.emitDoc(d, doc, node);
	return true;
};

/** `export default app` and `export default { port, fetch: app.fetch }`. */
const exportStatement: Stmt = (c, node, d) => {
	if (node.type !== "ExportDefaultDeclaration") return false;
	const { e, say } = c;
	const decl = unwrap(node.declaration);
	if (decl?.type === "Identifier" && isApp(c, decl)) {
		e.emitDoc(d, D(say.serve.exportApp({ app: e.text(decl) })), node);
		return true;
	}
	if (decl?.type === "CallExpression") {
		const platform = platformOf(c, decl.callee);
		if (!platform || !decl.arguments[0] || !isApp(c, decl.arguments[0])) return false;
		e.emitDoc(d, D(say.serve.exportAdapter({ app: e.text(decl.arguments[0]), platform: say.serve.platforms[platform] })), node);
		return true;
	}
	const served = decl?.type === "ObjectExpression" ? serveDoc(c, decl, null) : null;
	if (!served) return false;
	e.emitDoc(d, served, node);
	return true;
};

export const appStatements = (): Stmt[] => [createStatement, chainStatement, exportStatement];
