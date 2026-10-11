import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { isClient } from "./facts";
import { optionDocs, queryDoc } from "./query";
import { bool, type Ctx, fnLines, givenOf, isFn, keyText, objectArg, propOf, queryName, str } from "./shared";

/** A client method rule: the client object and the call's arguments. */
type ClientRule = (c: Ctx, args: N[], stmt: boolean) => Doc | null;

/** Which cached queries a filter matches. v5 passes `{ queryKey, … }`; v4 also took `(key, filters)`. */
export function queriesText(c: Ctx, args: N[]): { text: string; filters: N | null; rest: N[] } {
	const { e, say } = c;
	const [a, ...more] = args.map(unwrap);
	const builder = a?.type === "CallExpression" ? unwrap(a.callee) : null;
	if (builder?.type === "MemberExpression" && /Filter$/.test(builder.property.name ?? "")) return { text: e.text(a), filters: null, rest: more };
	const positional = a && !objectArg(a);
	const filters = positional ? objectArg(more[0]) : objectArg(a);
	const key = positional ? a : propOf(filters, "queryKey");
	const rest = positional ? more.slice(1) : more;
	const exact = bool(propOf(filters, "exact")) === true;
	let text: string;
	if (!key) text = say.client.every;
	else {
		const k = keyText(c, key);
		text = exact
			? (k.byName ? say.client.exactlyKeyedBy : say.client.exactly)({ key: k.text })
			: (k.byName ? say.client.matchingKeyedBy : say.client.matching)({ key: k.text });
	}
	const type = str(propOf(filters, "type"));
	if (type === "active") text = say.client.active({ queries: text });
	if (type === "inactive") text = say.client.inactive({ queries: text });
	if (bool(propOf(filters, "stale")) === true) text = say.client.stale({ queries: text });
	const pred = unwrap(propOf(filters, "predicate"));
	if (pred) {
		const ex = isFn(pred) ? e.lambdaExpr(pred) : null;
		text = say.client.where({ queries: text, condition: ex ? e.cond(ex).t : e.text(pred) });
	}
	return { text, filters, rest };
}

const filtersRule =
	(phrase: (c: Ctx) => (p: { queries: string }) => string): ClientRule =>
	(c, args) =>
		D(phrase(c)({ queries: queriesText(c, args).text }));

/** `setQueryData(key, value)` / `setQueryData(key, (old) => …)`. */
function setData(c: Ctx, target: string, updater: N | undefined, all: boolean): Doc | null {
	const { e, say } = c;
	if (!updater) return null;
	const u = unwrap(updater);
	if (isFn(u)) {
		const given = givenOf(e, u);
		const ex = e.lambdaExpr(u);
		if (ex) {
			const v = e.noun(ex);
			const p = all ? say.client.updateAllData({ queries: target, value: v.t, given }) : say.client.updateData({ query: target, value: v.t, given });
			return D(p, v.kids);
		}
		return D(all ? say.client.updateAllDataSteps({ queries: target, given }) : say.client.updateDataSteps({ query: target, given }), fnLines(e, u));
	}
	const v = e.noun(u);
	return D(all ? say.client.setAllData({ queries: target, value: v.t }) : say.client.setData({ query: target, value: v.t }), v.kids);
}

/** A method that takes a query's options (v5) or `(key, fn, options)` (v4), worded by `phrase`. */
const queryRule =
	(phrase: (c: Ctx) => (p: { query: string }) => string, kind: "query" | "infinite" = "query"): ClientRule =>
	(c, args) => {
		const q = queryDoc(c, args, kind);
		return q ? D(phrase(c)({ query: q.t }), q.kids) : null;
	};

