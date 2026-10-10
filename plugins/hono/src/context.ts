import { D, type Doc, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { importedAs, isContext, isRequest } from "./facts";
import { type Ctx, details, isFn, keyOf, objectArg, optionItems, propOf, type Rule, statusText, str, targetText } from "./shared";

/** A header, parameter or variable name: literals in full as code, anything else as its noun. */
export const nameText = ({ e }: Ctx, n: N): string => {
	const s = str(n);
	return s === null ? e.text(n) : mk("c", s);
};

function headerList(c: Ctx, n: N): string {
	const o = objectArg(n);
	if (!o) return c.e.text(n);
	return c.e.g.list(
		o.properties.map((p: N) => {
			const k = keyOf(p);
			return k === null ? c.e.text(p) : c.say.common.option({ name: mk("c", k), value: c.e.text(p.value) });
		}),
	);
}

/** Status and headers after a response's body: `(201, { … })` or a `{ status, headers }` init object. */
function withExtras(c: Ctx, base: Doc, extra: N[]): Doc {
	const [second, third] = extra;
	const init = objectArg(second);
	const isInit = init && (propOf(init, "status") || propOf(init, "headers"));
	const status = isInit ? propOf(init, "status") : second;
	const headers = isInit ? propOf(init, "headers") : third;
	const items = [
		...(status ? [c.say.response.status({ status: statusText(c, status) })] : []),
		...(headers ? [c.say.response.headers({ headers: headerList(c, headers) })] : []),
	];
	const d = details(c, items);
	return d ? D(c.say.response.withDetails({ response: base.t, details: d }), base.kids) : base;
}

const isNullish = (n: N) => {
	const u = unwrap(n);
	return !u || (u.type === "Literal" && u.value === null) || (u.type === "Identifier" && u.name === "undefined");
};

/** `c.json(…)`, `c.text(…)`, `c.redirect(…)` and friends as the response they build, or null. */
export function responseDoc(c: Ctx, call: N): Doc | null {
	const u = unwrap(call);
	if (u?.type !== "CallExpression") return null;
	const callee = unwrap(u.callee);
	if (callee?.type !== "MemberExpression" || callee.computed || !isContext(c, callee.object)) return null;
	const r = c.say.response;
	const [first, ...rest] = u.arguments;
	const val = (pick: (v: string) => string) => {
		if (!first) return null;
		const v = c.e.noun(first);
		return withExtras(c, D(pick(v.t), v.kids), rest);
	};
	switch (callee.property.name) {
		case "json":
			return val((data) => r.json({ data }));
		case "text":
			return val((text) => r.text({ text }));
		case "html":
			return val((html) => r.html({ html }));
		case "body":
		case "newResponse":
			return isNullish(first) ? withExtras(c, D(r.emptyBody), rest) : val((body) => r.body({ body }));
		case "redirect":
			return val((url) => r.redirect({ url }));
		case "render":
			return val((content) => r.render({ content }));
		case "notFound":
			return u.arguments.length ? null : D(r.notFound);
		default:
			return null;
	}
}

const REQUEST: Record<string, (c: Ctx, args: N[]) => Doc> = {
	param: (c, [name]) => D(name ? c.say.request.param({ name: nameText(c, name) }) : c.say.request.params),
	query: (c, [name]) => D(name ? c.say.request.query({ name: nameText(c, name) }) : c.say.request.queries),
	queries: (c, [name]) => D(name ? c.say.request.queryValues({ name: nameText(c, name) }) : c.say.request.allQueryValues),
	header: (c, [name]) => D(name ? c.say.request.header({ name: nameText(c, name) }) : c.say.request.headers),
	json: (c) => D(c.say.request.json),
	text: (c) => D(c.say.request.text),
	formData: (c) => D(c.say.request.formData),
	parseBody: (c) => D(c.say.request.parseBody),
	arrayBuffer: (c) => D(c.say.request.arrayBuffer),
	blob: (c) => D(c.say.request.blob),
	valid: (c, [target]) => D(c.say.request.valid({ target: targetText(c, target) })),
};

/** `c.header(name, value, { append })`; an undefined value removes the header. */
function headerDoc(c: Ctx, [name, value, opts]: N[]): Doc | null {
	if (!name || !value) return null;
	const n = nameText(c, name);
	if (isNullish(value)) return D(c.say.response.removeHeader({ name: n }));
	const v = c.e.noun(value);
	const append = unwrap(propOf(objectArg(opts), "append"))?.value === true;
	return D((append ? c.say.response.appendHeader : c.say.response.setHeader)({ name: n, value: v.t }), v.kids);
}

const onContext =
	(f: (c: Ctx, args: N[]) => Doc | null): Rule =>
	(c, { obj, args }) =>
		obj && isContext(c, obj) ? f(c, args) : null;

const response: Rule = (c, { node }) => responseDoc(c, node);

/** `getCookie(c, "name")`, `setCookie(c, "name", value, { … })` and the signed variants from `hono/cookie`. */
function cookieDoc(c: Ctx, fn: string, args: N[]): Doc | null {
	const k = c.say.cookies;
	const withOpts = (base: Doc, opts: N) => {
		const d = opts ? details(c, optionItems(c, opts)) : null;
		return d ? D(c.say.response.withDetails({ response: base.t, details: d }), base.kids) : base;
	};
	const set = (pick: typeof k.set, name: N, value: N, opts: N) => {
		const v = c.e.noun(value);
		return withOpts(D(pick({ name: nameText(c, name), value: v.t }), v.kids), opts);
	};
	switch (fn) {
		case "getCookie":
			return D(args[1] ? k.get({ name: nameText(c, args[1]) }) : k.all);
		case "getSignedCookie":
			return D(args[2] ? k.getSigned({ name: nameText(c, args[2]) }) : k.allSigned);
		case "setCookie":
			return args[2] ? set(k.set, args[1], args[2], args[3]) : null;
		case "setSignedCookie":
			return args[2] ? set(k.setSigned, args[1], args[2], args[4]) : null;
		case "deleteCookie":
			return args[1] ? withOpts(D(k.delete({ name: nameText(c, args[1]) })), args[2]) : null;
		default:
			return null;
	}
}

const COOKIE_FNS = ["getCookie", "getSignedCookie", "setCookie", "setSignedCookie", "deleteCookie"];

const cookie =
	(fn: string): Rule =>
	(c, { node, args }) =>
		importedAs(c, node.callee) === fn && isContext(c, args[0]) ? cookieDoc(c, fn, args) : null;

/** Rules for the request (`c.req.*`), the response and context (`c.*`), cookies and `env(c)`. */
export function contextCalls(): Record<string, Rule> {
	const calls: Record<string, Rule> = {};
	for (const [m, f] of Object.entries(REQUEST)) calls[`*.req.${m}`] = (c, { obj, args }) => (obj && isRequest(c, obj) ? f(c, args) : null);
	for (const m of ["json", "text", "html", "body", "newResponse", "redirect", "render", "notFound"]) calls[`*.${m}`] = response;
	for (const fn of COOKIE_FNS) calls[fn] = cookie(fn);
	return {
		...calls,
		"*.status": onContext((c, [code]) => (code ? D(c.say.response.setStatus({ status: statusText(c, code) })) : null)),
		"*.header": onContext(headerDoc),
		"*.set": onContext((c, [name, value]) => {
			if (!name || !value) return null;
			const v = c.e.noun(value);
			return D(c.say.context.set({ name: nameText(c, name), value: v.t }), v.kids);
		}),
		"*.get": onContext((c, [name]) => (name ? D(c.say.context.get({ name: nameText(c, name) })) : null)),
		env: (c, { node, args }) => (importedAs(c, node.callee) === "env" && isContext(c, args[0]) ? D(c.say.context.env) : null),
		"*.executionCtx.waitUntil": (c, { obj, args }) => {
			const o = unwrap(obj);
			if (o?.type !== "MemberExpression" || !isContext(c, o.object) || !args[0] || isFn(args[0])) return null;
			const t = c.e.noun(args[0]);
			return D(c.say.context.waitUntil({ task: t.t }), t.kids);
		},
	};
}
