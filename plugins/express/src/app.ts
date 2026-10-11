import { D, type Doc, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { creates, isApp, ROUTE_METHODS, SOURCES } from "./facts";
import { responseDoc } from "./http";
import type { Builtin } from "./phrases";
import { bullets, type Ctx, codeText, details, fnLines, isFnNode, isPath, listDoc, objectArg, optionItems, pathText, propOf, str } from "./shared";

const EXPRESS_BUILTINS: Builtin[] = ["json", "urlencoded", "raw", "text", "static"];

/** `express.json()`, `cors({ origin })`, `morgan("dev")`: a named middleware, or null. */
export function builtinDoc(c: Ctx, node: N): Doc | null {
	const u = unwrap(node);
	if (u?.type !== "CallExpression") return null;
	const { e, say } = c;
	const callee = unwrap(u.callee);
	let name: Builtin | null = null;
	if (callee?.type === "MemberExpression" && !callee.computed && EXPRESS_BUILTINS.includes(callee.property.name)) {
		const obj = unwrap(callee.object);
		const i = obj?.type === "Identifier" ? c.facts.imports.get(obj.name) : undefined;
		if ((i?.from === "express" && (i.name === "default" || i.name === "*")) || (i?.from === "body-parser" && callee.property.name !== "static"))
			name = callee.property.name;
	} else if (callee?.type === "Identifier") {
		const i = c.facts.imports.get(callee.name);
		const src = i ? SOURCES[i.from] : undefined;
		if (src && (src.name === i!.name || (src.name === "default" && i!.name === "*"))) name = src.builtin;
		else if (i?.from === "express" && EXPRESS_BUILTINS.includes(i.name as Builtin)) name = i.name as Builtin;
	}
	if (!name) return null;
	const [a, b] = u.arguments;
	if (name === "static" && a) {
		const t = say.middleware.staticFrom({ root: codeText(e, a) });
		const d = b ? details(c, optionItems(c, b)) : null;
		return D(d ? say.middleware.withOptions({ name: t, options: d }) : t);
	}
	if (name === "morgan" && str(a) !== null) return D(say.middleware.logFormat({ format: codeText(e, a) }));
	const d = a ? details(c, optionItems(c, a)) : null;
	const label = say.middleware.names[name];
	return D(d ? say.middleware.withOptions({ name: label, options: d }) : label);
}

/** A middleware or handler in a list: a named builtin, a spread, or the expression itself. */
function middlewareDoc(c: Ctx, n: N): Doc {
	const u = unwrap(n);
	if (u?.type === "SpreadElement") {
		const v = c.e.noun(u.argument);
		return D(c.say.routes.everythingIn({ value: v.t }), v.kids);
	}
	if (u?.type === "ArrayExpression")
		return listDoc(
			c.e,
			u.elements.filter(Boolean).map((x: N) => middlewareDoc(c, x)),
		);
	return builtinDoc(c, u) ?? c.e.noun(u);
}

/** A handler that is one short reply reads inline ("with … as JSON"); anything else keeps its steps. */
function handlerDoc(c: Ctx, n: N): { inline: string | null; lines: Doc["kids"] } {
	const u = unwrap(n);
	if (!isFnNode(u)) {
		const v = middlewareDoc(c, u);
		return { inline: v.t, lines: v.kids };
	}
	if (u.body.type !== "BlockStatement") {
		const r = responseDoc(c, u.body);
		if (r?.reply && r.actions.t === c.say.response.reply({ response: r.reply.t }) && !r.reply.kids.length) return { inline: r.reply.t, lines: [] };
	}
	return { inline: null, lines: fnLines(c.e, u) };
}

/** `(err, req, res, next) => …`: Express recognises error handlers by their four parameters. */
const isErrorHandler = (n: N) => isFnNode(n) && unwrap(n).params.length === 4;

/** One route on a path (`path` is null inside `app.route(path)`). */
function routeDoc(c: Ctx, method: string, path: string | null, handlers: N[]): Doc | null {
	const last = handlers.at(-1);
	if (!last) return null;
	const before = handlers.slice(0, -1).map((h) => middlewareDoc(c, h));
	const b = before.length ? listDoc(c.e, before) : null;
	const h = handlerDoc(c, last);
	const m = method === "all" ? null : mk("l", (method === "del" ? "delete" : method).toUpperCase());
	return D(c.say.routes.answer({ method: m, path, handler: h.inline, before: b?.t ?? null }), [...(b?.kids ?? []), ...h.lines]);
}

/** A router passed to `use`: created or named like one (`apiRouter`, `userRoutes`). */
const isRouter = (c: Ctx, n: N) => {
	const u = unwrap(n);
	return (u?.type === "Identifier" && (isApp(c.facts, u) || /routes?$/i.test(u.name))) || creates(c.facts, u) !== null;
};

/** `app.use(path?, ...middleware)`. */
function useDoc(c: Ctx, args: N[]): Doc | null {
	const { e, say } = c;
	const path = args[0] && isPath(args[0]) ? pathText(e, args[0]) : null;
	const mws = path ? args.slice(1) : args;
	if (!mws.length) return null;
	const only = mws.length === 1 ? unwrap(mws[0]) : null;
	if (only && isErrorHandler(only)) return D(say.routes.onError({ path }), fnLines(e, only));
	if (only && isFnNode(only)) return D(say.routes.useInline({ path }), fnLines(e, only));
	if (path && only && isRouter(c, only)) return D(say.routes.mount({ router: e.text(only), path }));
	const list = listDoc(
		e,
		mws.map((m) => middlewareDoc(c, m)),
	);
	return D(say.routes.use({ middleware: list.t, path }), list.kids);
}

/** `app.listen(port, host?, cb?)`. */
function listenDoc(c: Ctx, app: N, args: N[]): Doc {
	const { e, say } = c;
	const fns = args.filter(isFnNode);
	const vals = args.filter((a) => !isFnNode(a));
	const [port, host] = vals;
	const head = say.server.listen({ app: e.text(app), port: port ? e.text(port) : null, host: host && str(host) !== null ? codeText(e, host) : null });
	return D(head, fns[0] ? bullets(e, [D(say.server.listening, fnLines(e, fns[0]))]) : []);
}

/** `app.route("/book").get(…).post(…)`: one heading for the path, a bullet per method. */
function routeChainDoc(c: Ctx, node: N): Doc | null {
	const steps: { m: string; args: N[] }[] = [];
	let cur = unwrap(node);
	while (cur?.type === "CallExpression" && unwrap(cur.callee)?.type === "MemberExpression") {
		const callee = unwrap(cur.callee);
		steps.unshift({ m: callee.property.name, args: cur.arguments });
		cur = unwrap(callee.object);
	}
	if (!isApp(c.facts, cur) || steps[0]?.m !== "route" || !steps[0].args[0] || steps.length < 2) return null;
	const docs = steps.slice(1).map((s) => (ROUTE_METHODS.includes(s.m) ? routeDoc(c, s.m, null, s.args) : s.m === "use" ? useDoc(c, s.args) : null));
	if (docs.some((d) => !d)) return null;
	return D(c.say.routes.forPath({ path: pathText(c.e, steps[0].args[0]) }), bullets(c.e, docs as Doc[]));
}

/** An app or router method call, or null when the receiver isn't one or the shape doesn't fit. */
export function appCall(c: Ctx, m: string, node: N, obj: N | null, args: N[]): Doc | null {
	if (!obj) return null;
	const chained = routeChainDoc(c, node);
	if (chained) return chained;
	if (!isApp(c.facts, obj)) return null;
	const { e, say } = c;
	const [a, b] = args;
	if (ROUTE_METHODS.includes(m)) {
		if (m === "get" && args.length === 1 && str(a) !== null) return D(say.settings.get({ name: codeText(e, a) }));
		if (!a || !isPath(a) || args.length < 2) return null;
		return routeDoc(c, m, pathText(e, a), args.slice(1));
	}
	switch (m) {
		case "use":
			return useDoc(c, args);
		case "listen":
			return listenDoc(c, obj, args);
		case "set":
			return a && b && str(a) !== null ? D(say.settings.set({ name: codeText(e, a), value: e.text(b) })) : null;
		case "enable":
			return a && str(a) !== null ? D(say.settings.enable({ name: codeText(e, a) })) : null;
		case "disable":
			return a && str(a) !== null ? D(say.settings.disable({ name: codeText(e, a) })) : null;
		case "engine":
			return a && b ? D(say.settings.engine({ ext: codeText(e, a), engine: e.text(b) })) : null;
		case "param":
			if (!a || !b || !isFnNode(b)) return null;
			return D(say.routes.param({ name: codeText(e, a) }), fnLines(e, b));
		default:
			return null;
	}
}

/** `express()` and `express.Router(options)`. */
export function createDoc(c: Ctx, node: N): Doc | null {
	const kind = creates(c.facts, node);
	if (!kind) return null;
	if (kind === "app") return D(c.say.app.noun);
	const o = objectArg(unwrap(node).arguments[0]);
	const flags = [
		...(propOf(o, "mergeParams") ? [c.say.app.mergeParams] : []),
		...(propOf(o, "caseSensitive") ? [c.say.app.caseSensitive] : []),
		...(propOf(o, "strict") ? [c.say.app.strict] : []),
	];
	return D(c.say.app.router({ details: details(c, flags) }));
}
