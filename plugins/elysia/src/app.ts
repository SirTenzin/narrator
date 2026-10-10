import { D, type Doc, type Line, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { hookDocs, hookItems, scopeOf } from "./hooks";
import type { HookScope, LifecycleEvent } from "./phrases";
import { pluginDoc } from "./plugins";
import { schemaText } from "./schema";
import {
	bullets,
	type Ctx,
	callbackDoc,
	chainOf,
	findProp,
	fnBody,
	fnResult,
	isElysiaModule,
	isFn,
	keyOf,
	methodText,
	objectArg,
	optionDoc,
	type Step,
	stringLit,
} from "./shared";

export const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "all"];

/** Elysia 1 registers lifecycle hooks with an `on` prefix; Elysia 2 drops it. */
const LIFECYCLE_V1: Record<string, LifecycleEvent> = {
	onRequest: "request",
	onParse: "parse",
	onTransform: "transform",
	onBeforeHandle: "beforeHandle",
	onAfterHandle: "afterHandle",
	onError: "error",
	onAfterResponse: "afterResponse",
	onResponse: "afterResponse",
	onStart: "start",
	onStop: "stop",
	mapResponse: "mapResponse",
	trace: "trace",
};
const LIFECYCLE_V2: Record<string, LifecycleEvent> = {
	request: "request",
	parse: "parse",
	transform: "transform",
	beforeHandle: "beforeHandle",
	afterHandle: "afterHandle",
	mapResponse: "mapResponse",
	afterResponse: "afterResponse",
	setup: "start",
	cleanup: "stop",
	trace: "trace",
};

export const lifecycleNames = (c: Pick<Ctx, "version">): Record<string, LifecycleEvent> => ({
	...(c.version !== 2 ? LIFECYCLE_V1 : {}),
	...(c.version !== 1 ? LIFECYCLE_V2 : {}),
});

export const INSTANCE_METHODS = [
	...HTTP_METHODS,
	"route",
	"ws",
	"mount",
	"use",
	"group",
	"guard",
	"state",
	"decorate",
	"derive",
	"resolve",
	"macro",
	"model",
	"error",
	"headers",
	"as",
	"listen",
	"handle",
	"fetch",
	"stop",
	"compile",
	...Object.keys(LIFECYCLE_V1),
	...Object.keys(LIFECYCLE_V2),
];

/** Group callbacks name their app parameter; while rendering one, that name is an Elysia app too. */
function withApp<T>(c: Ctx, name: string | null, f: () => T): T {
	if (!name || c.state.apps.has(name)) return f();
	c.state.apps.add(name);
	try {
		return f();
	} finally {
		c.state.apps.delete(name);
	}
}

/** `new Elysia(...)` with `Elysia` from the `elysia` package (or not imported from anywhere else). */
export function isNewElysia(c: Ctx, n: N): boolean {
	const u = unwrap(n);
	if (u?.type !== "NewExpression" || unwrap(u.callee)?.type !== "Identifier" || unwrap(u.callee).name !== "Elysia") return false;
	const from = c.state.imports.get("Elysia");
	return !from || isElysiaModule(from);
}

export const isApp = (c: Ctx, n: N) => {
	const u = unwrap(n);
	return isNewElysia(c, u) || (u?.type === "Identifier" && c.state.apps.has(u.name));
};

/** `new Elysia({ prefix, name })` as "a web server (Elysia) (every path starts with …)". */
export function serverDoc(c: Ctx, node: N): Doc {
	const { e, say } = c;
	const opts = objectArg(unwrap(node).arguments?.[0]);
	const traits = (opts?.properties ?? []).map((p: N) => {
		const key = keyOf(p);
		if (key === "prefix") return say.app.prefix({ prefix: e.text(p.value) });
		if (key === "name") return say.app.name({ name: e.text(p.value) });
		return optionDoc({ e, prop: p, phrase: say.app.option }).t;
	});
	return D(say.app.server({ traits }));
}

/** An Elysia chain (`new Elysia().get(...).listen(3000)` or `app.get(...)`), or null when the root isn't an Elysia app. */
export function appChainDoc(c: Ctx, node: N): Doc | null {
	const { e, say } = c;
	const { root, steps } = chainOf(node);
	if (isNewElysia(c, root)) {
		const head = serverDoc(c, root);
		return D(
			head.t,
			bullets(
				e,
				steps.flatMap((s) => stepDocs(c, s)),
			),
		);
	}
	if (unwrap(root)?.type !== "Identifier" || !c.state.apps.has(unwrap(root).name) || !steps.length) return null;
	const app = e.text(root);
	const only = steps.length === 1 ? steps[0]! : null;
	if (only && (only.m === "handle" || only.m === "fetch") && only.args[0]) return D(say.app.handle({ app, request: e.text(only.args[0]) }));
	const docs = steps.flatMap((s) => stepDocs(c, s));
	if (docs.length === 1 && !docs[0]!.kids.length) return D(say.app.stepOnApp({ app, step: docs[0]!.t }));
	return D(say.app.onApp({ app }), bullets(e, docs));
}

