import { D, type Doc, mk } from "@narrate/core";
import { type Engine, type N, unwrap } from "../engine";
import type { StdPhrases } from "./phrases";

export const isFn = (n: N) => n && (unwrap(n).type === "ArrowFunctionExpression" || unwrap(n).type === "FunctionExpression");

/** Name used for a lambda's item, e.g. `(price) => …` -> "price". */
export const itemName = ({ e, fn, say }: { e: Engine; fn: N; say: StdPhrases }) => {
	const name = e.paramName(fn.params[0]);
	return name ? e.ref(name) : say.item;
};

/** Renders a lambda body as a condition, with destructured params reading as "its x". */
export function lambdaCond(e: Engine, fn: N): Doc | null {
	const ex = e.lambdaExpr(fn);
	if (!ex) return null;
	return e.cond(ex, false);
}

/** The lambda body as a noun; with `eachAlias`, a param used once reads as "each <item>". */
export function lambdaNoun({ e, fn, say, eachAlias }: { e: Engine; fn: N; say: StdPhrases; eachAlias: boolean }): Doc | null {
	const ex = e.lambdaExpr(fn);
	if (!ex) return null;
	const p = e.paramName(fn.params[0]);
	if (eachAlias && p && e.countUses(ex, p) === 1)
		return e.withAlias(
			fn,
			(x) => say.each({ item: e.ref(x) }),
			() => e.noun(ex),
		);
	return e.noun(ex);
}

/** `(x) => x.foo` or `({ foo }) => foo` -> "foo". */
export function pluckedProp(e: Engine, fn: N): string | null {
	const ex = e.lambdaExpr(fn);
	if (!ex) return null;
	const u = unwrap(ex);
	const p = e.paramName(fn.params[0]);
	if (p && u.type === "MemberExpression" && !u.computed && unwrap(u.object).type === "Identifier" && unwrap(u.object).name === p) return u.property.name;
	if (fn.params[0]?.type === "ObjectPattern" && u.type === "Identifier" && fn.params[0].properties.length === 1) return u.name;
	return null;
}

/** `x => x.items ?? []` -> "items". */
export function pluckedListProp(e: Engine, fn: N): string | null {
	const ex = e.lambdaExpr(fn);
	if (!ex) return null;
	const u = unwrap(ex);
	if (u.type === "LogicalExpression" && u.operator === "??" && unwrap(u.right).type === "ArrayExpression" && !unwrap(u.right).elements.length)
		return pluckedProp(e, { ...fn, body: u.left, params: fn.params });
	return pluckedProp(e, fn);
}

/** A property name in the plural, linked to its key: `id` -> "IDs". */
export const propPlural = (e: Engine, prop: string) => mk("v", e.g.plural(e.lex.humanize(prop)), prop);

export const lambdaBlock = (e: Engine, fn: N): Doc => D("", e.body(fn.body, 0));

/** A block intro: the trailing colon marks that `kids` follow. */
export const block = (text: string, kids: Doc["kids"]) => D(`${text}:`, kids);
