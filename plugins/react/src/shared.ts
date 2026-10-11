import { D, type Doc, type Line, lowerFirst, mk, plain, vlen } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import type { Facts } from "./facts";
import type { ReactPhrases } from "./phrases";

/** Reads one JSX element a host library knows (`next/link`'s `Link`); `consumed` props are left out of the details. */
export type ElementRule = (c: { e: Engine; tag: string; node: N; attr: (name: string) => N | null; text: (n: N) => string }) => {
	element: string;
	consumed: string[];
} | null;

/** What every renderer gets: the engine, the phrasebook, the file's React facts and any host element rules. */
export type Ctx = { e: Engine; say: ReactPhrases; facts: Facts; elements: Record<string, ElementRule> };

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

export const keyOf = (p: N): string | null => {
	if (p?.type !== "Property" || p.computed) return null;
	if (p.key.type === "Identifier") return p.key.name;
	return p.key.type === "Literal" ? String(p.key.value) : null;
};

export const isNullish = (n: N) => {
	const u = unwrap(n);
	return !u || (u.type === "Literal" && (u.value === null || u.value === false) && !u.regex) || (u.type === "Identifier" && u.name === "undefined");
};

/** Whether an expression builds UI: JSX, or a condition or `map` that ends in JSX. */
export function hasJsx(n: N): boolean {
	const u = unwrap(n);
	if (!u) return false;
	switch (u.type) {
		case "JSXElement":
		case "JSXFragment":
			return true;
		case "ConditionalExpression":
			return hasJsx(u.consequent) || hasJsx(u.alternate);
		case "LogicalExpression":
			return hasJsx(u.right) || hasJsx(u.left);
		case "CallExpression":
			return isJsxMap(u);
		case "ArrowFunctionExpression":
		case "FunctionExpression":
			return returnsJsx(u);
		default:
			return false;
	}
}

/** `xs.map((x) => <li>…</li>)`. */
export function isJsxMap(n: N): boolean {
	const u = unwrap(n);
	const c = unwrap(u?.callee);
	if (u?.type !== "CallExpression" || c?.type !== "MemberExpression" || c.computed || !["map", "flatMap"].includes(c.property.name)) return false;
	const fn = unwrap(u.arguments[0]);
	return isFn(fn) && returnsJsx(fn);
}

/** The return statements of a function body, not counting nested functions. */
export function returnsOf(fn: N): N[] {
	const out: N[] = [];
	const walk = (x: N) => {
		if (!x || typeof x !== "object") return;
		if (Array.isArray(x)) return x.forEach(walk);
		if (x.type === "ArrowFunctionExpression" || x.type === "FunctionExpression" || x.type === "FunctionDeclaration" || x.type === "ClassBody") return;
		if (x.type === "ReturnStatement") out.push(x);
		for (const k in x) if (k !== "parent" && x[k] && typeof x[k] === "object") walk(x[k]);
	};
	if (fn.body?.type === "BlockStatement") walk(fn.body.body);
	return out;
}

/** Whether a function renders UI: its expression body or one of its returns is JSX. */
export function returnsJsx(fn: N): boolean {
	if (fn.body?.type !== "BlockStatement") return hasJsx(fn.body);
	return returnsOf(fn).some((r) => hasJsx(r.argument));
}

/** A dependency list as "A or B", or which of always / once applies. */
export function depsOf(e: Engine, n: N): { kind: "always" } | { kind: "once" } | { kind: "when"; deps: string } {
	const u = unwrap(n);
	if (!u) return { kind: "always" };
	if (u.type !== "ArrayExpression") return { kind: "when", deps: e.text(u) };
	const items = u.elements.filter(Boolean);
	if (!items.length) return { kind: "once" };
	return { kind: "when", deps: e.g.list(items.map((x: N) => e.text(x)), "or") };
}

const asStatement = (ex: N) => ({ type: "ExpressionStatement", expression: ex, start: ex.start, end: ex.end });

/** A function's steps as lines; an expression body reads as one action. */
export function stepsOf(e: Engine, fn: N): Line[] {
	const f = unwrap(fn);
	if (f.body.type === "BlockStatement") return e.body(f.body, 0);
	return e.body(asStatement(f.body), 0);
}

/** A callback's steps as one inline action when they fit on a line, else as block lines. */
export function actionOf(e: Engine, fn: N): Doc {
	const lines = stepsOf(e, fn);
	if (lines.length === 1 && !lines[0]!.text.endsWith(":") && lines[0]!.kind !== "note") return D(lowerFirst(lines[0]!.text.replace(/\.$/, "")));
	return D("", lines);
}

/** Function parameters as one list, or null. */
export const paramsOf = (e: Engine, params: N[]): string | null => {
	const names = params.flatMap((p: N) => e.patternNames(p));
	return names.length ? e.g.list(names) : null;
};

/** A component or hook name as linked code. */
export const nameRef = (name: string) => mk("f", name, name);

/** Whether a rendered phrase can sit inline. */
export const fits = (d: Doc, max = 90) => !d.kids.length && vlen(d.t) <= max;

export const bullets = (e: Engine, docs: Doc[]): Line[] => docs.flatMap((d) => e.bullet(d));

export const same = (e: Engine, text: string, key: string) => plain(text) === e.lex.humanize(key);
