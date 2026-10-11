import { D, type Doc, mk, plain } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, isObject, keyName, kidsOf, literalString, literalValue } from "./shared";

/** Params split into headline details ("for the customer X") and bullet lines. */
export type Rendered = { head: string[]; lines: Doc[] };

const AMOUNT_KEYS = new Set([
	"amount",
	"unit_amount",
	"unit_amount_decimal",
	"flat_amount",
	"application_fee_amount",
	"amount_to_capture",
	"amount_off",
	"amount_due",
	"amount_paid",
	"minimum_amount",
	"maximum_amount",
	"custom_unit_amount",
]);
const HEAD_AMOUNTS = new Set(["amount", "unit_amount"]);
const UNIX_KEYS = new Set(["billing_cycle_anchor", "proration_date", "frozen_time", "expires_at", "redeem_by", "start_date", "end_date", "cancel_at"]);

/** The lowercase currency literal in params, if any. */
function currencyOf(o: N): string | null {
	for (const p of o.properties) if (keyName(p) === "currency") return literalString(p.value)?.toLowerCase() ?? null;
	return null;
}

export function unitOf(c: Ctx, currency: string | null): string {
	return (currency && c.say.minorUnits[currency]) || c.say.unknownUnit;
}

/** `"latest_invoice.payment_intent"` -> "latest invoice's payment intent". */
function expandPath(c: Ctx, path: string): string {
	const parts = path.split(".").filter((s, i) => !(i === 0 && s === "data"));
	return parts.reduce((acc, s, i) => (i === 0 ? c.e.prop(s) : `${c.e.g.possessive(acc)} ${c.e.prop(s)}`), "");
}

const code = (s: string) => mk("l", `"${s}"`);

/** One subscription or checkout item: `{ price, quantity }` reads inline; anything richer becomes a block. */
function itemDoc(c: Ctx, el: N, currency: string | null): Doc {
	const { e, say } = c;
	const o = unwrap(el);
	if (o?.type !== "ObjectExpression") return e.noun(el);
	const keys = o.properties.map(keyName);
	const get = (k: string) => o.properties.find((p: N) => keyName(p) === k)?.value;
	if (keys.every((k: string | null) => k === "price" || k === "quantity") && get("price")) {
		const price = e.noun(get("price"));
		const q = get("quantity");
		return D(q ? say.params.itemWithQuantity({ price: price.t, quantity: e.text(q) }) : say.params.item({ price: price.t }), price.kids);
	}
	const r = renderParams(c, o, { currency, headline: false });
	if (r.lines.length === 1) return r.lines[0]!;
	return D(
		`${say.params.itemBlock}:`,
		r.lines.flatMap((l) => e.bullet(l)),
	);
}

function itemsDoc(c: Ctx, v: N, currency: string | null): { head?: string; line?: Doc } {
	const { e, say } = c;
	const u = unwrap(v);
	if (u?.type !== "ArrayExpression") return { head: say.params.itemsFrom({ value: e.text(v) }) };
	const items = u.elements.filter(Boolean).map((x: N) => itemDoc(c, x, currency));
	if (items.every((i: Doc) => !i.kids.length && !i.t.endsWith(":"))) return { head: say.params.items({ items: e.g.list(items.map((i: Doc) => i.t)) }) };
	return {
		line: D(
			`${e.prop("items")}:`,
			items.flatMap((i: Doc) => e.bullet(i)),
		),
	};
}

function recurringText(c: Ctx, o: N): string | null {
	const { e, say } = c;
	let interval: string | null = null;
	let count: N = null;
	for (const p of o.properties) {
		const k = keyName(p);
		if (k === "interval") interval = literalString(p.value);
		else if (k === "interval_count") count = p.value;
	}
	if (!interval || !Object.hasOwn(say.params.interval, interval)) return null;
	const n = literalValue(count);
	if (!count || n === 1) return say.params.recurring({ every: say.params.interval[interval as keyof typeof say.params.interval] });
	return say.params.recurring({ every: say.params.everyN({ count: e.text(count), unit: interval }) });
}

