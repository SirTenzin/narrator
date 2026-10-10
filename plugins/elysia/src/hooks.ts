import { D, type Doc, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import type { HookScope, LifecycleEvent, RequestPart } from "./phrases";
import { schemaText } from "./schema";
import { type Ctx, callbackDoc, isFn, keyOf, literal, objectArg, optionDoc, stringLit } from "./shared";

const PARTS = new Set<string>(["body", "query", "params", "headers", "cookie"] satisfies RequestPart[]);

/** Hook keys inside a route / guard / macro options object, by event. Elysia 1.0's `onResponse` became `afterResponse`. */
const HOOK_EVENTS: Record<string, LifecycleEvent> = {
	parse: "parse",
	type: "parse",
	transform: "transform",
	beforeHandle: "beforeHandle",
	afterHandle: "afterHandle",
	mapResponse: "mapResponse",
	error: "error",
	afterResponse: "afterResponse",
	onResponse: "afterResponse",
	request: "request",
	trace: "trace",
};

const SCOPES = new Set<string>(["local", "scoped", "global", "plugin"] satisfies HookScope[]);
export const scopeOf = (n: N): HookScope | null => {
	const v = stringLit(n);
	return v !== null && SCOPES.has(v) ? (v as HookScope) : null;
};

/** One hook (or an array of them) under its intro. */
export function hookDocs(c: Ctx, { intro, node }: { intro: string; node: N }): Doc[] {
	const u = unwrap(node);
	if (u?.type === "ArrayExpression") return u.elements.filter(Boolean).map((x: N) => callbackDoc({ e: c.e, say: c.say, node: x, intro }));
	return [callbackDoc({ e: c.e, say: c.say, node, intro })];
}

/** `response: t.String()` or `response: { 200: …, 404: … }`. */
function responseDoc(c: Ctx, node: N): Doc {
	const { e, say } = c;
	const o = objectArg(node);
	const byStatus = o?.properties.length && o.properties.every((p: N) => /^\d{3}$/.test(keyOf(p) ?? ""));
	if (!byStatus) return D(say.hooks.response({ schema: schemaText(c, node) }));
	const items = o.properties.map((p: N) => D(say.hooks.responseFor({ status: statusName(c, Number(keyOf(p))), schema: schemaText(c, p.value) })));
	return D(
		say.hooks.responses,
		items.flatMap((i: Doc) => e.bullet(i)),
	);
}

export function statusName(c: Ctx, code: number): string {
	return c.say.responses.status({ code: mk("l", String(code)), name: c.say.responses.names[code] ?? "" });
}

function docsDoc(c: Ctx, node: N): Doc {
	const { e, say } = c;
	const h = say.hooks;
	const o = objectArg(node);
	if (!o) return D(h.option({ name: h.docs, value: e.text(node) }));
	const items = o.properties.map((p: N): Doc => {
		const key = keyOf(p);
		const v = p.value;
		if (key === "summary") return D(h.summary({ value: e.text(v) }));
		if (key === "description") return D(h.description({ value: e.text(v) }));
		if (key === "operationId") return D(h.operationId({ value: e.text(v) }));
		if (key === "tags") {
			const els = unwrap(v)?.type === "ArrayExpression" ? unwrap(v).elements.map((x: N) => e.text(x)) : [e.text(v)];
			return D(h.tags({ items: e.g.list(els) }));
		}
		if (key === "deprecated" && literal(v) === true) return D(h.deprecated);
		if (key === "hide" && literal(v) === true) return D(h.hidden);
		return optionDoc({ e, prop: p, phrase: h.option });
	});
	return D(
		h.docs,
		items.flatMap((i: Doc) => e.bullet(i)),
	);
}

/** Every entry of a route / guard / macro options object, in source order. */
export function hookItems(c: Ctx, node: N | null | undefined): Doc[] {
	if (!node) return [];
	const { e, say } = c;
	const h = say.hooks;
	const o = objectArg(node);
	if (!o) return [D(h.from({ value: e.text(node) }))];
	const scope = scopeOf(findValue(o, "as"));
	return o.properties.flatMap((p: N): Doc[] => {
		if (p.type === "SpreadElement") return [e.noun(p)];
		const key = keyOf(p);
		const v = p.value;
		if (key === null) return [optionDoc({ e, prop: p, phrase: h.option })];
		if (key === "as") return scope ? [D(h.scope[scope])] : [optionDoc({ e, prop: p, phrase: h.option })];
		if (PARTS.has(key)) return [D(h.validate[key as RequestPart]({ schema: schemaText(c, v) }))];
		if (key === "response") return [responseDoc(c, v)];
		if (key === "detail") return [docsDoc(c, v)];
		if (key === "schema" && (literal(v) === "standalone" || literal(v) === "override")) return [D(literal(v) === "standalone" ? h.standalone : h.override)];
		if ((key === "parse" || key === "type") && stringLit(v) !== null) return [D(h.parseAs({ type: parserName(c, stringLit(v)!) }))];
		if ((key === "derive" || key === "resolve") && isFn(v))
			return [callbackDoc({ e, say, node: v, intro: say.context.deriveSome({ stage: key === "resolve" ? "afterValidation" : null }) })];
		const event = HOOK_EVENTS[key];
		if (event && (isFn(v) || unwrap(v)?.type === "ArrayExpression" || unwrap(v)?.type === "Identifier")) return hookDocs(c, { intro: h.local[event], node: v });
		if (literal(v) === true) return [D(h.turnedOn({ name: mk("c", key) }))];
		if (literal(v) === false) return [D(h.turnedOff({ name: mk("c", key) }))];
		return [optionDoc({ e, prop: p, phrase: h.option })];
	});
}

const findValue = (o: N, key: string) => o.properties.find((p: N) => keyOf(p) === key)?.value;

const parserName = (c: Ctx, v: string) => (Object.hasOwn(c.say.hooks.parsers, v) ? c.say.hooks.parsers[v]! : mk("l", `"${v}"`));