/** The steps a group/guard callback adds, as bullets; a callback with statements reads as its steps. */
function innerLines(c: Ctx, fn: N): Line[] {
	const f = unwrap(fn);
	if (!isFn(f)) return c.e.bullet(D(c.say.compose.useApp({ app: c.e.text(fn) })));
	const param = f.params[0]?.type === "Identifier" ? f.params[0].name : null;
	return withApp(c, param, () => {
		const result = fnResult(f);
		const { root, steps } = result ? chainOf(result) : { root: null, steps: [] };
		if (param && unwrap(root)?.type === "Identifier" && unwrap(root).name === param)
			return bullets(
				c.e,
				steps.flatMap((s) => stepDocs(c, s)),
			);
		return fnBody(c.e, f);
	});
}

/** Route arguments after the path: Elysia 1 is `(handler, hook)`, Elysia 2 is `(hook, handler)`. */
function routeParts(c: Ctx, rest: N[]): { handler: N | undefined; hook: N | undefined } {
	if (rest.length < 2) return { handler: rest[0], hook: undefined };
	const [a, b] = rest;
	const v2 = c.version === 2 || (c.version === "auto" && isFn(b) && !isFn(a) && !!objectArg(a));
	return v2 ? { handler: b, hook: a } : { handler: a, hook: b };
}

function routeDoc(c: Ctx, { method, path, rest }: { method: string; path: N; rest: N[] }): Doc {
	const { e, say } = c;
	const r = say.routes;
	const { handler, hook } = routeParts(c, rest);
	const at = { method, path: e.text(path) };
	const rules = hookItems(c, hook);
	const h = unwrap(handler);
	if (isFn(h) && h.body.type === "BlockStatement") {
		const lines = fnBody(e, h);
		if (!rules.length) return D(r.answer(at), lines);
		return D(r.answer(at), [...bullets(e, rules), ...e.bullet(D(r.handler, lines))]);
	}
	const named = h?.type === "Identifier" || h?.type === "MemberExpression";
	const value = handler ? e.noun(isFn(h) ? h.body : handler) : null;
	if (!rules.length) {
		if (!value) return D(r.answer(at));
		return D(named ? r.answerUsing({ ...at, handler: value.t }) : r.answerWith({ ...at, reply: value.t }), value.kids);
	}
	const tail = value ? [D(named ? r.handledBy({ handler: value.t }) : r.replyWith({ reply: value.t }), value.kids)] : [];
	return D(r.answer(at), bullets(e, [...rules, ...tail]));
}

const WS_EVENTS = new Set(["open", "message", "close", "drain", "ping", "pong"]);

function wsDoc(c: Ctx, path: N, rest: N[]): Doc {
	const { e, say } = c;
	const opts = objectArg(rest[0]);
	const items = (opts?.properties ?? []).flatMap((p: N): Doc[] => {
		const key = keyOf(p);
		if (key && WS_EVENTS.has(key)) return [callbackDoc({ e, say, node: p.value, intro: say.routes.ws[key as keyof typeof say.routes.ws] })];
		return hookItems(c, { type: "ObjectExpression", properties: [p] });
	});
	if (rest[1]) items.push(callbackDoc({ e, say, node: rest[1], intro: say.routes.ws.message }));
	return D(say.routes.websocket({ path: e.text(path) }), bullets(e, items));
}

/** Splits a leading scope argument off: `({ as: "global" }, fn)` (Elysia 1) or `("plugin", fn)` (Elysia 2). */
function scoped(args: N[]): { scope: HookScope | null; rest: N[] } {
	if (args.length < 2) return { scope: null, rest: args };
	const o = objectArg(args[0]);
	if (o && !isFn(args[0])) {
		const as = findProp(o, "as");
		if (as && o.properties.length === 1) return { scope: scopeOf(as.value), rest: args.slice(1) };
	}
	const s = scopeOf(args[0]);
	return s ? { scope: s, rest: args.slice(1) } : { scope: null, rest: args };
}

function lifecycleDocs(c: Ctx, event: LifecycleEvent, args: N[]): Doc[] {
	const { scope, rest } = scoped(args);
	const base = c.say.hooks.app[event];
	const intro = scope && scope !== "local" ? c.say.hooks.withScope({ thing: base, scope }) : base;
	return rest.flatMap((fn) => hookDocs(c, { intro, node: fn }));
}

