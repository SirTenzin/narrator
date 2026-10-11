import { D, type Doc } from "@usenarrator/core";
import { type CallRule, definePlugin, type Engine, type StmtRule, type TsPlugin } from "@usenarrator/lang-ts";
import { CLIENT_METHODS, clientCall, newClientDoc, queriesText } from "./client";
import { en } from "./en";
import { type Facts, factsReader, importedAs, PACKAGES } from "./facts";
import type { TanStackQueryPhrases as __PluginPhrases, TanStackQueryPhrases } from "./phrases";
import { mutationDoc, type QueryKind, queriesDoc, queryDoc } from "./query";
import { actionCall, destructureStatement } from "./results";
import type { Ctx } from "./shared";

export { en } from "./en";
export type { OptionKey, ResultField, TanStackQueryPhrases } from "./phrases";

export type TanStackQueryOptions = {
	/** Pin the major version for APIs whose meaning changed in v5 (`isLoading`, query `onSuccess`). Defaults to the package's declared version, else reads both. */
	version?: 4 | 5;
};

type Rule = CallRule<TanStackQueryPhrases>;

const QUERY_HOOKS: Record<string, QueryKind> = {
	useQuery: "query",
	createQuery: "query",
	injectQuery: "query",
	useInfiniteQuery: "infinite",
	createInfiniteQuery: "infinite",
	injectInfiniteQuery: "infinite",
	useSuspenseQuery: "suspense",
	useSuspenseInfiniteQuery: "suspenseInfinite",
};
const ACTIONS = ["mutate", "mutateAsync", "reset", "refetch", "fetchNextPage", "fetchPreviousPage"];

function majorOf(e: Engine): 4 | 5 | null {
	for (const p of PACKAGES) {
		const m = e.libraryMajor(p);
		if (m !== null) return p === "react-query" || m < 5 ? 4 : 5;
	}
	return null;
}

/** TanStack Query (tanstack.com/query) v5 and v4: query and mutation hooks, `queryOptions`, and the query client. */
export const tanstackQuery = ({ version }: TanStackQueryOptions = {}): TsPlugin<TanStackQueryPhrases> => {
	const read = factsReader();
	const ctx = (e: Engine, say: TanStackQueryPhrases): Ctx => ({ e, say, facts: read(e), major: version ?? majorOf(e) });
	/** A rule for a TanStack Query export, guarded so a same-named function from elsewhere is left alone. */
	const hook =
		(name: string, f: (c: Ctx, p: Parameters<Rule>[0]) => Doc | null): Rule =>
		(p) => {
			const c = ctx(p.e, p.say);
			return importedAs(c.facts, p.node.callee) === name ? f(c, p) : null;
		};

	const calls: Record<string, Rule> = {};
	for (const [name, kind] of Object.entries(QUERY_HOOKS)) calls[name] = hook(name, (c, { args }) => queryDoc(c, args, kind));
	for (const name of ["useMutation", "createMutation", "injectMutation"]) calls[name] = hook(name, (c, { args }) => mutationDoc(c, args));
	for (const name of ["useQueries", "useSuspenseQueries"]) calls[name] = hook(name, (c, { args }) => queriesDoc(c, args));
	calls.queryOptions = hook("queryOptions", (c, { args }) => queryDoc(c, args, "query", (q) => c.say.query.options({ query: q })));
	calls.infiniteQueryOptions = hook("infiniteQueryOptions", (c, { args }) => queryDoc(c, args, "infinite", (q) => c.say.query.options({ query: q })));
	calls.mutationOptions = hook("mutationOptions", (c, { args }) => mutationDoc(c, args, (m) => c.say.mutation.options({ mutation: m })));
	calls.usePrefetchQuery = hook("usePrefetchQuery", (c, { args }) => {
		const q = queryDoc(c, args, "query");
		return q && D(c.say.query.prefetchHook({ query: q.t }), q.kids);
	});
	calls.usePrefetchInfiniteQuery = hook("usePrefetchInfiniteQuery", (c, { args }) => {
		const q = queryDoc(c, args, "infinite");
		return q && D(c.say.query.prefetchHook({ query: q.t }), q.kids);
	});
	calls.useQueryClient = hook("useQueryClient", (c) => D(c.say.client.noun));
	calls.useIsFetching = hook("useIsFetching", (c, { args }) => D(c.say.query.fetchingCount({ queries: args.length ? queriesText(c, args).text : null })));
	calls.useIsMutating = hook("useIsMutating", (c, { args }) => D(c.say.query.mutatingCount({ mutations: args.length ? c.e.text(args[0]) : null })));
	calls.useMutationState = hook("useMutationState", (c, { args }) => D(c.say.query.mutationState({ mutations: args.length ? c.e.text(args[0]) : null })));
	calls["new QueryClient"] = hook("QueryClient", (c, { args }) => newClientDoc(c, args));

	for (const m of Object.keys(CLIENT_METHODS)) calls[`*.${m}`] = ({ e, say, obj, args, stmt, node }) => clientCall(ctx(e, say), m, obj, args, stmt) ?? null;
	for (const m of ACTIONS) {
		const prev = calls[`*.${m}`];
		calls[`*.${m}`] = (p) => actionCall(ctx(p.e, p.say), m, p.obj, p.args, p.stmt) ?? prev?.(p) ?? null;
		calls[m] = ({ e, say, args, stmt }) => actionCall(ctx(e, say), m, null, args, stmt);
	}

	const render = (c: Ctx) => (call: Parameters<Rule>[0]["node"]) => {
		const rule = calls[call.callee?.name];
		return rule ? (rule({ node: call, args: call.arguments, obj: null, e: c.e, stmt: false, say: c.say }) as Doc | null) : null;
	};
	const destructure: StmtRule<TanStackQueryPhrases> = ({ node, e, d, say }) => {
		if (node.type !== "VariableDeclaration") return false;
		const c = ctx(e, say);
		return c.facts.active && destructureStatement(c, node, d, render(c));
	};

	return definePlugin<TanStackQueryPhrases>({
		name: "tanstack-query",
		library: { name: "@tanstack/react-query", versions: ">=4 <6" },
		phrases: { en },
		calls,
		statements: [destructure],
	});
};

export type { Facts };

declare module "@usenarrator/core" {
	interface PluginPhrases {
		"tanstack-query": __PluginPhrases;
	}
}
