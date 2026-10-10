import { D, type Doc, type Line, mk } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import type { Facts } from "./facts";
import type { HonoPhrases, OptionKey, Target } from "./phrases";

/** What every renderer gets: the engine, the phrasebook, and the current file's Hono facts. */
export type Ctx = { e: Engine; say: HonoPhrases; facts: Facts };
/** The call a rule is looking at. */
export type Site = { node: N; args: N[]; obj: N | null; stmt: boolean };
/** A call rule over a ready-made `Ctx`; the plugin factory adapts it to the engine's signature. */
export type Rule = (c: Ctx, site: Site) => Doc | null;

export const isFn = (n: N) => {
	const u = unwrap(n);
	return u?.type === "ArrowFunctionExpression" || u?.type === "FunctionExpression";
};

export const str = (n: N): string | null => {
	const u = unwrap(n);
	if (u?.type === "Literal" && typeof u.value === "string") return u.value;
	if (u?.type === "TemplateLiteral" && !u.expressions.length) return u.quasis[0].value.cooked;
	return null;
};

const num = (n: N): number | null => {
	const u = unwrap(n);
	return u?.type === "Literal" && typeof u.value === "number" ? u.value : null;
};

export const keyOf = (p: N): string | null => {
	if (p.type !== "Property" || p.computed) return null;
	if (p.key.type === "Identifier") return p.key.name;
	return p.key.type === "Literal" ? String(p.key.value) : null;
};

export const objectArg = (n: N): N | null => {
	const u = unwrap(n);
	return u?.type === "ObjectExpression" ? u : null;
};

export const propOf = (obj: N | null, key: string): N | null => obj?.properties.find((p: N) => keyOf(p) === key)?.value ?? null;

/** A route path in full, as code: `/users/:id`. */
export const pathText = (e: Engine, n: N): string => {
	const s = str(n);
	return s === null ? e.text(n) : mk("c", s);
};

/** A status code with its name when the phrasebook knows it: "404 Not Found". */
export function statusText({ e, say }: Ctx, n: N): string {
	const code = num(n);
	if (code === null) return e.text(n);
	return say.response.code({ code: mk("l", String(code)), name: say.response.statusNames[String(code)] ?? null });
}

/** A validation target (`"json"`) as its phrase, or the expression itself. */
export function targetText({ e, say }: Ctx, n: N): string {
	const s = str(n);
	return (s && say.validation.targets[s as Target]) || e.text(n);
}

/** A duration in milliseconds, in the largest whole unit. */
export function msText({ e, say }: Ctx, n: N): string {
	const ms = e.fold(n);
	if (ms === null || !Number.isInteger(ms) || ms < 0) return e.text(n);
	const u = say.common.units;
	const [unit, size] = ms && ms % 60000 === 0 ? [u.minutes, 60000] : ms && ms % 1000 === 0 ? [u.seconds, 1000] : [u.milliseconds, 1];
	const k = ms / size;
	return unit({ count: mk("l", e.g.formatNumber(k)), n: k });
}

function optionValue({ e, say }: Ctx, n: N): string {
	const u = unwrap(n);
	if (u?.type === "Literal" && typeof u.value === "boolean") return u.value ? say.common.yes : say.common.no;
	if (u?.type === "ArrayExpression") return e.g.list(u.elements.filter(Boolean).map((x: N) => e.text(x)));
	return e.text(n);
}

/** An options object as "label: value" items; unknown keys use their humanized name. */
export function optionItems(c: Ctx, n: N, skip: string[] = []): string[] {
	const o = objectArg(n);
	if (!o) return n ? [c.e.text(n)] : [];
	return o.properties.flatMap((p: N): string[] => {
		if (p.type === "SpreadElement") return [c.e.text(p)];
		const key = keyOf(p);
		if (key !== null && skip.includes(key)) return [];
		const name = (key && c.say.common.options[key as OptionKey]) || (key ? c.e.prop(key) : c.e.text(p.key));
		return [c.say.common.option({ name, value: p.shorthand ? c.e.ref(key ?? "") : optionValue(c, p.value) })];
	});
}

/** Option items joined into one parenthetical's contents, or null when there are none. */
export const details = (c: Ctx, items: string[]): string | null => (items.length ? c.say.common.details({ items }) : null);

/** A callback's steps. An expression body becomes a return, so a reply reads as one. */
export function fnLines(e: Engine, fn: N): Line[] {
	const f = unwrap(fn);
	if (f.body.type === "BlockStatement") return e.body(f.body, 0);
	return e.body({ type: "ReturnStatement", argument: f.body, start: f.body.start, end: f.body.end }, 0);
}

/** A list of docs as one phrase, keeping their block lines. */
export const listDoc = (e: Engine, docs: Doc[], conj: "and" | "or" = "and"): Doc =>
	D(
		e.g.list(
			docs.map((d) => d.t),
			conj,
		),
		docs.flatMap((d) => d.kids),
	);

/** Generic type arguments of a call or `new`, e.g. `hc<AppType>`. */
export const typeArgs = (n: N): N[] => unwrap(n)?.typeArguments?.params ?? [];
