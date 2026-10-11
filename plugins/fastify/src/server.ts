import { D, type Doc, type Line, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { createsServer, importOf, isReply, isServer, ROUTE_METHODS } from "./facts";
import type { Hook, Part, Plugin } from "./phrases";
import { shapeText } from "./schema";
import { bullets, type Ctx, codeText, details, isFnNode, keyOf, listDoc, num, objectArg, optionItems, pathText, propOf, statusText, str } from "./shared";

export type Version = 4 | 5 | null;
/** Returns that belong directly to a route handler: they send the reply. */
export type ReplyReturns = WeakSet<N>;
export type Rc = Ctx & { major: Version; returns: ReplyReturns };

const HOOKS: Hook[] = [
	"onRequest",
	"preParsing",
	"preValidation",
	"preHandler",
	"preSerialization",
	"onSend",
	"onResponse",
	"onError",
	"onTimeout",
	"onRequestAbort",
	"onReady",
	"onListen",
	"onClose",
	"preClose",
	"onRoute",
	"onRegister",
];
const PARTS: Part[] = ["body", "querystring", "params", "headers"];
const PLUGINS: Record<string, Plugin> = {
	"@fastify/cors": "cors",
	"@fastify/helmet": "helmet",
	"@fastify/jwt": "jwt",
	"@fastify/cookie": "cookie",
	"@fastify/static": "static",
	"@fastify/swagger": "swagger",
	"@fastify/swagger-ui": "swagger-ui",
	"@fastify/rate-limit": "rate-limit",
	"@fastify/multipart": "multipart",
	"@fastify/formbody": "formbody",
	"@fastify/sensible": "sensible",
	"@fastify/autoload": "autoload",
	"@fastify/websocket": "websocket",
	"@fastify/compress": "compress",
	"@fastify/env": "env",
	"@fastify/postgres": "postgres",
	"@fastify/redis": "redis",
	"@fastify/mongodb": "mongodb",
};

/** Marks the returns of a handler's own body (not of callbacks inside it), so they read as the reply. */
function markReturns(rc: Rc, fn: N) {
	const walk = (n: N) => {
		if (!n || typeof n !== "object") return;
		if (Array.isArray(n)) return n.forEach(walk);
		if (n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression" || n.type === "FunctionDeclaration") return;
		if (n.type === "ReturnStatement") rc.returns.add(n);
		for (const k in n) if (k !== "parent" && n[k] && typeof n[k] === "object") walk(n[k]);
	};
	walk(unwrap(fn).body);
}

/** A handler's steps; an expression body is its reply. */
export function handlerLines(rc: Rc, fn: N): Line[] {
	const f = unwrap(fn);
	if (f.body.type === "BlockStatement") {
		markReturns(rc, f);
		return rc.e.body(f.body, 0);
	}
	const ret = { type: "ReturnStatement", argument: f.body, start: f.body.start, end: f.body.end };
	rc.returns.add(ret);
	return rc.e.body(ret, 0);
}

/** Plain steps for hooks and callbacks: returns keep their usual meaning. */
const stepLines = (rc: Rc, fn: N): Line[] => {
	const f = unwrap(fn);
	if (f.body.type === "BlockStatement") return rc.e.body(f.body, 0);
	return rc.e.body({ type: "ExpressionStatement", expression: f.body, start: f.body.start, end: f.body.end }, 0);
};

type Step = { m: string; args: N[] };
const REPLY_SENDS = [
	"send",
	"redirect",
	"view",
	"sendFile",
	"callNotFound",
	"notFound",
	"badRequest",
	"unauthorized",
	"forbidden",
	"conflict",
	"internalServerError",
];
const REPLY_SETS = ["code", "status", "header", "headers", "type", "setCookie", "clearCookie", "hijack", "removeHeader"];
export const REPLY_METHODS = [...REPLY_SENDS, ...REPLY_SETS];
const SENSIBLE: Record<string, number> = { notFound: 404, badRequest: 400, unauthorized: 401, forbidden: 403, conflict: 409, internalServerError: 500 };

function replyChain(rc: Rc, node: N): Step[] | null {
	const steps: Step[] = [];
	let cur = unwrap(node);
	while (cur?.type === "CallExpression") {
		const callee = unwrap(cur.callee);
		if (callee?.type !== "MemberExpression" || callee.computed || !REPLY_METHODS.includes(callee.property.name)) return null;
		steps.unshift({ m: callee.property.name, args: cur.arguments });
		cur = unwrap(callee.object);
	}
	return steps.length && isReply(rc.facts, cur) ? steps : null;
}

/** `reply.redirect`: v5 takes `(url, code?)`, v4 took `(code, url)`; literal numbers settle it, else the major does. */
function redirectArgs(rc: Rc, args: N[]): { url: N; code: N | null } | null {
	const [a, b] = args;
	if (!a) return null;
	if (num(a) !== null) return b ? { url: b, code: a } : null;
	if (!b) return { url: a, code: null };
	if (num(b) !== null || rc.major !== 4) return { url: a, code: b };
	return { url: b, code: a };
}

function setText(rc: Rc, { m, args }: Step): string | null {
	const { e, say } = rc;
	const r = say.reply;
	const [a, b, o] = args;
	switch (m) {
		case "code":
		case "status":
			return a ? r.setStatus({ status: statusText(rc, a) }) : null;
		case "header":
			return a && b ? r.setHeader({ name: codeText(e, a), value: e.text(b) }) : null;
		case "headers":
			return a ? r.setHeaders({ headers: e.text(a) }) : null;
		case "type":
			return a ? r.setType({ type: codeText(e, a) }) : null;
		case "setCookie":
			return a && b ? r.setCookie({ name: codeText(e, a), value: e.text(b), options: o ? details(rc, optionItems(rc, o)) : null }) : null;
		case "clearCookie":
			return a ? r.clearCookie({ name: codeText(e, a) }) : null;
		case "hijack":
			return r.hijack;
		default:
			return null;
	}
}

/** What a sending step replies with, as a noun. */
function sentDoc(rc: Rc, { m, args }: Step): Doc | null {
	const { e, say } = rc;
	const r = say.reply;
	const [a, b] = args;
	if (m === "send") {
		if (!a) return D(r.empty);
		const v = e.noun(a);
		return D(r.send({ body: v.t }), v.kids);
	}
	if (m === "view" && a) {
		const data = b ? e.noun(b) : null;
		return D(r.view({ view: codeText(e, a), data: data?.t ?? null }), data?.kids ?? []);
	}
	if (m === "sendFile" && a) return D(r.file({ path: e.text(a) }));
	if (m === "callNotFound") return D(r.notFound);
	if (m in SENSIBLE) {
		const code = SENSIBLE[m]!;
		const base = r.code({ code: mk("l", String(code)), name: r.statusNames[String(code)] ?? null });
		return D(a ? r.withStatus({ response: e.text(a), status: base }) : base);
	}
	return null;
}

/** A reply chain: what it sends (with any status set before it) and every action it takes. */
export function replyDoc(rc: Rc, node: N): { reply: Doc | null; actions: Doc } | null {
	const steps = replyChain(rc, node);
	if (!steps) return null;
	const { e, say } = rc;
	const last = steps.at(-1)!;
	const sends = REPLY_SENDS.includes(last.m);
	const status = steps.find((s) => s.m === "code" || s.m === "status")?.args[0];
	const actions: Doc[] = [];
	for (const s of sends ? steps.slice(0, -1) : steps) {
		if (sends && (s.m === "code" || s.m === "status")) continue;
		const t = setText(rc, s);
		if (!t) return null;
		actions.push(D(t));
	}
	let reply: Doc | null = null;
	if (sends && last.m === "redirect") {
		const r = redirectArgs(rc, last.args);
		if (!r) return null;
		const code = r.code ?? status;
		actions.push(D(say.reply.redirect({ url: e.text(r.url), status: code ? statusText(rc, code) : null })));
	} else if (sends) {
		const sent = sentDoc(rc, last);
		if (!sent) return null;
		reply = status ? D(say.reply.withStatus({ response: sent.t, status: statusText(rc, status) }), sent.kids) : sent;
		actions.push(D(say.reply.reply({ response: reply.t }), reply.kids));
	}
	return { reply, actions: listDoc(e, actions) };
}

/** Route-level hooks (`preHandler: [fastify.authenticate]`) as the "after …" list. */
function hookList(rc: Rc, o: N | null): Doc | null {
	const docs = HOOKS.flatMap((h) => {
		const v = unwrap(propOf(o, h));
		if (!v) return [];
		const items = v.type === "ArrayExpression" ? v.elements.filter(Boolean) : [v];
		return items.map((x: N) => (isFnNode(x) ? D("", bullets(rc.e, [D(rc.say.hooks.named[h], stepLines(rc, x))])) : rc.e.noun(x)));
	});
	const named = docs.filter((d: Doc) => d.t);
	const kids = docs.flatMap((d: Doc) => d.kids);
	return named.length ? D(listDoc(rc.e, named).t, kids) : kids.length ? D("", kids) : null;
}

/** The schema's checks and response shapes, plus any other route option, as bullet details. */
function routeDetails(rc: Rc, o: N | null, skip: string[]): Doc[] {
	const { e, say } = rc;
	const out: Doc[] = [];
	const schema = objectArg(propOf(o, "schema"));
	if (propOf(o, "schema") && !schema) out.push(D(say.routes.option({ name: e.prop("schema"), value: e.text(propOf(o, "schema")) })));
	for (const p of PARTS) {
		const v = propOf(schema, p);
		if (v) out.push(D(say.schema.check({ part: say.schema.parts[p], shape: shapeText(rc, v) })));
	}
	const resp = objectArg(propOf(schema, "response"));
	for (const p of resp?.properties ?? []) {
		const k = keyOf(p);
		if (!k) continue;
		const code = Number(k);
		const status = Number.isInteger(code) ? say.reply.code({ code: mk("l", k), name: say.reply.statusNames[k] ?? null }) : mk("l", k);
		out.push(D(say.schema.response({ status, shape: shapeText(rc, p.value) })));
	}
	for (const p of o?.properties ?? []) {
		const k = keyOf(p);
		if (!k || ["schema", "handler", "method", "url", "path", "errorHandler", ...HOOKS, ...skip].includes(k)) continue;
		out.push(D(say.routes.option({ name: e.prop(k), value: p.shorthand ? e.ref(k) : e.text(p.value) })));
	}
	const eh = propOf(o, "errorHandler");
	if (eh && isFnNode(eh)) out.push(D(say.routes.onError, stepLines(rc, eh)));
	return out;
}

function methodText(rc: Rc, n: N): string {
	const u = unwrap(n);
	const one = (x: N) => (str(x) !== null ? mk("l", str(x)!.toUpperCase()) : rc.e.text(x));
	if (u?.type === "ArrayExpression") return rc.say.routes.methods({ list: rc.e.g.list(u.elements.filter(Boolean).map(one), "or") });
	return one(u);
}

function routeDoc(rc: Rc, method: string, path: N, opts: N | null, handler: N | null): Doc | null {
	const { e, say } = rc;
	if (!handler) return null;
	const before = hookList(rc, opts);
	let inline: string | null = null;
	let lines: Line[] = [];
	if (isFnNode(handler)) {
		const f = unwrap(handler);
		const r = f.body.type !== "BlockStatement" ? (replyDoc(rc, f.body)?.reply ?? null) : null;
		if (r && !r.kids.length) inline = r.t;
		else if (f.body.type !== "BlockStatement" && unwrap(f.body).type !== "CallExpression" && unwrap(f.body).type !== "AwaitExpression") {
			const v = e.noun(f.body);
			if (!v.kids.length) inline = v.t;
			else lines = handlerLines(rc, f);
		} else lines = handlerLines(rc, f);
	} else {
		const v = e.noun(handler);
		inline = v.t;
		lines = v.kids;
	}
	const det = routeDetails(rc, opts, []);
	const title = say.routes.answer({ method, path: pathText(e, path), handler: inline, before: before?.t || null });
	return D(title, [...(before?.kids ?? []), ...bullets(e, det), ...lines]);
}

/** `fastify.get(path, [opts], handler)` and `fastify.route({ method, url, handler })`. */
function routeCall(rc: Rc, m: string, args: N[]): Doc | null {
	if (m === "route") {
		const o = objectArg(args[0]);
		const url = propOf(o, "url") ?? propOf(o, "path");
		const method = propOf(o, "method");
		if (!o || !url || !method) return null;
		return routeDoc(rc, methodText(rc, method), url, o, propOf(o, "handler"));
	}
	const [path, a, b] = args;
	if (!path || (str(path) === null && unwrap(path)?.type !== "TemplateLiteral" && unwrap(path)?.type !== "Identifier")) return null;
	const opts = objectArg(a);
	const handler = opts ? (b ?? propOf(opts, "handler")) : a;
	return routeDoc(rc, m === "all" ? mk("l", "any method") : mk("l", m.toUpperCase()), path, opts, handler ?? null);
}

function hookCall(rc: Rc, args: N[]): Doc | null {
	const { e, say } = rc;
	const name = str(args[0]) as Hook | null;
	const fn = args[1];
	if (!name || !HOOKS.includes(name) || !fn) return null;
	const when = say.hooks.when[name];
	if (isFnNode(fn)) return D(when, stepLines(rc, fn));
	const v = e.noun(fn);
	return D(say.hooks.run({ when, handler: v.t }), v.kids);
}

/** What `register` registers: a named official plugin, `@fastify/autoload`'s folder, or the expression. */
function pluginText(rc: Rc, n: N, opts: N | null): { text: string; skip: string[] } {
	const { e, say } = rc;
	const u = unwrap(n);
	const i = importOf(rc.facts, u) ?? (u?.type === "ImportExpression" && str(u.source) ? { from: str(u.source)!, name: "default" } : null);
	const p = i ? PLUGINS[i.from] : undefined;
	if (p === "autoload" && propOf(opts, "dir")) return { text: say.plugins.autoload({ dir: e.text(propOf(opts, "dir")) }), skip: ["dir"] };
	if (p) return { text: say.plugins.names[p], skip: [] };
	return { text: e.text(n), skip: [] };
}

function registerCall(rc: Rc, args: N[]): Doc | null {
	const { e, say } = rc;
	const [plugin, opts] = args;
	if (!plugin) return null;
	const o = objectArg(opts);
	const prefix = propOf(o, "prefix");
	const prefixText = prefix ? pathText(e, prefix) : null;
	if (isFnNode(plugin)) return D(say.plugins.registerInline({ prefix: prefixText }), stepLines(rc, plugin));
	const { text, skip } = pluginText(rc, plugin, o);
	const rest = o
		? optionItems(rc, { ...o, properties: o.properties.filter((p: N) => !["prefix", ...skip].includes(keyOf(p) ?? "")) })
		: opts
			? [e.text(opts)]
			: [];
	return D(say.plugins.register({ plugin: text, prefix: prefixText, details: details(rc, rest) }));
}

function decorateCall(rc: Rc, m: string, args: N[]): Doc | null {
	const { e, say } = rc;
	const [name, value] = args;
	if (!name || !value) return null;
	const n = codeText(e, name);
	const d = say.decorate;
	if (isFnNode(value)) {
		const head = m === "decorate" ? d.serverFn : m === "decorateRequest" ? d.requestFn : d.replyFn;
		return D(head({ name: n }), stepLines(rc, value));
	}
	const empty = unwrap(value)?.type === "Literal" && unwrap(value).value === null;
	if (empty && m !== "decorate") return D((m === "decorateRequest" ? d.requestEmpty : d.replyEmpty)({ name: n }));
	const v = e.noun(value);
	const phrase = m === "decorate" ? d.server : m === "decorateRequest" ? d.request : d.reply;
	return D(phrase({ name: n, value: v.t }), v.kids);
}

function listenCall(rc: Rc, server: N, args: N[]): Doc {
	const { e, say } = rc;
	const o = objectArg(args[0]);
	const port = o ? propOf(o, "port") : args.find((a) => !isFnNode(a) && str(a) === null && !objectArg(a));
	const host = o ? propOf(o, "host") : args.find((a) => str(a) !== null);
	const cb = args.find(isFnNode);
	const head = say.server.listen({ server: e.text(server), port: port ? e.text(port) : null, host: host ? codeText(e, host) : null });
	return D(head, cb ? bullets(e, [D(say.server.listening, stepLines(rc, cb))]) : []);
}

function injectCall(rc: Rc, args: N[]): Doc | null {
	const { e, say } = rc;
	const o = objectArg(args[0]);
	if (!o && args.length) return null;
	const method = propOf(o, "method");
	const url = propOf(o, "url") ?? propOf(o, "path");
	const rest = o ? optionItems(rc, { ...o, properties: o.properties.filter((p: N) => !["method", "url", "path"].includes(keyOf(p) ?? "")) }) : [];
	return D(say.server.inject({ method: method ? methodText(rc, method) : null, url: url ? pathText(e, url) : null, details: details(rc, rest) }));
}

/** A Fastify instance method call, or null when the receiver isn't one or the shape doesn't fit. */
export function serverCall(rc: Rc, m: string, obj: N | null, args: N[]): Doc | null {
	if (!obj || !isServer(rc.facts, obj)) return null;
	const { e, say } = rc;
	if (ROUTE_METHODS.includes(m) || m === "route") return routeCall(rc, m, args);
	switch (m) {
		case "addHook":
			return hookCall(rc, args);
		case "register":
			return registerCall(rc, args);
		case "decorate":
		case "decorateRequest":
		case "decorateReply":
			return decorateCall(rc, m, args);
		case "listen":
			return listenCall(rc, obj, args);
		case "inject":
			return injectCall(rc, args);
		case "ready":
			return args.length ? null : D(say.server.ready);
		case "close":
			return args.length ? null : D(say.server.close);
		case "setErrorHandler":
		case "setNotFoundHandler": {
			const fn = args.length > 1 ? args[1] : args[0];
			if (!fn) return null;
			const err = m === "setErrorHandler";
			const hooks = args.length > 1 ? hookList(rc, objectArg(args[0])) : null;
			if (hooks && isFnNode(fn)) return D(say.routes.notFoundAfter({ before: hooks.t }), [...hooks.kids, ...handlerLines(rc, fn)]);
			if (isFnNode(fn)) return D(err ? say.routes.onError : say.routes.notFound, handlerLines(rc, fn));
			const v = e.noun(fn);
			return D((err ? say.routes.onErrorWith : say.routes.notFoundWith)({ handler: v.t }), v.kids);
		}
		default:
			return null;
	}
}

/** `Fastify({ logger: true })` / `require("fastify")({ … })`. */
export function createDoc(rc: Rc, node: N): Doc | null {
	if (!createsServer(rc.facts, node)) return null;
	const { say } = rc;
	const o = objectArg(unwrap(node).arguments[0]);
	const logger = unwrap(propOf(o, "logger"));
	const items = [
		...(logger && !(logger.type === "Literal" && logger.value === false) ? [say.server.logger] : []),
		...(o ? optionItems(rc, { ...o, properties: o.properties.filter((p: N) => keyOf(p) !== "logger") }) : []),
	];
	return D(say.server.create({ details: details(rc, items) }));
}

/** `fp(async (fastify, opts) => …, { name })` from `fastify-plugin`. */
export function fpDoc(rc: Rc, node: N): Doc | null {
	const u = unwrap(node);
	if (u?.type !== "CallExpression" || importOf(rc.facts, u.callee)?.from !== "fastify-plugin") return null;
	const { e, say } = rc;
	const [fn, opts] = u.arguments;
	if (!fn) return null;
	const d = opts ? details(rc, optionItems(rc, opts)) : null;
	if (isFnNode(fn)) return D(say.plugins.shared({ details: d }), stepLines(rc, fn));
	return D(say.plugins.sharedFn({ fn: e.text(fn), details: d }));
}