/** Names a derive/resolve function hands to the handler: the keys of the object it returns. */
function derivedNames(c: Ctx, fn: N): string | null {
	const f = unwrap(fn);
	if (!isFn(f)) return null;
	const body = f.body.type === "BlockStatement" ? f.body.body.findLast((s: N) => s.type === "ReturnStatement")?.argument : f.body;
	const o = objectArg(body);
	if (!o?.properties.length || o.properties.some((p: N) => keyOf(p) === null)) return null;
	return c.e.g.list(o.properties.map((p: N) => c.e.prop(keyOf(p)!)));
}

function deriveDocs(c: Ctx, args: N[], stage: "beforeValidation" | "afterValidation" | null): Doc[] {
	const { e, say } = c;
	const { scope, rest } = scoped(args);
	const scopedTitle = (thing: string) => (scope && scope !== "local" ? say.hooks.withScope({ thing, scope }) : thing);
	return rest.map((fn) => {
		const names = derivedNames(c, fn);
		const f = unwrap(fn);
		const expressionObject = isFn(f) && f.body.type !== "BlockStatement" && objectArg(f.body);
		const title = scopedTitle(names && !expressionObject ? say.context.derive({ names, stage }) : say.context.deriveSome({ stage }));
		if (!isFn(f)) return D(say.hooks.callBy({ intro: title, fn: e.text(fn) }));
		if (f.body.type === "BlockStatement") return D(title, fnBody(e, f));
		const o = objectArg(f.body);
		if (!o) return D(title, fnBody(e, f));
		return D(
			title,
			bullets(
				e,
				o.properties.map((p: N) => e.objectProp(p)),
			),
		);
	});
}

/** `.state("version", 1)` / `.state({ a, b })`; Elysia 1/2 may put a merge mode first. */
function storeDocs(c: Ctx, args: N[], kind: "state" | "decorate"): Doc[] {
	const { e, say } = c;
	const x = say.context;
	const rest = args.length === 3 || (args.length === 2 && objectArg(args[0]) && objectArg(args[1])) ? args.slice(1) : args;
	const o = rest.length === 1 ? objectArg(rest[0]) : null;
	if (o)
		return [
			D(
				kind === "state" ? x.stateAll : x.decorateAll,
				bullets(
					e,
					o.properties.map((p: N) => e.objectProp(p)),
				),
			),
		];
	const key = stringLit(rest[0]);
	const name = key !== null ? e.prop(key) : e.text(rest[0]);
	const v = rest[1] ? e.noun(rest[1]) : null;
	if (kind === "state") return [D(x.state({ name, value: v?.t ?? "" }), v?.kids)];
	if (!v || (unwrap(rest[1])?.type === "Identifier" && unwrap(rest[1]).name === key)) return [D(x.decorateSame({ name }))];
	return [D(x.decorate({ name, value: v.t }), v.kids)];
}

function macroDocs(c: Ctx, args: N[]): Doc[] {
	const { e, say } = c;
	const one = (name: string, def: N): Doc => {
		const title = say.context.macro({ name: mk("c", name) });
		if (isFn(def)) return callbackDoc({ e, say, node: def, intro: title });
		return D(title, bullets(e, hookItems(c, def)));
	};
	const key = stringLit(args[0]);
	if (key !== null && args[1]) return [one(key, args[1])];
	const o = objectArg(args[0]);
	if (!o) return [D(say.hooks.callBy({ intro: say.context.macros, fn: e.text(args[0]) }))];
	return o.properties.map((p: N) => (keyOf(p) === null ? e.noun(p) : one(keyOf(p)!, p.value)));
}

function modelDocs(c: Ctx, args: N[]): Doc[] {
	const { e, say } = c;
	const key = stringLit(args[0]);
	if (key !== null && args[1]) return [D(say.context.model({ name: e.prop(key), schema: schemaText(c, args[1]) }))];
	const o = objectArg(args[0]);
	if (!o) return [D(say.hooks.from({ value: e.text(args[0]) }))];
	const items = o.properties.map((p: N) => (keyOf(p) === null ? e.noun(p) : D(say.context.model({ name: e.prop(keyOf(p)!), schema: schemaText(c, p.value) }))));
	return [D(say.context.models, bullets(e, items))];
}

/** Elysia 1: `.error({ CODE: Class })` names error classes. Elysia 2: `.error(Class, fn)` handles them. */
function errorDocs(c: Ctx, args: N[]): Doc[] | null {
	const { e, say } = c;
	const x = say.context;
	const o = objectArg(args[0]);
	const code = stringLit(args[0]);
	if (c.version !== 2 && o) {
		const items = o.properties.map((p: N) => (keyOf(p) === null ? e.noun(p) : D(x.errorCode({ code: mk("c", keyOf(p)!), error: e.text(p.value) }))));
		return [D(x.errorCodes, bullets(e, items))];
	}
	if (c.version !== 2 && code !== null && args[1]) return [D(x.errorCode({ code: e.text(args[0]), error: e.text(args[1]) }))];
	if (c.version === 1) return null;
	if (args.length === 1 && isFn(args[0])) return [callbackDoc({ e, say, node: args[0], intro: x.onAnyError })];
	if (args.length === 2) return [callbackDoc({ e, say, node: args[1], intro: x.onError({ error: e.text(args[0]) }) })];
	return null;
}

