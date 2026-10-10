import { D, type Doc, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { importedAs, isFactoryCall, isNext, VALIDATORS } from "./facts";
import type { Builtin } from "./phrases";
import { type Ctx, details, fnLines, isFn, listDoc, msText, objectArg, optionItems, propOf, type Rule, statusText, targetText, typeArgs } from "./shared";

const BUILTINS: Builtin[] = [
	"cors",
	"logger",
	"jwt",
	"jwk",
	"bearerAuth",
	"basicAuth",
	"secureHeaders",
	"etag",
	"timing",
	"compress",
	"cache",
	"prettyJSON",
	"csrf",
	"requestId",
	"bodyLimit",
	"poweredBy",
	"trimTrailingSlash",
	"appendTrailingSlash",
	"serveStatic",
	"methodOverride",
	"contextStorage",
];

/** `cors({ origin })` -> "CORS (allowed origins: …)". */
function builtinDoc(c: Ctx, name: Builtin, args: N[]): Doc {
	const label = c.say.middleware.names[name];
	const opts = details(
		c,
		args.flatMap((a) => optionItems(c, a)),
	);
	return D(opts ? c.say.middleware.withOptions({ name: label, options: opts }) : label);
}

/** `createMiddleware(async (c, next) => …)`: "custom middleware" with its steps beneath. */
export function middlewareDoc(c: Ctx, fn: N): Doc | null {
	if (!fn) return null;
	if (isFn(fn)) return D(c.say.middleware.custom, fnLines(c.e, fn));
	const h = c.e.noun(fn);
	return D(c.say.middleware.customWith({ handler: h.t }), h.kids);
}

/** `zValidator("json", schema, hook?)` and `validator("form", (value, c) => …)`. */
function validatorDoc(c: Ctx, name: string, [target, second, hook]: N[]): Doc | null {
	const { e, say } = c;
	if (!target || !second) return null;
	const t = targetText(c, target);
	if (name === "validator") return isFn(second) ? D(say.validation.customCheck({ target: t }), fnLines(e, second)) : null;
	const schema = e.noun(second);
	const hookLines = hook && isFn(hook) ? e.bullet(D(say.validation.hook, fnLines(e, hook))) : [];
	return D(say.validation.check({ target: t, schema: schema.t }), [...schema.kids, ...hookLines]);
}

/** `new HTTPException(401, { message })`. */
function httpExceptionDoc(c: Ctx, [status, opts]: N[]): Doc {
	const msg = propOf(objectArg(opts), "message");
	const m = msg ? c.e.noun(msg) : null;
	return D(c.say.errors.http({ status: status ? statusText(c, status) : "", message: m?.t ?? null }), m?.kids ?? []);
}

/** Handlers and middleware listed before the last one: their names for a title, their steps as bullets. */
export function beforeDoc(c: Ctx, nodes: N[]): Doc | null {
	if (!nodes.length) return null;
	const docs = nodes.map((n) => (isFn(n) ? (middlewareDoc(c, n) as Doc) : c.e.noun(n)));
	const l = listDoc(
		c.e,
		docs.map((d) => D(d.t)),
	);
	return D(
		l.t,
		docs.filter((d) => d.kids.length).flatMap((d) => c.e.bullet(d)),
	);
}

/** `factory.createHandlers(logger(), (c) => …)`. */
function handlersDoc(c: Ctx, args: N[]): Doc | null {
	const last = args.at(-1);
	if (!last) return null;
	const before = beforeDoc(c, args.slice(0, -1));
	const body = isFn(last) ? fnLines(c.e, last) : c.e.bullet(c.e.noun(last));
	return D(c.say.factory.handlers({ before: before?.t ?? null }), [...(before?.kids ?? []), ...body]);
}

const imported =
	(name: string, f: (c: Ctx, args: N[]) => Doc | null): Rule =>
	(c, { node, args }) =>
		importedAs(c, node.callee) === name ? f(c, args) : null;

const factoryMethod =
	(method: string, f: (c: Ctx, args: N[]) => Doc | null): Rule =>
	(c, { node, args }) =>
		isFactoryCall(c, node, method) ? f(c, args) : null;

/** Built-in middleware, validators, `createMiddleware`, `next()`, `HTTPException` and the factory helpers. */
export function middlewareCalls(): Record<string, Rule> {
	const calls: Record<string, Rule> = {};
	for (const b of BUILTINS) calls[b] = imported(b, (c, args) => builtinDoc(c, b, args));
	for (const v of VALIDATORS) calls[v] = imported(v, (c, args) => validatorDoc(c, v, args));
	return {
		...calls,
		timeout: imported("timeout", (c, [ms]) => (ms ? D(c.say.middleware.timeout({ duration: msText(c, ms) })) : null)),
		createMiddleware: imported("createMiddleware", (c, [fn]) => middlewareDoc(c, fn)),
		next: (c, { node, args }) => (isNext(c, node.callee) && !args.length ? D(c.say.middleware.next) : null),
		"new HTTPException": imported("HTTPException", httpExceptionDoc),
		createFactory: (c, { node }) => {
			if (importedAs(c, node.callee) !== "createFactory") return null;
			const [env] = typeArgs(node);
			return D(c.say.factory.noun({ env: env ? mk("c", c.e.code(env)) : null }));
		},
		"*.createHandlers": factoryMethod("createHandlers", handlersDoc),
		"*.createMiddleware": factoryMethod("createMiddleware", (c, [fn]) => middlewareDoc(c, fn)),
	};
}

/** `...factory.createHandlers(a, b)` spread into a route: its handlers, inline. */
export function spreadHandlers(c: Ctx, args: N[]): N[] {
	return args.flatMap((a) => {
		const inner = a.type === "SpreadElement" ? unwrap(a.argument) : null;
		return inner?.type === "CallExpression" && isFactoryCall(c, inner, "createHandlers") ? inner.arguments : [a];
	});
}