/** A plain `key: value` line, read the way the engine reads call arguments (`true` flags by name, shorthand by value). */
function fieldDoc(c: Ctx, p: N): Doc {
	const { e } = c;
	const k = keyName(p);
	const v = unwrap(p.value);
	if (!k || p.type !== "Property") return e.objectProp(p);
	if (v?.type === "Literal" && typeof v.value === "boolean") return D(v.value ? e.prop(k) : e.say.expressions.args.flagOff({ key: e.prop(k) }));
	const text = e.noun(p.value);
	if (plain(text.t) === e.lex.humanize(k)) return text;
	return e.objectProp(p);
}

type Scope = { currency: string | null; headline: boolean };

/** Reads a Stripe params object, pulling the details a reader cares about into plain phrases. */
export function renderParams(c: Ctx, node: N, scope: Scope): Rendered {
	const { e, say } = c;
	const o = unwrap(node);
	const out: Rendered = { head: [], lines: [] };
	if (!o) return out;
	if (o.type !== "ObjectExpression") {
		const v = e.noun(node);
		out.lines.push(D(say.params.settingsIn({ value: v.t }), v.kids));
		return out;
	}
	const currency = currencyOf(o) ?? scope.currency;
	const hasHeadAmount = o.properties.some((p: N) => HEAD_AMOUNTS.has(keyName(p) ?? "") && !isObject(p.value));
	const head = (text: string) => (scope.headline ? out.head.push(text) : out.lines.push(D(text)));
	for (const p of o.properties) {
		if (p.type === "SpreadElement") {
			const v = e.noun(p.argument);
			out.lines.push(D(say.params.spread({ value: v.t }), v.kids));
			continue;
		}
		const k = keyName(p);
		const v = unwrap(p.value);
		const lit = literalValue(v);
		const str = literalString(v);
		const field = () => out.lines.push(fieldDoc(c, p));
		if (!k) {
			field();
			continue;
		}
		if (k === "customer" && v.type !== "ObjectExpression") head(say.params.customer({ value: e.text(v) }));
		else if (k === "price" && v.type !== "ObjectExpression") head(say.params.price({ value: e.text(v) }));
		else if (k === "product" && v.type !== "ObjectExpression") head(say.params.product({ value: e.text(v) }));
		else if (k === "items" || k === "line_items") {
			const r = itemsDoc(c, v, currency);
			if (r.head) head(r.head);
			if (r.line) out.lines.push(r.line);
		} else if (AMOUNT_KEYS.has(k) && v.type !== "ObjectExpression") {
			const amount = e.text(v);
			const unit = unitOf(c, currency);
			if (k === "amount_off") out.lines.push(D(say.params.amountOff({ amount, unit })));
			else if (HEAD_AMOUNTS.has(k) && scope.headline) out.head.push(say.params.amount({ amount, unit }));
			else out.lines.push(D(say.params.amountField({ key: e.prop(k), amount, unit })));
		} else if (k === "currency" && str) {
			const cur = mk("l", str.toUpperCase());
			if (hasHeadAmount && scope.headline) out.head.push(say.params.currency({ currency: cur }));
			else out.lines.push(D(say.params.field({ key: e.prop(k), value: cur })));
		} else if (k === "recurring" && v.type === "ObjectExpression" && recurringText(c, v)) {
			head(recurringText(c, v)!);
			const rest = v.properties.filter((x: N) => !["interval", "interval_count"].includes(keyName(x) ?? ""));
			for (const x of rest) out.lines.push(e.objectProp(x));
		} else if (k === "price_data" && v.type === "ObjectExpression") {
			const r = renderParams(c, v, { currency, headline: false });
			out.lines.push(
				D(
					`${say.params.inlinePrice}:`,
					r.lines.flatMap((l) => e.bullet(l)),
				),
			);
		} else if (k === "trial_period_days") out.lines.push(D(say.params.trialDays({ days: e.text(v) })));
		else if (k === "trial_end" && str === "now") out.lines.push(D(say.params.trialEndNow));
		else if (k === "trial_end" && str === null) out.lines.push(D(say.params.trialEnd({ value: e.text(v) })));
		else if (k === "cancel_at_period_end" && typeof lit === "boolean") out.lines.push(D(say.params.cancelAtPeriodEnd[lit ? "on" : "off"]));
		else if (k === "cancel_at" && str === null && lit !== null) out.lines.push(D(say.params.cancelAt({ value: e.text(v) })));
		else if (UNIX_KEYS.has(k) && str === null && lit !== null && v.type !== "ObjectExpression") {
			const t = e.noun(v);
			out.lines.push(D(say.params.unixTime({ key: e.prop(k), value: t.t }), t.kids));
		} else if (k === "proration_behavior" && str && Object.hasOwn(say.params.proration, str))
			out.lines.push(D(say.params.proration[str as keyof typeof say.params.proration]));
		else if (k === "collection_method" && str && Object.hasOwn(say.params.collection, str))
			out.lines.push(D(say.params.collection[str as keyof typeof say.params.collection]));
		else if (k === "days_until_due") out.lines.push(D(say.params.daysUntilDue({ days: e.text(v) })));
		else if (k === "expand" && v.type === "ArrayExpression" && v.elements.every((x: N) => literalString(x) !== null)) {
			const paths = v.elements.map((x: N) => expandPath(c, literalString(x)!));
			out.lines.push(D(say.params.expand({ paths: e.g.list(paths) })));
		} else if (k === "expand" && v.type !== "ArrayExpression") out.lines.push(D(say.params.expandFrom({ value: e.text(v) })));
		else if (k === "limit") {
			const count = e.text(v);
			out.lines.push(D(/per page$/i.test(plain(count)) ? say.params.limitNamed({ count }) : say.params.limit({ count })));
		} else if (k === "starting_after" || k === "ending_before") {
			const value = e.text(v);
			const after = k === "starting_after";
			if (plain(value) === e.lex.humanize(k)) out.lines.push(D(after ? say.params.nextPage : say.params.previousPage));
			else out.lines.push(D((after ? say.params.startingAfter : say.params.endingBefore)({ value })));
		} else if (k === "query") head(say.params.query({ query: str !== null ? code(str) : e.text(v) }));
		else if (k === "mode" && str && Object.hasOwn(say.params.mode, str)) head(say.params.mode[str as keyof typeof say.params.mode]);
		else if (k === "percent_off") out.lines.push(D(say.params.percentOff({ percent: e.text(v) })));
		else if (k === "duration" && (str === "once" || str === "forever")) out.lines.push(D(say.params.duration[str]));
		else if (k === "duration" && str === "repeating") continue;
		else if (k === "duration_in_months" && typeof lit === "number") out.lines.push(D(say.params.durationMonths({ months: e.text(v) })));
		else field();
	}
	return out;
}