function listenDocs(c: Ctx, args: N[]): Doc[] {
	const { e, say } = c;
	const l = say.listen;
	const o = objectArg(args[0]);
	const port = o ? findProp(o, "port") : null;
	const host = o ? (findProp(o, "hostname") ?? findProp(o, "host")) : null;
	let title: string;
	if (!o) title = l.port({ port: e.text(args[0]) });
	else if (port && o.properties.length === (host ? 2 : 1))
		title = host ? l.portHost({ port: e.text(port.value), host: e.text(host.value) }) : l.port({ port: e.text(port.value) });
	else title = l.options({ options: e.text(o) });
	if (!args[1]) return [D(title)];
	return [D(title, e.bullet(callbackDoc({ e, say, node: args[1], intro: l.then })))];
}

function useDoc(c: Ctx, arg: N): Doc {
	const { e, say } = c;
	const known = pluginDoc(c, arg);
	if (known) return known;
	const u = unwrap(arg);
	if (u?.type === "ImportExpression") return D(say.compose.useLazy({ path: e.text(u.source) }));
	if (u?.type === "Identifier" || isNewElysia(c, u)) return D(say.compose.useApp({ app: e.text(arg) }));
	return D(say.compose.use({ plugin: e.text(arg) }));
}

/** One chain step as one or more docs (a lifecycle step may register several hooks). */
export function stepDocs(c: Ctx, s: Step): Doc[] {
	const { e, say } = c;
	const { m, args } = s;
	if (HTTP_METHODS.includes(m) && args.length)
		return [routeDoc(c, { method: m === "all" ? say.routes.anyMethod : methodText(m), path: args[0], rest: args.slice(1) })];
	const event = lifecycleNames(c)[m];
	if (event) return lifecycleDocs(c, event, args);
	switch (m) {
		case "route": {
			const verb = stringLit(args[0]);
			return [routeDoc(c, { method: verb ? methodText(verb) : e.text(args[0]), path: args[1], rest: args.slice(2) })];
		}
		case "ws":
			return [wsDoc(c, args[0], args.slice(1))];
		case "mount":
			if (args.length > 1) return [D(say.routes.mount({ path: e.text(args[0]), handler: e.text(args[1]) }))];
			return [D(say.routes.mountAll({ handler: e.text(args[0]) }))];
		case "use":
			return args.map((a) => useDoc(c, a));
		case "group": {
			const fn = args.at(-1);
			const hook = args.length > 2 ? args[1] : null;
			const rules = hookItems(c, hook);
			const ruleLines = rules.length ? e.bullet(D(say.compose.guardRules, bullets(e, rules))) : [];
			return [D(say.compose.group({ prefix: e.text(args[0]) }), [...ruleLines, ...innerLines(c, fn)])];
		}
		case "guard": {
			const { scope, rest } = scoped(args);
			const hook = rest.length && !isFn(rest[0]) ? rest[0] : null;
			const fn = rest.find((a) => isFn(a));
			const rules = [...(scope ? [D(say.hooks.scope[scope])] : []), ...hookItems(c, hook)];
			if (!fn) return [D(say.compose.guardRest, bullets(e, rules))];
			const ruleLines = rules.length ? e.bullet(D(say.compose.guardRules, bullets(e, rules))) : [];
			return [D(say.compose.guardInside, [...ruleLines, ...innerLines(c, fn)])];
		}
		case "state":
		case "decorate":
			return storeDocs(c, args, m);
		case "derive":
			return deriveDocs(c, args, c.version === 1 ? "beforeValidation" : c.version === 2 ? "afterValidation" : null);
		case "resolve":
			if (c.version !== 2) return deriveDocs(c, args, "afterValidation");
			break;
		case "macro":
			return macroDocs(c, args);
		case "model":
			return modelDocs(c, args);
		case "error": {
			const docs = errorDocs(c, args);
			if (docs) return docs;
			break;
		}
		case "headers":
			return [D(say.context.headers({ headers: e.text(args[0]) }))];
		case "as": {
			const scope = scopeOf(args[0]);
			if (scope) return [D(say.context.share[scope])];
			break;
		}
		case "listen":
			return listenDocs(c, args);
		case "stop":
			return [D(say.app.stop)];
		case "compile":
			return [D(say.app.compile)];
	}
	const a = e.argList(args);
	return [D(say.app.other({ method: e.prop(m), args: args.length ? a.t : "" }), a.kids)];
}