export const CLIENT_METHODS: Record<string, ClientRule> = {
	invalidateQueries: (c, args) => {
		const { text, filters, rest } = queriesText(c, args);
		const rt = str(propOf(filters, "refetchType")) ?? (bool(propOf(objectArg(rest[0]), "refetchActive")) === false ? "none" : null);
		const refetch = rt === "none" ? "none" : rt === "all" ? "all" : rt && rt !== "active" ? "other" : "active";
		return D(c.say.client.invalidate({ queries: text, refetch }));
	},
	refetchQueries: filtersRule((c) => c.say.client.refetch),
	cancelQueries: filtersRule((c) => c.say.client.cancel),
	removeQueries: filtersRule((c) => c.say.client.remove),
	resetQueries: filtersRule((c) => c.say.client.reset),
	setQueryData: (c, [key, updater]) => (key ? setData(c, queryName(c, key), updater, false) : null),
	setQueriesData: (c, [filters, updater]) => (filters ? setData(c, queriesText(c, [filters]).text, updater, true) : null),
	getQueryData: (c, [key]) => (key ? D(c.say.client.getData({ query: queryName(c, key) })) : null),
	getQueriesData: (c, args) => D(c.say.client.getAllData({ queries: queriesText(c, args).text })),
	getQueryState: (c, [key]) => (key ? D(c.say.client.getState({ query: queryName(c, key) })) : null),
	prefetchQuery: queryRule((c) => c.say.client.prefetch),
	prefetchInfiniteQuery: queryRule((c) => c.say.client.prefetchInfinite, "infinite"),
	fetchQuery: queryRule((c) => c.say.client.fetch),
	fetchInfiniteQuery: queryRule((c) => c.say.client.fetchInfinite, "infinite"),
	ensureQueryData: queryRule((c) => c.say.client.ensure),
	ensureInfiniteQueryData: queryRule((c) => c.say.client.ensure, "infinite"),
	query: queryRule((c) => c.say.client.imperative),
	infiniteQuery: queryRule((c) => c.say.client.imperative, "infinite"),
	clear: (c, args) => (args.length ? null : D(c.say.client.clear)),
	isFetching: (c, args) => D(c.say.client.isFetching({ queries: args.length ? queriesText(c, args).text : null })),
	isMutating: (c) => D(c.say.client.isMutating),
	setQueryDefaults: (c, [key, opts]) => {
		if (!key || !opts) return null;
		const items = optionDocs(c, objectArg(opts)?.properties ?? [], "query");
		return D(
			c.say.client.setQueryDefaults({ queries: queriesText(c, [key]).text, details: c.say.options.details({ items: items.map((i) => i.t) }) }),
			items.flatMap((i) => i.kids),
		);
	},
	setMutationDefaults: (c, [key, opts]) => {
		if (!key || !opts) return null;
		const items = optionDocs(c, objectArg(opts)?.properties ?? [], "mutation");
		const k = keyText(c, key).text;
		return D(
			c.say.client.setMutationDefaults({ key: k, details: c.say.options.details({ items: items.map((i) => i.t) }) }),
			items.flatMap((i) => i.kids),
		);
	},
	getQueryCache: (c) => D(c.say.client.getQueryCache),
	getMutationCache: (c) => D(c.say.client.getMutationCache),
	mount: (c, args) => (args.length ? null : D(c.say.client.mount)),
	unmount: (c, args) => (args.length ? null : D(c.say.client.unmount)),
	resumePausedMutations: (c) => D(c.say.client.resumePausedMutations),
};

/** A query client method call, when the receiver is a query client. */
export function clientCall(c: Ctx, m: string, obj: N | null, args: N[], stmt: boolean): Doc | null {
	const rule = CLIENT_METHODS[m];
	if (!rule || !obj || !isClient(c.facts, obj)) return null;
	return rule(c, args, stmt);
}

/** `new QueryClient({ defaultOptions: { queries, mutations } })`. */
export function newClientDoc(c: Ctx, args: N[]): Doc {
	const { say } = c;
	const defaults = objectArg(propOf(objectArg(args[0]), "defaultOptions"));
	const parts: Doc[] = [];
	const q = objectArg(propOf(defaults, "queries"));
	if (q) parts.push(group(c, optionDocs(c, q.properties, "query"), say.client.queryDefaults));
	const m = objectArg(propOf(defaults, "mutations"));
	if (m) parts.push(group(c, optionDocs(c, m.properties, "mutation"), say.client.mutationDefaults));
	const kids = parts.flatMap((p) => p.kids);
	return D(say.client.create({ details: parts.length ? say.options.details({ items: parts.map((p) => p.t) }) : null }), kids);
}

const group = (c: Ctx, items: Doc[], phrase: (p: { details: string }) => string): Doc =>
	D(
		phrase({ details: c.e.g.list(items.map((i) => i.t)) }),
		items.flatMap((i) => i.kids),
	);
