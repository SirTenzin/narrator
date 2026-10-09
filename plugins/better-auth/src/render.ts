import { D, type Doc, type Line, mk, plain, vlen } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import type { BetterAuthPhrases } from "./phrases";

type P = BetterAuthPhrases;
export type Ctx = { e: Engine; say: P };
/** Renders one option's value; may expand into several sibling bullets. */
export type Spec = (p: Ctx & { node: N }) => Doc | Doc[];
export type Specs = Record<string, Spec>;
type Pick<T> = (say: P) => T;

export const isFn = (n: N) => n?.type === "ArrowFunctionExpression" || n?.type === "FunctionExpression";

export const keyOf = (p: N): string | null => {
	if (p.computed) return null;
	if (p.key?.type === "Identifier") return p.key.name;
	return p.key?.type === "Literal" ? String(p.key.value) : null;
};

export const calleeName = (n: N): string | null => {
	const c = unwrap(n?.callee);
	return c?.type === "Identifier" ? c.name : null;
};

export const literal = (n: N): string | number | boolean | null => {
	const u = unwrap(n);
	return u?.type === "Literal" && u.value !== null && !u.regex ? u.value : null;
};

export const objectArg = (n: N): N | null => {
	const u = unwrap(n);
	return u?.type === "ObjectExpression" ? u : null;
};

export const findProp = (obj: N | null, key: string): N | null => obj?.properties.find((p: N) => p.type !== "SpreadElement" && keyOf(p) === key) ?? null;

/** A title with its detail docs: inline in parentheses when short, otherwise as bullets. */
export function group({ e, say, title, items }: Ctx & { title: string; items: Doc[] }): Doc {
	if (!items.length) return D(title);
	const details = say.frame.details({ items: items.map((i) => i.t) });
	if (items.length <= 3 && vlen(details) <= 70 && items.every((i) => !i.kids.length)) return D(say.frame.withDetails({ thing: title, details }));
	return D(
		title,
		items.flatMap((i) => e.bullet(i)),
	);
}

function genericOption({ e, say, prop }: Ctx & { prop: N }): Doc {
	const key = keyOf(prop);
	return plainOption({ e, say, name: key === null ? e.noun(prop.key).t : e.prop(key), node: prop.value });
}

/** "name: value", or just the value when it already reads as the name (`{ email }`). */
export function plainOption({ e, say, name, node }: Ctx & { name: string; node: N }): Doc {
	const v = e.noun(node);
	if (plain(v.t) === plain(name)) return v;
	return D(say.frame.option({ name, value: v.t }), v.kids);
}

export const generic =
	(key: string): Spec =>
	({ e, say, node }) =>
		plainOption({ e, say, name: e.prop(key), node });

/** Every property of an object literal, rendered by its spec (or generically when unknown). */
export function optionDocs({ e, say, node, specs, skip = [] }: Ctx & { node: N; specs: Specs; skip?: string[] }): Doc[] {
	const o = objectArg(node);
	if (!o) return [];
	return o.properties.flatMap((p: N): Doc[] => {
		if (p.type === "SpreadElement") {
			const v = e.noun(p.argument);
			return [D(say.frame.everythingIn({ value: v.t }), v.kids)];
		}
		const key = keyOf(p);
		if (key !== null && skip.includes(key)) return [];
		const spec = key === null ? undefined : specs[key];
		if (!spec) return [genericOption({ e, say, prop: p })];
		const r = spec({ e, say, node: p.value });
		return Array.isArray(r) ? r : [r];
	});
}

export const flag =
	(pick: Pick<(p: { neg: boolean }) => string>): Spec =>
	({ e, say, node }) => {
		const v = literal(node);
		if (typeof v === "boolean") return D(pick(say)({ neg: !v }));
		const c = e.cond(node);
		return D(say.frame.onlyIf({ thing: pick(say)({ neg: false }), cond: c.t }), c.kids);
	};

export const value =
	(pick: Pick<(p: { value: string }) => string>): Spec =>
	({ e, say, node }) => {
		const v = e.noun(node);
		return D(pick(say)({ value: v.t }), v.kids);
	};

export const count =
	(pick: Pick<(p: { count: string; n: number | null }) => string>): Spec =>
	({ e, say, node }) => {
		const n = e.fold(node);
		if (n !== null) return D(pick(say)({ count: mk("l", e.g.formatNumber(n)), n }));
		const v = e.noun(node);
		return D(pick(say)({ count: v.t, n: null }), v.kids);
	};

const UNITS = [
	["day", 86400],
	["hour", 3600],
	["minute", 60],
	["second", 1],
] as const;

/** Seconds as a human duration: `60 * 60 * 24 * 7` -> "7 days". */
export function durationDoc({ e, say, node }: Ctx & { node: N }): Doc {
	const n = e.fold(node);
	if (n === null || !Number.isInteger(n) || n < 0) {
		const v = e.noun(node);
		return D(say.durationInSeconds({ value: v.t }), v.kids);
	}
	const [unit, size] = UNITS.find(([, s]) => n % s === 0 && n >= s) ?? UNITS[3];
	const k = n / size;
	return D(mk("l", say.units[unit]({ count: e.g.formatNumber(k), n: k })));
}

