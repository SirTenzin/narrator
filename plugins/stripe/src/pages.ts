import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { renderParams } from "./params";
import { resourceNames, targetOf } from "./resources";
import { type Ctx, isFn, isObject, stripeCall } from "./shared";

/** `stripe.customers.list({...})` / `.search(...)` with no ID: every match across all pages, its filters in parentheses. */
function allPages(c: Ctx, n: N): Doc | null {
	const call = stripeCall(c.e, n);
	const phrase = call && Object.hasOwn(c.say.methods, call.method) ? c.say.methods[call.method]?.all : null;
	if (!call || !phrase) return null;
	const { e, say } = c;
	const args = unwrap(n).arguments;
	const id = args[0] && !isObject(args[0]) ? args[0] : null;
	const names = resourceNames(c, call.path);
	const target = id ? targetOf(c, id, names.one) : null;
	const items = say.pages.paged({ items: phrase({ target: target?.t ?? "", resource: names.one, resources: names.many }) });
	const r = renderParams(c, id ? args[1] : args[0], { currency: null, headline: true });
	const filters = [...r.head, ...r.lines.filter((l) => !l.kids.length).map((l) => l.t)];
	const complex = r.lines.filter((l) => l.kids.length);
	const text = filters.length ? say.pages.filtered({ items, filters: filters.join(", ") }) : items;
	return D(text, [...(target?.kids ?? []), ...complex.flatMap((l) => e.bullet(l))]);
}

/** `stripe.customers.list().autoPagingEach(async (customer) => {...})`. */
export function autoPagingEachDoc(c: Ctx, { obj, args }: { obj: N | null; args: N[] }): Doc | null {
	const { e, say } = c;
	const items = obj ? allPages(c, obj) : null;
	const fn = unwrap(args[0]);
	if (!items || !isFn(fn)) return null;
	const item = fn.params[0] ? e.g.list(e.patternNames(fn.params[0])) : resourceNames(c, stripeCall(e, obj)!.path).one;
	const body =
		fn.body.type === "BlockStatement"
			? e.body(fn.body, 0)
			: e.bullet(unwrap(fn.body).type === "CallExpression" ? e.call(unwrap(fn.body), true) : e.noun(fn.body));
	return D(say.pages.eachOf({ item, items: items.t }), [...items.kids, ...body]);
}

/** `.autoPagingToArray({ limit })`. */
export function autoPagingToArrayDoc(c: Ctx, { obj, args }: { obj: N | null; args: N[] }): Doc | null {
	const { e, say } = c;
	const items = obj ? allPages(c, obj) : null;
	if (!items) return null;
	const o = unwrap(args[0]);
	const limit = o?.type === "ObjectExpression" ? o.properties.find((p: N) => p.key?.name === "limit")?.value : null;
	const text = limit ? say.pages.toArrayLimit({ items: items.t, limit: e.text(limit) }) : say.pages.toArray({ items: items.t });
	return D(text, items.kids);
}

/** `for await (const customer of stripe.customers.list())`: the SDK fetches every page as the loop goes. */
export function forAwaitStmt(c: Ctx, n: N, d: number): boolean {
	if (n.type !== "ForOfStatement" || !n.await) return false;
	const items = allPages(c, n.right);
	if (!items) return false;
	const { e, say } = c;
	const pat = n.left.declarations?.[0]?.id ?? n.left;
	e.emitDoc(d, D(`${say.pages.eachOf({ item: e.g.list(e.patternNames(pat)), items: items.t })}:`, items.kids), n);
	e.block(n.body, d + 1);
	return true;
}
