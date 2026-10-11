import { D, type Doc, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import type { Link, OptionsHelper, UtilsMethod } from "./phrases";
import { bullets, type Ctx, fnLines, importedAs, isClientRoot, isFn, isUtilsRoot, keyOf, objectArg, optionItems, pathOf, propOf, rootOf } from "./shared";

const LINKS: Link[] = ["httpBatchLink", "httpLink", "httpBatchStreamLink", "httpSubscriptionLink", "loggerLink", "wsLink", "splitLink", "retryLink"];
export const UTILS: UtilsMethod[] = ["invalidate", "refetch", "cancel", "reset", "fetch", "prefetch", "ensureData", "getData", "setData"];
export const HELPERS: OptionsHelper[] = [
	"queryOptions",
	"infiniteQueryOptions",
	"mutationOptions",
	"subscriptionOptions",
	"queryKey",
	"pathKey",
	"queryFilter",
	"pathFilter",
	"mutationKey",
];
export const HOOKS = [
	"useQuery",
	"useSuspenseQuery",
	"useInfiniteQuery",
	"useSuspenseInfiniteQuery",
	"useMutation",
	"useSubscription",
	"usePrefetchQuery",
] as const;

/** One link in a client's `links` array. */
function linkText(c: Ctx, n: N): string {
	const { e, say } = c;
	const u = unwrap(n);
	const name = u?.type === "CallExpression" ? importedAs(c.facts, u.callee) : null;
	if (!name || !LINKS.includes(name as Link)) return e.text(n);
	const o = objectArg(u.arguments[0]);
	if (name === "splitLink") {
		const cond = unwrap(propOf(o, "condition"));
		const ex = cond && isFn(cond) ? e.lambdaExpr(cond) : null;
		const yes = propOf(o, "true");
		const no = propOf(o, "false");
		if (yes && no) return say.client.split({ condition: ex ? e.cond(ex).t : e.text(cond), yes: linkText(c, yes), no: linkText(c, no) });
	}
	const url = propOf(o, "url");
	const rest = optionItems(c, o, ["url"]).map((d) => d.t);
	return say.client.linkTo({
		link: say.client.links[name as Link],
		url: url ? e.text(url) : null,
		details: rest.length ? say.common.details({ items: rest }) : null,
	});
}

/** `createTRPCClient<AppRouter>({ links })`, `createTRPCReact<AppRouter>()`, `useTRPC()`. */
export function clientCreateDoc(c: Ctx, node: N, viaHooks = false): Doc | null {
	const u = unwrap(node);
	const name = viaHooks ? "createTRPCClient" : importedAs(c.facts, u?.callee);
	const { e, say } = c;
	const t = u.typeArguments?.params?.[0];
	const router = t ? mk("c", e.code(t)) : null;
	if (name === "createTRPCReact" || name === "createTRPCNext") return D(say.client.react({ router }));
	if (name === "createTRPCContext") return D(say.client.context({ router }));
	if (name === "useTRPC" || (!name && unwrap(u?.callee)?.name === "useTRPC")) return D(say.client.useTRPC);
	if (name !== "createTRPCClient" && name !== "createTRPCProxyClient") return null;
	const o = objectArg(u.arguments[0]);
	const links = unwrap(propOf(o, "links"));
	const items: string[] = [];
	if (links?.type === "ArrayExpression") items.push(say.client.sending({ links: e.g.list(links.elements.filter(Boolean).map((l: N) => linkText(c, l))) }));
	items.push(...optionItems(c, o, ["links"]).map((d) => d.t));
	return D(say.client.create({ router, details: items.length ? say.common.details({ items }) : null }));
}

/** `client.post.byId` -> "post.byId", when the chain starts at a tRPC client. */
function procPath(c: Ctx, obj: N | null, root: (n: N) => boolean): string | null {
	if (!obj) return null;
	const r = rootOf(obj);
	if (!root(r)) return null;
	const names = pathOf(obj);
	return names?.length ? names.join(".") : null;
}

/** `client.post.byId.query(input)`, `.mutate(input)`, `.subscribe(input, handlers)`. */
export function vanillaCall(c: Ctx, m: string, obj: N | null, args: N[], stmt: boolean): Doc | null {
	const path = procPath(c, obj, (r) => isClientRoot(c.facts, r) && unwrap(r)?.type === "Identifier");
	if (!path) return null;
	const { e, say } = c;
	const input = args[0] ? e.noun(args[0]) : null;
	const p = { path: mk("c", path), input: input?.t ?? null };
	if (m === "query") return D(say.client.query(p), input?.kids ?? []);
	if (m === "mutate") return D(stmt ? say.client.mutate(p) : say.client.mutateResult(p), input?.kids ?? []);
	if (m === "subscribe") return D(say.client.subscribe(p), [...(input?.kids ?? []), ...callbacks(c, args[1])]);
	return null;
}

const CALLBACKS = ["onSuccess", "onError", "onSettled", "onMutate", "onData"] as const;

function callbacks(c: Ctx, opts: N | undefined): ReturnType<typeof bullets> {
	const o = objectArg(opts);
	const docs = (o?.properties ?? []).flatMap((p: N) => {
		const k = keyOf(p) as (typeof CALLBACKS)[number] | null;
		if (!k || !CALLBACKS.includes(k)) return [];
		const fn = unwrap(p.value);
		const head = c.say.react[k];
		if (isFn(fn)) return [D(head({ given: c.e.paramList(fn.params) }), fnLines(c.e, fn, true))];
		return [D(c.say.common.option({ name: head({ given: null }), value: c.e.text(fn) }))];
	});
	return bullets(c.e, docs);
}

/** Query options other than callbacks: `enabled` reads as a condition, the rest as "label: value". */
function optionDetails(c: Ctx, opts: N | undefined): string[] {
	const o = objectArg(opts);
	return (o?.properties ?? []).flatMap((p: N) => {
		const k = keyOf(p);
		if (!k || CALLBACKS.includes(k as (typeof CALLBACKS)[number])) return [];
		if (k === "enabled") return [c.say.react.onlyWhen({ condition: c.e.cond(p.value).t })];
		return optionItems(c, { properties: [p] }).map((d) => d.t);
	});
}

/** `api.post.byId.useQuery(input, opts)` and the other React hooks. */
export function hookCall(c: Ctx, m: (typeof HOOKS)[number], obj: N | null, args: N[]): Doc | null {
	const path = procPath(c, obj, (r) => isClientRoot(c.facts, r));
	if (!path) return null;
	const { e, say } = c;
	const r = say.react;
	const mutation = m === "useMutation";
	const [input, opts] = mutation ? [undefined, args[0]] : args;
	const items: string[] = [];
	if (input) {
		const u = unwrap(input);
		const skipped = u?.type === "Identifier" && u.name === "skipToken";
		const cond = u?.type === "ConditionalExpression" && unwrap(u.alternate)?.name === "skipToken" ? u : null;
		if (skipped) items.push(r.skipped);
		else if (cond) items.push(r.input({ input: e.text(cond.consequent) }), r.onlyWhen({ condition: e.cond(cond.test).t }));
		else if (!(u?.type === "Identifier" && u.name === "undefined")) items.push(r.input({ input: e.text(input) }));
	}
	items.push(...optionDetails(c, opts));
	const details = items.length ? say.common.details({ items }) : null;
	const key = m === "useSuspenseInfiniteQuery" ? "useInfiniteQuery" : m;
	return D(r[key]({ path: mk("c", path), details }), callbacks(c, opts));
}

/** `utils.post.invalidate()`, `utils.post.byId.setData(input, updater)`. */
export function utilsCall(c: Ctx, m: UtilsMethod, obj: N | null, args: N[]): Doc | null {
	if (!obj || !isUtilsRoot(c.facts, rootOf(obj))) return null;
	const { e, say } = c;
	const names = pathOf(obj) ?? [];
	const r = say.react;
	const target = !names.length
		? r.everything
		: m === "invalidate" || m === "refetch" || m === "cancel" || m === "reset"
			? r.under({ path: mk("c", names.join(".")) })
			: r.exactly({ path: mk("c", names.join(".")) });
	const [input, value] = args;
	const inputText = input && !(unwrap(input)?.type === "Identifier" && unwrap(input).name === "undefined") ? e.text(input) : null;
	if (m === "setData") {
		if (!value) return null;
		const u = unwrap(value);
		const ex = isFn(u) ? e.lambdaExpr(u) : null;
		const v = ex ? e.noun(ex) : e.noun(u);
		return D(r.utils.setData({ target, input: inputText, value: v.t }), v.kids);
	}
	return D(r.utils[m]({ target, input: inputText, value: null }));
}

/** `trpc.post.byId.queryOptions(input)` from the TanStack integration, then passed to TanStack's own hooks. */
export function helperCall(c: Ctx, m: OptionsHelper, obj: N | null, args: N[]): Doc | null {
	const path = procPath(c, obj, (r) => isClientRoot(c.facts, r));
	if (!path) return null;
	const { e, say } = c;
	const input = args[0] && !isFn(args[0]) && !(m === "mutationOptions") ? e.text(args[0]) : null;
	const d = D(say.react.helpers[m]({ path: mk("c", path), input }));
	const opts = m === "mutationOptions" ? args[0] : args[1];
	const extra = optionDetails(c, opts);
	return D(extra.length ? say.common.withDetails({ subject: d.t, details: say.common.details({ items: extra }) }) : d.t, callbacks(c, opts));
}

/** `createPost.mutate(input)` on a variable holding `api.post.create.useMutation()`. */
export function mutateTracked(c: Ctx, obj: N | null, args: N[]): Doc | null {
	const u = unwrap(obj);
	if (u?.type !== "Identifier" || !c.facts.mutations.has(u.name)) return null;
	const input = args[0] ? c.e.noun(args[0]) : null;
	return D(c.say.react.run({ mutation: c.e.ref(u.name), input: input?.t ?? null }), input?.kids ?? []);
}
