import { D, type Doc, mk, plain } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import type { Facts } from "./facts";
import type { AutumnPhrases, Term } from "./phrases";

export type Ctx = { e: Engine; say: AutumnPhrases; facts: Facts };

/** What a rule hands back: the step, the value, and the bullet lines both share. */
export type Said = { do: string; done: string; kids: Doc["kids"] };

export const said = (c: Ctx, op: { do: (p: any) => string; done: (p: any) => string }, p: object, lines: (Doc | null)[] = []): Said => ({
	do: op.do(p),
	done: op.done(p),
	kids: bullets(c, lines),
});

export const bullets = (c: Ctx, docs: (Doc | null | undefined)[]): Doc["kids"] => docs.flatMap((d) => (d ? c.e.bullet(d) : []));

export const literalString = (n: N): string | null => {
	const u = unwrap(n);
	if (u?.type === "Literal" && typeof u.value === "string") return u.value;
	if (u?.type === "TemplateLiteral" && !u.expressions.length) return u.quasis[0].value.cooked;
	return null;
};

/** A number literal, negative ones included. */
export const literalNumber = (n: N): number | null => {
	const u = unwrap(n);
	if (u?.type === "Literal" && typeof u.value === "number") return u.value;
	if (u?.type === "UnaryExpression" && u.operator === "-" && unwrap(u.argument)?.type === "Literal" && typeof unwrap(u.argument).value === "number")
		return -unwrap(u.argument).value;
	return null;
};

export const literalBool = (n: N): boolean | null => {
	const u = unwrap(n);
	return u?.type === "Literal" && typeof u.value === "boolean" ? u.value : null;
};

export const isFn = (n: N) => ["ArrowFunctionExpression", "FunctionExpression"].includes(unwrap(n)?.type);

const keyName = (p: N): string | null => {
	if (p?.type !== "Property" || p.computed) return null;
	if (p.key.type === "Identifier") return p.key.name;
	if (p.key.type === "Literal") return String(p.key.value);
	return null;
};

const camel = (k: string) => k.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());

/** An object argument's properties by camelCase key (0.x spells them in snake_case), handing back whatever no rule took. */
export type Params = {
	node: N | null;
	take: (key: string) => N | undefined;
	/** The whole `key: value` property, for a generic bullet. */
	prop: (key: string) => N | undefined;
	has: (key: string) => boolean;
	/** Properties and spreads nobody took, in source order. */
	rest: () => N[];
};

export function params(n: N): Params {
	const u = unwrap(n);
	const props: N[] = u?.type === "ObjectExpression" ? u.properties : [];
	const byKey = new Map<string, N>();
	for (const p of props) {
		const k = keyName(p);
		if (k !== null) byKey.set(camel(k), p);
	}
	const taken = new Set<N>();
	return {
		node: u?.type === "ObjectExpression" ? u : null,
		has: (key) => byKey.has(key),
		take: (key) => {
			const p = byKey.get(key);
			if (!p || taken.has(p)) return undefined;
			taken.add(p);
			return p.shorthand ? p.key : p.value;
		},
		prop: (key) => byKey.get(key),
		rest: () => props.filter((p) => !taken.has(p)),
	};
}

/** Bullets for properties no rule took: `key: value`, or the spread. */
export const restLines = (c: Ctx, p: Params): Doc[] => p.rest().map((x) => (x.type === "SpreadElement" ? c.e.noun(x) : c.e.objectProp(x)));

/** A value whose words are only the thing itself: `customerId`, `customer.id`, `featureId`. */
const SAME: Record<string, RegExp> = {
	customer: /^(the )?customer('s)?( id)?$|^id$/i,
	feature: /^(the )?feature('s)?( id)?$/i,
	plan: /^(the )?(plan|product)('s)?( id)?$/i,
	entity: /^(the )?entity('s)?( id)?$/i,
	event: /^(the )?event( name)?$/i,
	lock: /^(the )?lock( id)?$/i,
	code: /^(the )?(referral |promo )?code$/i,
	model: /^(the )?model( id)?$/i,
};

/** Customer and entity IDs read quoted; feature, plan and event IDs read as names. */
const QUOTED = new Set(["customer", "entity", "lock", "code"]);

/** `"messages"` -> "the messages feature", `featureId` -> "the feature", `flags.ai` -> "the feature flags' AI". */
export function termOf(c: Ctx, kind: keyof typeof SAME, n: N | undefined): string {
	const t = c.say.terms[kind as keyof AutumnPhrases["terms"]] as Term;
	if (!n) return t.it;
	const id = literalString(n);
	if (id !== null) return t.id({ id: mk("l", QUOTED.has(kind) ? JSON.stringify(id) : id, JSON.stringify(id)) });
	const text = c.e.text(n);
	return SAME[kind]!.test(plain(text)) ? t.it : t.named({ value: text });
}

/** Who a call is about: the customer, or one of their entities. */
export const whoOf = (c: Ctx, customer: N | undefined, entity: N | undefined): string => {
	const who = termOf(c, "customer", customer);
	return entity ? c.say.terms.entityOf({ entity: termOf(c, "entity", entity), customer: who }) : who;
};

/** A literal amount with thousands separators, or the expression. */
export const amountOf = (c: Ctx, n: N): string => {
	const num = literalNumber(n);
	return num === null ? c.e.text(n) : mk("l", num.toLocaleString("en-US"), String(num));
};

/** `1 use`, `3 uses`, `max tokens of usage`; the sign is the caller's business. */
export function usesOf(c: Ctx, n: N | undefined, fallback = 1): { text: string; negative: boolean } {
	const num = n === undefined ? fallback : literalNumber(n);
	if (num === null) return { text: c.say.terms.uses({ amount: c.e.text(n), count: null }), negative: false };
	const abs = Math.abs(num);
	return { text: c.say.terms.uses({ amount: mk("l", abs.toLocaleString("en-US"), String(abs)), count: abs }), negative: num < 0 };
}

/** `{ name, email }` -> "their name and email"; anything else as itself. */
export function detailsOf(c: Ctx, n: N): string {
	const p = params(n);
	const keys = p.node ? p.rest().map((x) => keyName(x)) : [];
	if (!keys.length || keys.some((k) => k === null)) return c.e.text(n);
	return c.say.terms.their({ fields: c.e.g.list(keys.map((k) => c.e.prop(k!))) });
}

/** A list of literal IDs as one phrase: `"pro" and "storage"` -> "pro and storage". */
export const idList = (c: Ctx, n: N): string | null => {
	const u = unwrap(n);
	if (u?.type !== "ArrayExpression" || !u.elements.length) return null;
	const ids = u.elements.map((x: N) => literalString(x));
	if (ids.some((x: string | null) => x === null)) return null;
	return c.e.g.list(ids.map((x: string) => mk("l", x, JSON.stringify(x))));
};
