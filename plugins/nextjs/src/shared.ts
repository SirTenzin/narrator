import { mk } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import type { ReactKit } from "@usenarrator/plugin-react";
import type { Facts } from "./facts";
import type { NextPhrases } from "./phrases";

/** What every renderer gets: the engine, the phrasebook, the file's Next.js facts and the React kit for components. */
export type Ctx = { e: Engine; say: NextPhrases; facts: Facts; kit: ReactKit };

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

/** A path or name in full: as code when it's a plain string, else the expression read aloud. */
export const codeText = (e: Engine, n: N): string => {
	const s = str(n);
	return s === null ? e.text(n) : mk("c", s);
};

/** A count of seconds in the largest whole unit: 3600 -> "1 hour". */
export function secondsText({ e, say }: Ctx, n: N): string {
	const secs = e.fold(n);
	if (secs === null || !Number.isInteger(secs) || secs <= 0) return e.text(n);
	const u = say.units;
	const [unit, size] = secs % 86400 === 0 ? [u.days, 86400] : secs % 3600 === 0 ? [u.hours, 3600] : secs % 60 === 0 ? [u.minutes, 60] : [u.seconds, 1];
	const k = secs / size;
	return unit({ count: mk("l", e.g.formatNumber(k)), n: k });
}

export function statusText({ e, say }: Ctx, n: N): string {
	const code = num(n);
	if (code === null) return e.text(n);
	return say.responses.status({ code: mk("l", String(code)), name: say.responses.statusNames[String(code)] ?? null });
}

/** `{ status, headers }` response options as detail items. */
export function initItems(c: Ctx, n: N): string[] {
	const o = objectArg(n);
	if (!o) return n ? [c.e.text(n)] : [];
	return o.properties.flatMap((p: N): string[] => {
		const k = keyOf(p);
		if (k === "status") return [statusText(c, p.value)];
		if (k === "headers") {
			const h = objectArg(p.value);
			const items = h ? h.properties.map((x: N) => `${mk("c", keyOf(x) ?? c.e.code(x.key))}: ${c.e.text(x.value)}`) : [c.e.text(p.value)];
			return [c.say.responses.headers({ items: c.e.g.list(items) })];
		}
		if (k === "statusText") return [];
		return [optionText(c, p)];
	});
}

/** One option as "name: value"; spreads and computed keys as written. */
export function optionText(c: Ctx, p: N): string {
	const k = keyOf(p);
	if (p.type !== "Property" || k === null) return c.e.text(p.type === "SpreadElement" ? p.argument : p.value);
	return c.e.argItems([{ type: "ObjectExpression", properties: [p], start: p.start, end: p.end }]).joined;
}

export const detailsOf = (items: string[]) => (items.length ? items.join("; ") : null);
