import { D, type Doc, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { isNext, isReq, isRes, rootOf } from "./facts";
import { type Ctx, codeText, details, num, optionItems, statusText, str } from "./shared";

/** Response methods that send the reply and end the request. */
const SENDS = ["json", "send", "sendStatus", "render", "redirect", "end", "sendFile", "download", "jsonp"];
/** Response methods that only prepare it. */
const SETS = ["status", "set", "header", "append", "cookie", "clearCookie", "type", "contentType", "location", "attachment", "vary", "links"];
export const RESPONSE_METHODS = [...SENDS, ...SETS];

type Step = { m: string; args: N[] };

/** `res.status(201).json(x)` -> its steps from `res`, or null when it isn't a response chain. */
function chainOf(c: Ctx, node: N): Step[] | null {
	const steps: Step[] = [];
	let cur = unwrap(node);
	while (cur?.type === "CallExpression") {
		const callee = unwrap(cur.callee);
		if (callee?.type !== "MemberExpression" || callee.computed || !RESPONSE_METHODS.includes(callee.property.name)) return null;
		steps.unshift({ m: callee.property.name, args: cur.arguments });
		cur = unwrap(callee.object);
	}
	return steps.length && isRes(c.facts, cur) ? steps : null;
}

/** What a sending step replies with, as a noun ("… as JSON"), or null for `res.end()` and redirects. */
function sentDoc(c: Ctx, { m, args }: Step): Doc | null {
	const { e, say } = c;
	const r = say.response;
	const [a, b] = args;
	const val = (pick: (v: string) => string) => {
		if (!a) return D(r.empty);
		const v = e.noun(a);
		return D(pick(v.t), v.kids);
	};
	switch (m) {
		case "json":
			return a ? val((data) => r.json({ data })) : D(r.empty);
		case "jsonp":
			return val((data) => r.jsonp({ data }));
		case "send":
			return val((body) => r.send({ body }));
		case "end":
			return a ? val((body) => r.send({ body })) : null;
		case "sendStatus":
			return a ? D(r.statusOnly({ status: statusText(c, a) })) : null;
		case "render": {
			if (!a) return null;
			const locals = b && unwrap(b).type !== "ArrowFunctionExpression" && unwrap(b).type !== "FunctionExpression" ? e.noun(b) : null;
			return D(r.render({ view: codeText(e, a), locals: locals?.t ?? null }), locals?.kids ?? []);
		}
		case "sendFile":
			return a ? D(r.file({ path: e.text(a) })) : null;
		case "download":
			return a ? D(r.download({ path: e.text(a) })) : null;
		default:
			return null;
	}
}

/** One preparing step as an action ("set the X header to …"), or null for ones the plugin doesn't word. */
function setDoc(c: Ctx, { m, args }: Step): string | null {
	const { e, say } = c;
	const r = say.response;
	const [a, b, opts] = args;
	switch (m) {
		case "status":
			return a ? r.setStatus({ status: statusText(c, a) }) : null;
		case "set":
		case "header":
			if (!a) return null;
			if (!b) return r.setHeaders({ headers: e.text(a) });
			return r.setHeader({ name: codeText(e, a), value: e.text(b) });
		case "append":
			return a && b ? r.appendHeader({ name: codeText(e, a), value: e.text(b) }) : null;
		case "type":
		case "contentType":
			return a ? r.setType({ type: codeText(e, a) }) : null;
		case "location":
			return a ? r.setHeader({ name: mk("c", "Location"), value: e.text(a) }) : null;
		case "cookie":
			return a && b ? r.setCookie({ name: codeText(e, a), value: e.text(b), options: opts ? details(c, optionItems(c, opts)) : null }) : null;
		case "clearCookie":
			return a ? r.clearCookie({ name: codeText(e, a) }) : null;
		default:
			return null;
	}
}

/** A response chain: the reply it sends (with any status set before it) and the actions it takes. */
export function responseDoc(c: Ctx, node: N): { reply: Doc | null; actions: Doc } | null {
	const steps = chainOf(c, node);
	if (!steps) return null;
	const { e, say } = c;
	const last = steps.at(-1)!;
	const status = steps.find((s) => s.m === "status")?.args[0];
	const actions: Doc[] = [];
	let reply: Doc | null = null;
	for (const s of steps.slice(0, -1)) {
		if (s.m === "status" && SENDS.includes(last.m)) continue;
		const t = setDoc(c, s);
		if (!t) return null;
		actions.push(D(t));
	}
	if (SENDS.includes(last.m)) {
		if (last.m === "redirect") {
			const [a, b] = last.args;
			const url = num(a) !== null ? b : a;
			const code = num(a) !== null ? a : b && num(b) !== null ? b : status;
			if (!url) return null;
			actions.push(D(say.response.redirect({ url: e.text(url), status: code ? statusText(c, code) : null })));
		} else {
			const sent = sentDoc(c, last);
			if (sent) reply = status ? D(say.response.withStatus({ response: sent.t, status: statusText(c, status) }), sent.kids) : sent;
			else if (last.m === "end") actions.push(D(status ? say.response.setStatus({ status: statusText(c, status) }) : say.response.end));
			else return null;
			if (reply) actions.push(D(say.response.reply({ response: reply.t }), reply.kids));
		}
	} else {
		const t = setDoc(c, last);
		if (!t) return null;
		actions.push(D(t));
	}
	const all = D(
		e.g.list(actions.map((a) => a.t)),
		actions.flatMap((a) => a.kids),
	);
	return { reply, actions: all };
}

/** `next()`, `next(err)` and `next("route")`. */
export function nextDoc(c: Ctx, node: N): Doc | null {
	const u = unwrap(node);
	if (u?.type !== "CallExpression" || !isNext(c.facts, u.callee)) return null;
	const [a] = u.arguments;
	if (!a) return D(c.say.next.next);
	if (str(a) === "route") return D(c.say.next.skipRoute);
	const v = c.e.noun(a);
	return D(c.say.next.fail({ error: v.t }), v.kids);
}

const REQUEST_MEMBERS = [
	"params",
	"query",
	"body",
	"headers",
	"cookies",
	"signedCookies",
	"ip",
	"path",
	"method",
	"url",
	"originalUrl",
	"hostname",
	"protocol",
] as const;
type RequestMember = (typeof REQUEST_MEMBERS)[number];

/** `req.body`, `req.params`, …; null when the object isn't a request. */
export function requestMembers(): Record<string, (c: Ctx, obj: N) => Doc | null> {
	const out: Record<string, (c: Ctx, obj: N) => Doc | null> = {};
	for (const m of REQUEST_MEMBERS) out[m] = (c, obj) => (isReq(c.facts, obj) ? D(c.say.request[m as RequestMember]) : null);
	return out;
}

/** `req.get("Content-Type")` / `req.header(…)`, `req.accepts(…)`. */
export function requestCall(c: Ctx, m: string, obj: N | null, args: N[]): Doc | null {
	if (!obj || !isReq(c.facts, obj) || !args[0]) return null;
	if (m === "get" || m === "header") return D(c.say.request.header({ name: codeText(c.e, args[0]) }));
	if (m === "accepts")
		return D(
			c.say.request.accepts({
				types: c.e.g.list(
					args.map((a) => codeText(c.e, a)),
					"or",
				),
			}),
		);
	return null;
}

/** `req.is("json")` as a condition. */
export function requestIs(c: Ctx, obj: N | null, args: N[], neg: boolean): Doc | null {
	if (!obj || !isReq(c.facts, obj) || !args[0]) return null;
	return D(c.say.request.is({ type: codeText(c.e, args[0]), neg }));
}

export { rootOf };
