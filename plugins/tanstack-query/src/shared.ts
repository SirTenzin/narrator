import { capFirst, D, type Doc, type Line, mk, vlen } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import type { Facts } from "./facts";
import type { TanStackQueryPhrases } from "./phrases";

/** What every renderer gets: the engine, the phrasebook, this file's facts and the major version (null reads both). */
export type Ctx = { e: Engine; say: TanStackQueryPhrases; facts: Facts; major: 4 | 5 | null };

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

export const bool = (n: N): boolean | null => {
	const u = unwrap(n);
	return u?.type === "Literal" && typeof u.value === "boolean" ? u.value : null;
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

export const isIdent = (n: N, name?: string) => {
	const u = unwrap(n);
	return u?.type === "Identifier" && (name === undefined || u.name === name);
};

/** Source text on one line, without the trailing commas multi-line arrays carry. */
export const oneLine = (e: Engine, n: N) =>
	e
		.code(n)
		.replace(/\s+/g, " ")
		.replace(/,\s*([\])}])/g, "$1")
		.replace(/([[({])\s+/g, "$1")
		.replace(/\s+([\])}])/g, "$1");

/** A query key in full, as code; a key held in a variable reads by its name. */
export function keyText(c: Ctx, n: N): { text: string; byName: boolean } {
	const u = unwrap(n);
	if (u?.type === "Identifier" || (u?.type === "MemberExpression" && !u.computed && !/[([]/.test(c.e.code(u)))) return { text: c.e.text(u), byName: true };
	return { text: mk("c", oneLine(c.e, u)), byName: false };
}

/** "the ["todos", id] query" / "the query keyed by todo key". */
export function queryName(c: Ctx, n: N): string {
	const k = keyText(c, n);
	return k.byName ? c.say.query.keyedBy({ key: k.text }) : c.say.query.keyed({ key: k.text });
}

/** A duration in milliseconds, in the largest whole unit; `Infinity` is null so callers can say "forever". */
export function msText({ e, say }: Ctx, n: N): string | null {
	const u = unwrap(n);
	if (u?.type === "Identifier" && u.name === "Infinity") return null;
	const ms = e.fold(n);
	if (ms === null || !Number.isFinite(ms) || ms < 0) return e.text(n);
	if (!Number.isInteger(ms)) return e.text(n);
	const u_ = say.common.units;
	const [unit, size] =
		ms && ms % 3_600_000 === 0
			? [u_.hours, 3_600_000]
			: ms && ms % 60_000 === 0
				? [u_.minutes, 60_000]
				: ms && ms % 1000 === 0
					? [u_.seconds, 1000]
					: [u_.milliseconds, 1];
	const k = ms / size;
	return unit({ count: mk("l", e.g.formatNumber(k)), n: k });
}

/** A callback's parameters as "x and y", or null when it takes none. */
export const givenOf = (e: Engine, fn: N): string | null => e.paramList(unwrap(fn).params);

/** A callback's steps; an expression body reads as an action when it's a call, else as "give back …". */
export function fnLines(e: Engine, fn: N): Line[] {
	const f = unwrap(fn);
	if (f.body.type === "BlockStatement") return e.body(f.body, 0);
	const body = unwrap(f.body);
	const at = { start: f.body.start, end: f.body.end };
	const asAction = body?.type === "CallExpression" || body?.type === "AwaitExpression" || body?.type === "AssignmentExpression";
	return e.body(asAction ? { type: "ExpressionStatement", expression: f.body, ...at } : { type: "ReturnStatement", argument: f.body, ...at }, 0);
}

/** A callback option: a heading over its steps, or "heading, run fn" when passed by name. */
export function callbackDoc(c: Ctx, n: N, heading: (p: { given: string | null }) => string): Doc {
	if (isFn(n)) return D(heading({ given: givenOf(c.e, n) }), fnLines(c.e, n));
	const v = c.e.noun(n);
	return D(c.say.mutation.callbackBy({ heading: heading({ given: null }), fn: v.t }), v.kids);
}

/**
 * A function option that reads inline when it's one expression (`select: (d) => d.items`),
 * else as a heading over its steps.
 */
export function exprOrSteps(c: Ctx, n: N, inline: (v: string) => string, steps: (p: { given: string | null }) => string, named?: (v: string) => string): Doc {
	const u = unwrap(n);
	if (!isFn(u)) {
		const v = c.e.noun(u);
		return D((named ?? inline)(v.t), v.kids);
	}
	const ex = c.e.lambdaExpr(u);
	if (ex) {
		const v = c.e.noun(ex);
		if (!v.kids.length) return D(inline(v.t));
	}
	return D(steps({ given: givenOf(c.e, u) }), fnLines(c.e, u));
}

export const bullets = (e: Engine, docs: Doc[]): Line[] => docs.flatMap((d) => e.bullet(D(capFirst(d.t), d.kids)));

/** A subject with its details: a short parenthetical when they're brief, else bullets beneath. */
export function withDetails(c: Ctx, subject: string, items: Doc[]): Doc {
	if (!items.length) return D(subject);
	const joined = c.say.options.details({ items: items.map((i) => i.t) });
	if (items.every((i) => !i.kids.length) && items.length <= 3 && vlen(joined) <= 90) return D(c.say.query.withDetails({ subject, details: joined }));
	return D(subject, bullets(c.e, items));
}
