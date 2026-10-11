import { D, type Doc, plain, vlen } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { isRequestOptions, type Rendered, renderOptions, renderParams } from "./params";
import { type Ctx, isObject, type StripeCall, stripeCall } from "./shared";

/** Methods that act on a collection or make something new, so their first argument is params rather than an ID. */
const NO_ID = new Set(["create", "list", "search", "createPreview", "retrieveUpcoming"]);

/** `["checkout", "sessions"]` -> "Checkout session" / "Checkout sessions". */
export function resourceNames(c: Ctx, path: string[]): { one: string; many: string } {
	const known = c.say.resources[path.join(".")];
	if (known) return known;
	const many = c.e.lex.humanize(path.at(-1)!);
	return { one: c.e.g.singular(many), many };
}

/** The object a call acts on: `sub.id` names `sub`; anything else is an ID. */
export function targetOf(c: Ctx, id: N, one: string): Doc {
	const { e, say } = c;
	const u = unwrap(id);
	if (u?.type === "MemberExpression" && !u.computed && u.property.name === "id") {
		const owner = e.noun(u.object);
		const words = plain(owner.t).toLowerCase();
		if (words === one.toLowerCase() || words.endsWith(` ${one.toLowerCase()}`)) return D(say.target.itself({ name: owner.t }), owner.kids);
		return D(say.target.named({ resource: one, name: owner.t }), owner.kids);
	}
	const v = e.noun(id);
	if (u?.type === "Literal") return D(say.target.named({ resource: one, name: v.t }), v.kids);
	return D(say.target.byId({ resource: one, id: v.t }), v.kids);
}

type Parts = { id: N | null; params: N | null; options: N | null };

/** Splits arguments by position, treating a trailing `{ idempotencyKey, stripeAccount }` as request options. */
function partsOf(call: StripeCall, args: N[]): Parts {
	const takesId = !NO_ID.has(call.method) && args[0] && !isObject(args[0]);
	const rest = takesId ? args.slice(1) : args;
	const [first, second] = rest;
	if (first && !second && isRequestOptions(first)) return { id: takesId ? args[0] : null, params: null, options: first };
	return { id: takesId ? args[0] : null, params: first ?? null, options: second ?? null };
}

const merge = (...rs: Rendered[]): Rendered => ({ head: rs.flatMap((r) => r.head), lines: rs.flatMap((r) => r.lines) });

/** `stripe.subscriptions.create({...})`: the billing action with its key params up front and the rest as bullets. */
export function resourceDoc(c: Ctx, { node, stmt }: { node: N; stmt: boolean }): Doc | null {
	const call = stripeCall(c.e, node);
	if (!call) return null;
	const { e, say } = c;
	const phrase = say.methods[call.method];
	if (!phrase || !Object.hasOwn(say.methods, call.method)) return null;
	const names = resourceNames(c, call.path);
	const parts = partsOf(call, node.arguments);
	const target = parts.id
		? targetOf(c, parts.id, names.one)
		: D(NO_ID.has(call.method) ? say.target.one({ resource: names.one }) : say.target.only({ resource: names.one }));
	const fromObject = unwrap(parts.id)?.type === "MemberExpression";
	const shown = call.method === "retrieve" && fromObject ? say.target.current({ target: target.t }) : target.t;
	const words = { target: shown, resource: names.one, resources: names.many };
	const action = stmt ? phrase.do(words) : phrase.done(words);
	const r = merge(renderParams(c, parts.params, { currency: null, headline: true }), renderOptions(c, parts.options));
	return layout(c, action, r, target.kids);
}

/** The headline, unless its details make it too long to read in one go; then they become bullets too. */
export function layout(c: Ctx, action: string, r: Rendered, kids: Doc["kids"] = []): Doc {
	const { e, say } = c;
	const full = say.headline({ action, details: r.head });
	const lines = r.lines.flatMap((l) => e.bullet(l));
	if (vlen(full) <= 120) return D(full, [...kids, ...lines]);
	return D(action, [...kids, ...r.head.flatMap((h) => e.bullet(D(h))), ...lines]);
}