const OPTION_KEYS = new Set(["idempotencyKey", "stripeAccount", "apiVersion", "apiKey", "maxNetworkRetries", "timeout", "stripeContext", "host", "headers"]);

/** An object whose keys are all request options (`{ idempotencyKey }`), as opposed to API params. */
export const isRequestOptions = (n: N) => {
	const o = unwrap(n);
	return o?.type === "ObjectExpression" && o.properties.length > 0 && o.properties.every((p: N) => OPTION_KEYS.has(keyName(p) ?? ""));
};

export function renderOptions(c: Ctx, node: N): Rendered {
	const { e, say } = c;
	const out: Rendered = { head: [], lines: [] };
	const o = unwrap(node);
	if (!o) return out;
	if (!isObject(o)) {
		const v = e.noun(node);
		out.lines.push(D(say.params.settingsIn({ value: v.t }), v.kids));
		return out;
	}
	for (const p of o.properties) {
		const k = keyName(p);
		if (k === "idempotencyKey") out.lines.push(D(say.options.idempotencyKey({ key: e.text(p.value) })));
		else if (k === "stripeAccount") out.head.push(say.options.stripeAccount({ account: e.text(p.value) }));
		else if (k === "apiVersion") out.lines.push(D(say.options.apiVersion({ version: e.text(p.value) })));
		else {
			const d = p.type === "SpreadElement" ? e.noun(p) : e.objectProp(p);
			out.lines.push(D(d.t, kidsOf(d)));
		}
	}
	return out;
}
