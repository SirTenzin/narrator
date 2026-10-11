import { D, type Doc, mk } from "@usenarrator/core";
import type { N } from "@usenarrator/lang-ts";
import { unwrap } from "@usenarrator/lang-ts";
import { statusName } from "./hooks";
import { type Ctx, findProp, importsElysia, literal, objectArg, usesPlugin } from "./shared";

/** Elysia's `StatusMap` names (`status("Not Found")`) by code; these are source values, not prose. */
const STATUS_CODES: Record<string, number> = {
	Continue: 100,
	"Switching Protocols": 101,
	OK: 200,
	Created: 201,
	Accepted: 202,
	"No Content": 204,
	"Partial Content": 206,
	"Moved Permanently": 301,
	Found: 302,
	"See Other": 303,
	"Not Modified": 304,
	"Temporary Redirect": 307,
	"Permanent Redirect": 308,
	"Bad Request": 400,
	Unauthorized: 401,
	"Payment Required": 402,
	Forbidden: 403,
	"Not Found": 404,
	"Method Not Allowed": 405,
	"Not Acceptable": 406,
	"Request Timeout": 408,
	Conflict: 409,
	Gone: 410,
	"Length Required": 411,
	"Precondition Failed": 412,
	"Payload Too Large": 413,
	"Unsupported Media Type": 415,
	"I'm a teapot": 418,
	"Unprocessable Content": 422,
	Locked: 423,
	"Too Early": 425,
	"Precondition Required": 428,
	"Too Many Requests": 429,
	"Unavailable For Legal Reasons": 451,
	"Internal Server Error": 500,
	"Not Implemented": 501,
	"Bad Gateway": 502,
	"Service Unavailable": 503,
	"Gateway Timeout": 504,
};

/** A status argument (`404` or `"Not Found"`) as "404 (Not Found)", or null when it isn't one. */
function statusOf(c: Ctx, n: N): string | null {
	const v = literal(n);
	if (typeof v === "number" && Number.isInteger(v) && v >= 100 && v < 600) return statusName(c, v);
	if (typeof v === "string" && STATUS_CODES[v]) return statusName(c, STATUS_CODES[v]);
	return null;
}

/** `status(404, "Not found")` (1.3+) / `error(404, …)` (1.0–1.3): only with a real status, in a file importing Elysia. */
export function statusCall(c: Ctx, args: N[]): Doc | null {
	if (!importsElysia(c)) return null;
	const status = statusOf(c, args[0]);
	if (!status) return null;
	const r = c.say.responses;
	if (!args[1]) return D(r.statusValue({ status }));
	const v = c.e.noun(args[1]);
	return D(r.statusWith({ status, value: v.t }), v.kids);
}

/** Elysia 2 `problem(418, { detail })`. */
export function problemCall(c: Ctx, args: N[]): Doc | null {
	if (!importsElysia(c)) return null;
	const status = statusOf(c, args[0]);
	if (!status) return null;
	const detail = findProp(objectArg(args[1]), "detail");
	if (!detail) return D(c.say.responses.problem({ status }));
	const v = c.e.noun(detail.value);
	return D(c.say.responses.problemWith({ status, detail: v.t }), v.kids);
}

/** `redirect(url)` / `redirect(url, 301)` from the handler context. */
export function redirectCall(c: Ctx, args: N[]): Doc | null {
	if (!importsElysia(c) || !args[0]) return null;
	const url = c.e.text(args[0]);
	const status = args[1] ? statusOf(c, args[1]) : null;
	return D(status ? c.say.responses.redirectWith({ url, status }) : c.say.responses.redirect({ url }));
}

/** `jwt.sign(payload)` / `jwt.verify(token)` on the JWT plugin's context name. */
export function jwtCall(c: Ctx, { obj, args, verify }: { obj: N | null; args: N[]; verify: boolean }): Doc | null {
	const o = unwrap(obj);
	if (o?.type !== "Identifier" || !c.state.jwtNames.has(o.name) || !usesPlugin(c, "jwt")) return null;
	const v = c.e.noun(args[0]);
	return D(verify ? c.say.responses.jwtVerify({ token: v.t }) : c.say.responses.jwtSign({ payload: v.t }), v.kids);
}

const isSetMember = (n: N, prop: string) => {
	const u = unwrap(n);
	return (
		u?.type === "MemberExpression" && !u.computed && u.property.name === prop && unwrap(u.object)?.type === "Identifier" && unwrap(u.object).name === "set"
	);
};

/** `set.status = 201`, `set.headers["x-id"] = id`, `set.redirect = url` as one action; null when it isn't one. */
export function setAssignment(c: Ctx, ex: N): Doc | null {
	const u = unwrap(ex);
	if (u?.type !== "AssignmentExpression" || u.operator !== "=" || !importsElysia(c)) return null;
	const { e, say } = c;
	const r = say.responses;
	if (isSetMember(u.left, "status")) {
		const status = statusOf(c, u.right);
		return D(r.setStatus({ status: status ?? e.text(u.right) }));
	}
	if (isSetMember(u.left, "redirect")) return D(r.setRedirect({ url: e.text(u.right) }));
	const l = unwrap(u.left);
	if (l?.type === "MemberExpression" && isSetMember(l.object, "headers")) {
		const name = l.computed ? e.text(l.property) : mk("l", `"${l.property.name}"`);
		return D(r.setHeader({ name, value: e.text(u.right) }));
	}
	return null;
}