export const duration =
	(pick: Pick<(p: { duration: string }) => string>): Spec =>
	({ e, say, node }) => {
		const d = durationDoc({ e, say, node });
		return D(pick(say)({ duration: d.t }), d.kids);
	};

/** An array literal as a "a, b, and c" list; anything else as its noun. */
export function listDoc({ e, node }: { e: Engine; node: N }): Doc {
	const u = unwrap(node);
	if (u?.type !== "ArrayExpression") return e.noun(node);
	const parts = u.elements.filter(Boolean).map((x: N) => e.noun(x));
	return D(
		e.g.list(parts.map((p: Doc) => p.t)),
		parts.flatMap((p: Doc) => p.kids),
	);
}

export const items =
	(pick: Pick<(p: { items: string }) => string>): Spec =>
	({ e, say, node }) => {
		const l = listDoc({ e, node });
		return D(pick(say)({ items: l.t }), l.kids);
	};

/** Object keys as a list: `additionalFields: { plan: {...} }` -> "plan". */
export const keys =
	(pick: Pick<(p: { items: string }) => string>): Spec =>
	({ e, say, node }) => {
		const o = objectArg(node);
		if (!o) {
			const v = e.noun(node);
			return D(pick(say)({ items: v.t }), v.kids);
		}
		const names = o.properties.map((p: N) => (p.type === "SpreadElement" ? e.noun(p.argument).t : e.prop(keyOf(p) ?? e.code(p.key))));
		return D(pick(say)({ items: e.g.list(names) }));
	};

/** A string literal looked up in a phrase map (`prompt: "consent"`), else rendered with `otherwise`. */
export const choice =
	(pick: Pick<Record<string, string>>, otherwise: Spec): Spec =>
	(ctx) => {
		const v = literal(ctx.node);
		const hit = typeof v === "string" ? pick(ctx.say)[v] : undefined;
		return hit ? D(hit) : otherwise(ctx);
	};

const looksBoolean = (n: N) => {
	const u = unwrap(n);
	return u?.type === "BinaryExpression" || u?.type === "LogicalExpression" || (u?.type === "UnaryExpression" && u.operator === "!");
};

/** A function's body as lines; an expression body becomes "give back …" or a plain action. */
export function fnBody(e: Engine, fn: N): Line[] {
	if (fn.body.type === "BlockStatement") return e.body(fn.body, 0);
	const ex = unwrap(fn.body);
	const asAction = ex?.type === "CallExpression" && !looksBoolean(ex);
	const stmt = asAction
		? { type: "ExpressionStatement", expression: fn.body, start: fn.body.start, end: fn.body.end }
		: { type: "ReturnStatement", argument: fn.body, start: fn.body.start, end: fn.body.end };
	return e.body(stmt, 0);
}

/** A callback option: its intro ("to send a password-reset email") with the function body beneath. */
export function callbackDoc({ e, say, node, intro, withGiven = true }: Ctx & { node: N; intro: string; withGiven?: boolean }): Doc {
	let fn = unwrap(node);
	if (fn?.type === "CallExpression" && calleeName(fn) === "createAuthMiddleware") fn = unwrap(fn.arguments[0]);
	if (isFn(fn)) {
		const given = withGiven ? fn.params.flatMap((p: N) => e.patternNames(p)) : [];
		const head = given.length ? say.frame.given({ intro, given: e.g.list(given) }) : intro;
		return D(head, fnBody(e, fn));
	}
	const v = e.noun(node);
	return D(say.frame.callBy({ intro, fn: v.t }), v.kids);
}

export const callback =
	(pick: Pick<string>, opts: { withGiven?: boolean } = {}): Spec =>
	({ e, say, node }) =>
		callbackDoc({ e, say, node, intro: pick(say), ...opts });

/** A nested options object (`cookieCache: { enabled, maxAge }`) under its own title; honours `enabled`. */
export const section =
	(pick: Pick<string>, specs: Specs = {}): Spec =>
	({ e, say, node }) => {
		const title = pick(say);
		const o = objectArg(node);
		if (!o) {
			const v = e.noun(node);
			return D(say.frame.option({ name: title, value: v.t }), v.kids);
		}
		const enabled = findProp(o, "enabled");
		const on = enabled ? literal(enabled.value) : true;
		if (on === false) return D(say.frame.turnedOff({ thing: title }));
		const opts = optionDocs({ e, say, node: o, specs, skip: ["enabled"] });
		if (on === true) return group({ e, say, title, items: opts });
		const c = e.cond(enabled.value);
		const g = group({ e, say, title: say.frame.onlyIf({ thing: title, cond: c.t }), items: opts });
		return D(g.t, [...c.kids, ...g.kids]);
	};

/** Several specs read the same (`modelName`, `fields`, `additionalFields`) on every table-backed section. */
export const tableSpecs: Specs = {
	modelName: value((s) => s.frame.tableName),
	additionalFields: keys((s) => s.frame.extraFields),
	fields: value((s) => s.frame.columnNames),
};
