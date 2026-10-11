import { D, type Doc, type Line, mk } from "@usenarrator/core";
import { type CallRule, definePlugin, type Engine, type N, type StmtRule, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { calleeKey, type FileImports, fileImports, isFn, isObj, objProp, schemaPhrase, strLit } from "../context";
import { en } from "./en";
import type { PlatformPhrases } from "./phrases";

export { en } from "./en";
export type { PlatformPhrases } from "./phrases";

type Ctx = { e: Engine; say: PlatformPhrases; imp: FileImports; clients: Set<string> };
type Rule = (c: Ctx, x: { node: N; args: N[]; obj: N | null; stmt: boolean }) => Doc | string | null;

const METHODS: Record<string, string> = {
	get: "GET",
	post: "POST",
	put: "PUT",
	patch: "PATCH",
	del: "DELETE",
	delete: "DELETE",
	head: "HEAD",
	options: "OPTIONS",
	all: "ANY",
};
const CLIENT = /\b(\w+)\s*=\s*\(?\s*yield\*\s+HttpClient\.HttpClient\b/g;

const text = (c: Ctx, n: N) => c.e.noun(n).t;
/** Platform modules are always imported by name, so require that rather than guessing. */
const imported = (c: Ctx, module: string) => c.imp.effectNames.has(module);
/** A URL or route path, kept verbatim. */
const path = (c: Ctx, n: N) => {
	const s = strLit(n);
	if (s !== null) return mk("l", s);
	const u = unwrap(n);
	if (u?.type === "TemplateLiteral")
		return mk("l", u.quasis.map((q: N, i: number) => `${q.value.cooked}${u.expressions[i] ? `\${${c.e.code(u.expressions[i])}}` : ""}`).join(""));
	return text(c, n);
};
const entries = (c: Ctx, obj: N) =>
	c.e.g.list(
		unwrap(obj).properties.map((p: N) =>
			p.type === "Property" ? c.say.common.labeled({ label: c.e.prop(p.key?.name ?? String(p.key?.value)), value: text(c, p.value) }) : text(c, p),
		),
	);

/** A schema argument as a type phrase; v4 accepts a plain object of fields where v3 wanted `Schema.Struct`. */
function schema(c: Ctx, n: N): string {
	const u = unwrap(n);
	const target =
		u?.type === "ObjectExpression"
			? {
					type: "CallExpression",
					callee: {
						type: "MemberExpression",
						computed: false,
						object: { type: "Identifier", name: "Schema" },
						property: { type: "Identifier", name: "Struct" },
					},
					arguments: [u],
					start: u.start,
					end: u.end,
				}
			: u;
	return schemaPhrase(c.e, target);
}
const schemas = (c: Ctx, n: N) => {
	const u = unwrap(n);
	return u?.type === "ArrayExpression"
		? c.e.g.list(
				u.elements.map((x: N) => schema(c, x)),
				"or",
			)
		: schema(c, u);
};

/** A step rule: the step itself in action form, "a step that will …" as a value. */
const asStep =
	(f: (c: Ctx, args: N[]) => string | null): Rule =>
	(c, { args, stmt }) => {
		const s = f(c, args);
		return s && (stmt ? s : c.say.common.stepFn({ step: s }));
	};

function request(c: Ctx, method: string, args: N[], stmt: boolean): Doc | null {
	const [url, opts] = args;
	if (!url) return null;
	const p = { method, url: path(c, url) };
	if (opts && isObj(opts) && unwrap(opts).properties.length) return D(c.say.client.requestWith[stmt ? "act" : "noun"]({ ...p, options: entries(c, opts) }));
	return D(c.say.client.request[stmt ? "act" : "noun"](p));
}

/** A route handler: a response, an effect, or a function, with its block lines kept. */
const handler = (c: Ctx, n: N) => c.e.noun(n);

function routeDoc(c: Ctx, pick: (s: PlatformPhrases) => (p: { method: string; path: string; handler: string }) => string, method: string, p: N, h: N): Doc {
	const v = handler(c, h);
	return D(pick(c.say)({ method, path: path(c, p), handler: v.t }), v.kids);
}

/** `HttpApiEndpoint.get("getUser", "/users/:id").setPath(...).addSuccess(User)` (v3) or `HttpApiEndpoint.get("getUser", "/users/:id", { params, success })` (v4). */
function endpoint(c: Ctx, node: N): Doc | null {
	const a = c.say.api;
	const mods: { name: string; args: N[] }[] = [];
	let cur = unwrap(node);
	while (cur?.type === "CallExpression" && unwrap(cur.callee).type === "MemberExpression" && unwrap(unwrap(cur.callee).object).type === "CallExpression") {
		mods.unshift({ name: unwrap(cur.callee).property.name, args: cur.arguments });
		cur = unwrap(unwrap(cur.callee).object);
	}
	const key = calleeKey(cur);
	if (!key?.startsWith("HttpApiEndpoint.") || !imported(c, "HttpApiEndpoint")) return null;
	const method = METHODS[key.slice(16)];
	const [name, p, opts] = cur.arguments;
	if (!method || !name || !p) return null;
	const facts: string[] = [];
	const add = (field: string, v: N) => {
		if (field === "params" || field === "setPath") facts.push(a.params({ type: schema(c, v) }));
		if (field === "query" || field === "urlParams" || field === "setUrlParams") facts.push(a.query({ type: schema(c, v) }));
		if (field === "payload" || field === "setPayload") facts.push(a.payload({ type: schemas(c, v) }));
		if (field === "headers" || field === "setHeaders") facts.push(a.headers({ type: schema(c, v) }));
		if (field === "success" || field === "addSuccess") facts.push(a.success({ type: schemas(c, v) }));
		if (field === "error") facts.push(a.error({ type: schemas(c, v) }));
	};
	if (opts && isObj(opts)) for (const prop of unwrap(opts).properties) if (prop.type === "Property") add(prop.key?.name, prop.value);
	for (const m of mods) {
		if (!m.args[0]) continue;
		const status = m.name === "addError" && m.args[1] ? objProp(m.args[1], "status") : null;
		if (m.name === "addError")
			facts.push(status ? a.errorStatus({ type: schema(c, m.args[0]), status: text(c, status) }) : a.error({ type: schema(c, m.args[0]) }));
		else add(m.name, m.args[0]);
	}
	return D(
		a.endpoint({ name: path(c, name), method, path: path(c, p) }),
		facts.flatMap((f) => c.e.bullet(D(f))),
	);
}

/** `HttpApiGroup.make("users").add(...)` / `HttpApi.make("api").add(...)`: the name and everything added. */
function container(c: Ctx, node: N): { kind: "group" | "api"; id: N; lines: Line[] } | null {
	const items: Line[] = [];
	let cur = unwrap(node);
	while (cur?.type === "CallExpression" && unwrap(cur.callee).type === "MemberExpression" && unwrap(unwrap(cur.callee).object).type === "CallExpression") {
		const m = unwrap(cur.callee).property.name;
		const lines =
			m === "add"
				? cur.arguments.flatMap((x: N) => c.e.bullet(endpoint(c, x) ?? c.e.noun(x)))
				: m === "prefix" && cur.arguments[0]
					? c.e.bullet(D(c.say.api.prefix({ path: path(c, cur.arguments[0]) })))
					: [];
		items.unshift(...lines);
		cur = unwrap(unwrap(cur.callee).object);
	}
	const key = calleeKey(cur);
	if ((key !== "HttpApiGroup.make" && key !== "HttpApi.make") || !imported(c, key.split(".")[0]!) || !cur.arguments[0]) return null;
	return { kind: key === "HttpApi.make" ? "api" : "group", id: cur.arguments[0], lines: items };
}

const containerDoc = (c: Ctx, node: N) => {
	const k = container(c, node);
	if (!k) return null;
	const name = path(c, k.id);
	return D(k.kind === "api" ? c.say.api.api({ name }) : c.say.api.group({ name }), k.lines);
};

/** `(handlers) => handlers.handle("a", fa).handle("b", fb)`: one line per endpoint handler. */
function handlerLines(c: Ctx, cb: N): Line[] {
	const f = unwrap(cb);
	let cur = isFn(f) ? c.e.lambdaExpr(f) : null;
	const out: Line[] = [];
	while (unwrap(cur)?.type === "CallExpression" && unwrap(unwrap(cur).callee).type === "MemberExpression") {
		const call = unwrap(cur);
		const callee = unwrap(call.callee);
		const [name, fn] = call.arguments;
		if (/^handle(Raw)?$/.test(callee.property.name) && name && fn) {
			const body = unwrap(fn);
			const ex = isFn(body) ? c.e.lambdaExpr(body) : body;
			const action = ex ? (unwrap(ex).type === "CallExpression" ? c.e.call(unwrap(ex), true) : c.e.noun(ex)) : null;
			out.unshift(
				...c.e.bullet(
					action
						? D(c.say.api.handler({ name: path(c, name), action: action.t }), action.kids)
						: D(c.say.api.handlerSteps({ name: path(c, name) }), c.e.body(body.body, 0)),
				),
			);
		}
		cur = callee.object;
	}
	return out;
}

const routeMethod = (n: N) => {
	const s = strLit(n);
	return s && Object.values(METHODS).includes(s.toUpperCase()) ? s.toUpperCase() : s === "*" ? "ANY" : null;
};

function rules(): Record<string, Rule> {
	const r: Record<string, Rule> = {};
	for (const [m, method] of Object.entries(METHODS)) {
		r[`*.${m}`] = (c, { args, obj, stmt }) => (unwrap(obj)?.type === "Identifier" && c.clients.has(unwrap(obj).name) ? request(c, method, args, stmt) : null);
		r[`HttpClient.${m}`] = (c, { args, stmt }) => (imported(c, "HttpClient") ? request(c, method, args, stmt) : null);
		r[`HttpClientRequest.${m}`] = (c, { args }) =>
			imported(c, "HttpClientRequest") && args[0] ? D(c.say.client.newRequest({ method, url: path(c, args[0]) })) : null;
		r[`HttpRouter.${m}`] = (c, { args, stmt }) => {
			const [p, h] = args;
			if (!imported(c, "HttpRouter") || !p || !h) return null;
			const d = routeDoc(c, (s) => s.router.route, method, p, h);
			return stmt ? d : D(c.say.common.stepFn({ step: d.t }), d.kids);
		};
		r[`HttpApiEndpoint.${m}`] = (c, { node }) => endpoint(c, node);
	}
	r["*.execute"] = (c, { args, obj, stmt }) =>
		unwrap(obj)?.type === "Identifier" && c.clients.has(unwrap(obj).name) && args[0]
			? D(c.say.client.execute[stmt ? "act" : "noun"]({ request: text(c, args[0]) }))
			: null;
	const owned =
		(module: string, f: Rule): Rule =>
		(c, x) =>
			imported(c, module) ? f(c, x) : null;

	r["HttpClientRequest.bodyJson"] = owned(
		"HttpClientRequest",
		asStep((c, [b]) => (b ? c.say.client.bodyJson({ body: text(c, b) }) : null)),
	);
	r["HttpClientRequest.setHeader"] = owned(
		"HttpClientRequest",
		asStep((c, [k, v]) => (k && v ? c.say.client.header({ name: path(c, k), value: text(c, v) }) : null)),
	);
	r["HttpClientRequest.bearerToken"] = owned(
		"HttpClientRequest",
		asStep((c, [t]) => (t ? c.say.client.bearer({ token: text(c, t) }) : null)),
	);
	r["HttpClientRequest.acceptJson"] = owned(
		"HttpClientRequest",
		asStep((c) => c.say.client.acceptJson),
	);
	for (const m of ["setUrlParams", "appendUrlParams"])
		r[`HttpClientRequest.${m}`] = owned(
			"HttpClientRequest",
			asStep((c, [p]) => (p ? c.say.client.urlParams({ params: isObj(p) ? entries(c, p) : text(c, p) }) : null)),
		);
	r["HttpClientRequest.prependUrl"] = owned(
		"HttpClientRequest",
		asStep((c, [u]) => (u ? c.say.client.prependUrl({ url: path(c, u) }) : null)),
	);
	r["HttpClient.mapRequest"] = owned(
		"HttpClient",
		asStep((c, [f]) => (f && unwrap(f).type === "CallExpression" && c.e.applyRulesQuiet(unwrap(f)) ? c.e.call(unwrap(f), true).t : null)),
	);
	r["HttpClient.retryTransient"] = owned(
		"HttpClient",
		asStep((c, [o]) => {
			const times = o && isObj(o) ? objProp(o, "times") : null;
			return times ? c.say.client.retryTransient({ how: c.say.client.times({ n: text(c, times) }) }) : c.say.client.retryTransientBare;
		}),
	);
	for (const m of ["schemaBodyJson", "schemaJson"]) {
		r[`HttpClientResponse.${m}`] = owned(
			"HttpClientResponse",
			asStep((c, [s]) => (s ? c.say.client.jsonBodyReader({ type: schema(c, s) }) : null)),
		);
		r[`HttpClientResponse.${m}()`] = owned("HttpClientResponse", (c, { node, args, stmt }) => {
			const [s] = unwrap(node.callee).arguments;
			return s && args[0] ? D(c.say.client.jsonBody[stmt ? "act" : "noun"]({ response: text(c, args[0]), type: schema(c, s) })) : null;
		});
	}

	const response =
		(f: (c: Ctx, x: N) => string): Rule =>
		(c, { args: [x, opts] }) => {
			if (!imported(c, "HttpServerResponse") || !x) return null;
			const base = f(c, x);
			const status = opts && isObj(opts) ? objProp(opts, "status") : null;
			return status ? c.say.server.withStatus({ response: base, status: text(c, status) }) : base;
		};
	r["HttpServerResponse.json"] = response((c, x) => c.say.server.json({ value: text(c, x) }));
	r["HttpServerResponse.text"] = response((c, x) => c.say.server.text({ text: text(c, x) }));
	r["HttpServerResponse.html"] = response((c, x) => c.say.server.html({ html: text(c, x) }));
	r["HttpServerResponse.redirect"] = response((c, x) => c.say.server.redirect({ url: path(c, x) }));
	r["HttpServerResponse.empty"] = owned("HttpServerResponse", (c, { args: [opts] }) => {
		const status = opts && isObj(opts) ? objProp(opts, "status") : null;
		return status ? c.say.server.withStatus({ response: c.say.server.empty, status: text(c, status) }) : c.say.server.empty;
	});
	const parsed =
		(module: string, pick: (s: PlatformPhrases) => PlatformPhrases["server"]["requestBody"]): Rule =>
		(c, { args: [s], stmt }) =>
			imported(c, module) && s ? pick(c.say)[stmt ? "act" : "noun"]({ type: schema(c, s) }) : null;
	r["HttpServerRequest.schemaBodyJson"] = parsed("HttpServerRequest", (s) => s.server.requestBody);
	r["HttpServerRequest.schemaSearchParams"] = parsed("HttpServerRequest", (s) => s.server.searchParams);
	r["HttpRouter.schemaPathParams"] = parsed("HttpRouter", (s) => s.server.pathParams);
	r["HttpRouter.schemaParams"] = parsed("HttpRouter", (s) => s.server.pathParams);
	r["HttpRouter.schemaJson"] = parsed("HttpRouter", (s) => s.server.requestBody);
	r["HttpServer.serve"] = owned(
		"HttpServer",
		asStep((c) => c.say.server.serve),
	);
	r["HttpApiBuilder.serve"] = owned(
		"HttpApiBuilder",
		asStep((c) => c.say.server.serve),
	);

	r["HttpRouter.mount"] = owned(
		"HttpRouter",
		asStep((c, [p, router]) => (p && router ? c.say.router.mount({ prefix: path(c, p), router: text(c, router) }) : null)),
	);
	r["HttpRouter.prefixAll"] = owned(
		"HttpRouter",
		asStep((c, [p]) => (p ? c.say.router.prefixAll({ prefix: path(c, p) }) : null)),
	);
	r["HttpRouter.use"] = owned("HttpRouter", (c, { args: [x], stmt }) => {
		if (!x) return null;
		if (isFn(x)) {
			const f = unwrap(x);
			const ex = c.e.lambdaExpr(f);
			return D(c.say.router.routesAdded, ex ? c.e.bullet(c.e.call(unwrap(ex), true)) : c.e.body(f.body, 0));
		}
		const s = c.say.router.use({ middleware: text(c, x) });
		return stmt ? s : c.say.common.stepFn({ step: s });
	});
	const routeLayer: Rule = (c, { args: [m, p, h], stmt }) => {
		const method = m && routeMethod(m);
		if (!imported(c, "HttpRouter") || !method || !p || !h) return null;
		return routeDoc(c, (s) => (stmt ? s.router.route : s.router.routeLayer), method, p, h);
	};
	r["HttpRouter.add"] = routeLayer;
	r["HttpRouter.route"] = routeLayer;
	r["*.add"] = (c, x) => (x.args.length === 3 && !isObj(x.args[2]) ? routeLayer(c, { ...x, stmt: true }) : (containerDoc(c, x.node) ?? null));
	r["*.prefix"] = (c, { node }) => containerDoc(c, node);
	r["HttpRouter.addAll"] = owned("HttpRouter", (c, { args: [xs] }) => {
		const u = unwrap(xs);
		if (u?.type !== "ArrayExpression") return null;
		return D(
			c.say.router.routes,
			u.elements.flatMap((x: N) => c.e.bullet(unwrap(x).type === "CallExpression" ? c.e.call(unwrap(x), true) : c.e.noun(x))),
		);
	});
	for (const m of ["setPath", "setUrlParams", "setPayload", "setHeaders", "addSuccess", "addError"]) r[`*.${m}`] = (c, { node }) => endpoint(c, node);
	r["HttpApiGroup.make"] = (c, { node }) => containerDoc(c, node);
	r["HttpApi.make"] = (c, { node }) => containerDoc(c, node);
	r["HttpApiBuilder.group"] = owned("HttpApiBuilder", (c, { args: [api, group, cb] }) =>
		api && group && cb ? D(c.say.api.handlers({ group: path(c, group), api: text(c, api) }), handlerLines(c, cb)) : null,
	);
	for (const m of ["api", "layer"])
		r[`HttpApiBuilder.${m}`] = owned("HttpApiBuilder", (c, { args: [api] }) => (api ? c.say.api.serveApi({ api: text(c, api) }) : null));
	return r;
}

/** `HttpRouter.empty.pipe(HttpRouter.get(...), ...)` as a list of routes. */
const routerPipe: Rule = (c, { obj, args }) => {
	if (!obj || c.e.code(unwrap(obj)) !== "HttpRouter.empty" || !imported(c, "HttpRouter")) return null;
	const steps = args.map((a) => (unwrap(a).type === "CallExpression" && c.e.applyRulesQuiet(unwrap(a)) ? c.e.call(unwrap(a), true) : null));
	if (steps.some((s) => !s)) return null;
	return D(
		c.say.router.routes,
		steps.flatMap((s) => c.e.bullet(s!)),
	);
};

/** `class UsersApi extends HttpApiGroup.make("users").add(...) {}` gets a heading and its endpoints. */
const classRule =
	(ctx: (e: Engine, say: PlatformPhrases) => Ctx): StmtRule<PlatformPhrases> =>
	({ node, e, d, say }) => {
		if (node.type !== "ClassDeclaration" || !node.id || !node.superClass) return false;
		const c = ctx(e, say);
		const k = container(c, node.superClass);
		if (!k) return false;
		const p = { name: e.fnRef(node.id.name, node.id.name), id: path(c, k.id) };
		e.emitDoc(d, D(k.kind === "api" ? say.api.namedApi(p) : say.api.namedGroup(p), k.lines), node);
		return true;
	};

/** Effect's HTTP modules: `HttpClient`, `HttpRouter`, `HttpServerResponse` and `HttpApi*`, from `@effect/platform` (v3) or `effect/http` + `effect/http-api` (v4). */
export const effectPlatform = (): TsPlugin<PlatformPhrases> => {
	let file: { program: N; imp: FileImports; clients: Set<string> } | null = null;
	const ctx = (e: Engine, say: PlatformPhrases): Ctx => {
		const f =
			file && file.program === e.program
				? file
				: (file = { program: e.program, imp: fileImports(e), clients: new Set([...e.src.matchAll(CLIENT)].map((m) => m[1]!)) });
		return { e, say, imp: f.imp, clients: f.clients };
	};
	const calls: Record<string, CallRule<PlatformPhrases>> = {};
	const bind =
		(rule: Rule): CallRule<PlatformPhrases> =>
		({ node, args, obj, e, stmt, say }) => {
			const c = ctx(e, say);
			return c.imp.importsEffect ? rule(c, { node, args, obj, stmt }) : null;
		};
	for (const [key, rule] of Object.entries(rules())) calls[key] = bind(rule);
	calls["*.pipe"] = bind(routerPipe);
	return definePlugin<PlatformPhrases>({
		name: "effect-platform",
		library: { name: "effect", versions: ">=3.10 <5" },
		phrases: { en },
		calls,
		statements: [classRule(ctx)],
	});
};
