import { capFirst, D, type Doc, type Line, mk } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import type { Facts } from "./facts";
import type { ExpressPhrases } from "./phrases";

/** What every renderer gets: the engine, the phrasebook, and the current file's Express facts. */
export type Ctx = { e: Engine; say: ExpressPhrases; facts: Facts };

export const str = (n: N): string | null => {
	const u = unwrap(n);
	if (u?.type === "Literal" && typeof u.value === "string") return u.value;
	if (u?.type === "TemplateLiteral" && !u.expressions.length) return u.quasis[0].value.cooked;
	return null;
};

export const num = (n: N): number | null => {
	const u = unwrap(n);
	return u?.type === "Literal" && typeof u.value === "number" ? u.value : null;
};

export const keyOf = (p: N): string | null => {
	if (p?.type !== "Property" || p.computed) return null;
	if (p.key.type === "Identifier") return p.key.name;
	return p.key.type === "Literal" ? String(p.key.value) : null;
};

export const objectArg = (n: N): N | null => {
	const u = unwrap(n);
	return u?.type === "ObjectExpression" ? u : null;
};

export const propOf = (obj: N | null, key: string): N | null => obj?.properties.find((p: N) => keyOf(p) === key)?.value ?? null;

/** A path, header or setting name: literals in full as code, anything else as its noun. */
export const codeText = (e: Engine, n: N): string => {
	const s = str(n);
	return s === null ? e.text(n) : mk("c", s);
};

/** A path pattern: strings and regexes in full; arrays as a list. */
export function pathText(e: Engine, n: N): string {
	const u = unwrap(n);
	if (u?.type === "ArrayExpression") return e.g.list(u.elements.filter(Boolean).map((x: N) => pathText(e, x)));
	if (u?.type === "Literal" && u.regex) return mk("c", `/${u.regex.pattern}/${u.regex.flags}`);
	return codeText(e, u);
}

/** A first argument that names a path rather than a handler: a string, regex, array of them, or a `PATH`-like constant. */
export function isPath(n: N): boolean {
	const u = unwrap(n);
	if (str(u) !== null || u?.type === "TemplateLiteral" || (u?.type === "Literal" && u.regex)) return true;
	if (u?.type === "ArrayExpression") return u.elements.length > 0 && u.elements.every((x: N) => isPath(x));
	return u?.type === "Identifier" && /^[A-Z][A-Z0-9_]*$|path|route|prefix/i.test(u.name);
}

/** A status code with its name when the phrasebook knows it: "404 Not Found". */
export function statusText({ e, say }: Ctx, n: N): string {
	const code = num(n);
	if (code === null) return e.text(n);
	return say.response.code({ code: mk("l", String(code)), name: say.response.statusNames[String(code)] ?? null });
}

function optionValue({ e, say }: Ctx, n: N): string {
	const u = unwrap(n);
	if (u?.type === "Literal" && typeof u.value === "boolean") return u.value ? say.common.yes : say.common.no;
	if (u?.type === "ArrayExpression") return e.g.list(u.elements.filter(Boolean).map((x: N) => e.text(x)));
	return e.text(n);
}

/** An options object as "label: value" items, keys humanized. */
export function optionItems(c: Ctx, n: N): string[] {
	const o = objectArg(n);
	if (!o) return n ? [c.e.text(n)] : [];
	return o.properties.map((p: N) => {
		if (p.type === "SpreadElement") return c.e.text(p);
		const key = keyOf(p);
		return c.say.common.option({ name: key ? c.e.prop(key) : c.e.text(p.key), value: p.shorthand && key ? c.e.ref(key) : optionValue(c, p.value) });
	});
}

export const details = (c: Ctx, items: string[]): string | null => (items.length ? c.say.common.details({ items }) : null);

export const isFnNode = (n: N) => {
	const u = unwrap(n);
	return u?.type === "ArrowFunctionExpression" || u?.type === "FunctionExpression";
};

/** A callback's steps; an expression body reads as an action. */
export function fnLines(e: Engine, fn: N): Line[] {
	const f = unwrap(fn);
	if (f.body.type === "BlockStatement") return e.body(f.body, 0);
	return e.body({ type: "ExpressionStatement", expression: f.body, start: f.body.start, end: f.body.end }, 0);
}

export const bullets = (e: Engine, docs: Doc[]): Line[] => docs.flatMap((d) => e.bullet(D(capFirst(d.t), d.kids)));

export const listDoc = (e: Engine, docs: Doc[]): Doc =>
	D(
		e.g.list(docs.map((d) => d.t)),
		docs.flatMap((d) => d.kids),
	);
