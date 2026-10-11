/** Arguments are already-rendered markup strings unless typed otherwise. */
type P<K extends string> = { [key in K]: string };
type Phrase<K extends string> = (p: P<K>) => string;
/** `n` is the plain number, for plural agreement. */
type Unit = (p: { count: string; n: number }) => string;

/** Fields of a query or mutation result that a component destructures. */
export type ResultField =
	| "data"
	| "error"
	| "status"
	| "fetchStatus"
	| "isPending"
	| "isLoading"
	| "isFetching"
	| "isRefetching"
	| "isError"
	| "isSuccess"
	| "isIdle"
	| "isPlaceholderData"
	| "isStale"
	| "isFetched"
	| "isLoadingError"
	| "isRefetchError"
	| "dataUpdatedAt"
	| "failureCount"
	| "refetch"
	| "fetchNextPage"
	| "fetchPreviousPage"
	| "hasNextPage"
	| "hasPreviousPage"
	| "isFetchingNextPage"
	| "isFetchingPreviousPage"
	| "mutate"
	| "mutateAsync"
	| "reset"
	| "variables"
	| "submittedAt"
	| "promise";

/** Query and mutation options with a reading of their own; any other key reads as "label: value". */
export type OptionKey =
	| "staleTime"
	| "gcTime"
	| "cacheTime"
	| "refetchInterval"
	| "refetchIntervalInBackground"
	| "refetchOnWindowFocus"
	| "refetchOnMount"
	| "refetchOnReconnect"
	| "retry"
	| "retryDelay"
	| "retryOnMount"
	| "networkMode"
	| "meta"
	| "structuralSharing"
	| "notifyOnChangeProps"
	| "suspense"
	| "keepPreviousData"
	| "maxPages"
	| "throwOnError"
	| "useErrorBoundary"
	| "experimental_prefetchInRender"
	| "scope";

/** TanStack Query phrasebook. A translator implements this type in `src/<locale>.ts`. */
export type TanStackQueryPhrases = {
	query: {
		/** A query named by a literal or computed key, kept as code: `the ["todos", id] query`. */
		keyed: Phrase<"key">;
		/** A query whose key is held in a variable: `the query keyed by todo key`. */
		keyedBy: Phrase<"key">;
		/** `useInfiniteQuery`: the same, loaded page by page. */
		paginated: Phrase<"query">;
		/** `useSuspenseQuery` and `suspense: true`. */
		suspending: Phrase<"query">;
		/** `useQuery(options)` with options built elsewhere (`queryOptions`, a tRPC helper). */
		fromOptions: Phrase<"options">;
		/** `useQueries({ queries })`. */
		several: string;
		/** `queryOptions({ … })` as a value. */
		options: Phrase<"query">;
		/** A query or mutation followed by its parenthetical details. */
		withDetails: Phrase<"subject" | "details">;
		/** `useIsFetching(filters?)`; `queries` may be null for every query. */
		fetchingCount: (p: { queries: string | null }) => string;
		/** `useIsMutating(filters?)`. */
		mutatingCount: (p: { mutations: string | null }) => string;
		/** `useMutationState(…)`. */
		mutationState: (p: { mutations: string | null }) => string;
		/** `usePrefetchQuery(…)` as a statement. */
		prefetchHook: Phrase<"query">;
	};
	/** How a query gets its data and when it refreshes. */
	options: {
		/** `queryFn: fetchTodos` or an expression body. */
		fetchedBy: Phrase<"fn">;
		/** Heading over a block-bodied `queryFn`; `given` lists its destructured context, or null. */
		fetchSteps: (p: { given: string | null }) => string;
		/** `enabled: cond`. */
		onlyWhen: Phrase<"condition">;
		/** `enabled: false`. */
		manualOnly: string;
		/** `staleTime: 5 * 60 * 1000`. */
		freshFor: Phrase<"duration">;
		/** `staleTime: Infinity`. */
		neverStale: string;
		/** `staleTime: "static"` (v5.80+): never refetched, even on invalidation. */
		static: string;
		/** `gcTime` / v4 `cacheTime`. */
		keptFor: Phrase<"duration">;
		keptForever: string;
		/** `refetchInterval: 30_000`. */
		pollEvery: Phrase<"duration">;
		/** `refetchInterval: (query) => …`. */
		pollWith: Phrase<"fn">;
		pollInBackground: string;
		/** `refetchOnWindowFocus` / `refetchOnMount` / `refetchOnReconnect`. */
		refetchOn: (p: { event: "focus" | "mount" | "reconnect"; mode: "never" | "always" | "stale" | "other"; value: string }) => string;
		retryTimes: (p: { count: string; n: number }) => string;
		noRetry: string;
		retryForever: string;
		retryWhen: Phrase<"fn">;
		retryDelay: Phrase<"delay">;
		/** `select: (data) => data.items`; `param` names the data. */
		select: Phrase<"value">;
		selectWith: Phrase<"fn">;
		/** Heading over a block-bodied `select`. */
		selectSteps: (p: { given: string | null }) => string;
		/** `placeholderData: keepPreviousData` and v4 `keepPreviousData: true`. */
		keepPrevious: string;
		placeholder: Phrase<"value">;
		initialData: Phrase<"value">;
		initialPageParam: Phrase<"value">;
		/** `getNextPageParam: (lastPage) => lastPage.nextCursor`. */
		nextPage: Phrase<"value">;
		previousPage: Phrase<"value">;
		/** Heading over a block-bodied page-param function. */
		nextPageSteps: (p: { given: string | null }) => string;
		previousPageSteps: (p: { given: string | null }) => string;
		/** `throwOnError` / v4 `useErrorBoundary`. */
		throwOnError: string;
		throwOnErrorWhen: Phrase<"fn">;
		suspense: string;
		/** v4 `onSuccess` / `onError` / `onSettled` on a query. */
		onLoad: (p: { given: string | null }) => string;
		onLoadError: (p: { given: string | null }) => string;
		onLoadSettled: (p: { given: string | null }) => string;
		/** The same callbacks on a v5 query, where TanStack Query no longer calls them. */
		ignoredCallback: Phrase<"name">;
		/** "label: value" for any other option. */
		option: Phrase<"name" | "value">;
		names: Record<OptionKey, string>;
		/** Boolean option values. */
		yes: string;
		no: string;
		forever: string;
		/** Several details joined into one parenthetical. */
		details: (p: { items: string[] }) => string;
		/** `queries: [...]` in `useQueries`: one item per query. */
		eachOf: Phrase<"list" | "item">;
	};
	mutation: {
		/** `useMutation(…)` without a key. */
		noun: string;
		/** A mutation destructured as `mutate`, referred back to. */
		the: string;
		/** With `mutationKey`. */
		keyed: Phrase<"key">;
		/** `useMutation(options)` with options built elsewhere. */
		fromOptions: Phrase<"options">;
		/** `mutationOptions({ … })`. */
		options: Phrase<"mutation">;
		/** `mutationFn: (vars) => api.post(…)`. */
		runs: Phrase<"fn">;
		/** Heading over a block-bodied `mutationFn`. */
		runSteps: (p: { given: string | null }) => string;
		/** Heading over `onMutate`, `onSuccess`, `onError`, `onSettled`. */
		before: (p: { given: string | null }) => string;
		onSuccess: (p: { given: string | null }) => string;
		onError: (p: { given: string | null }) => string;
		onSettled: (p: { given: string | null }) => string;
		/** A callback passed by name: `onSuccess: refresh`. */
		callbackBy: Phrase<"heading" | "fn">;
		/** `mutation.mutate(vars)` as a statement; `vars` may be null. */
		run: (p: { mutation: string; vars: string | null }) => string;
		/** `await mutation.mutateAsync(vars)`. */
		runAndWait: (p: { mutation: string; vars: string | null }) => string;
		reset: Phrase<"mutation">;
	};
	result: {
		/** `const { data, isLoading } = useQuery(…)`. */
		load: Phrase<"query" | "fields">;
		/** `const { mutate } = useMutation(…)`. */
		setUp: Phrase<"mutation" | "fields">;
		/** One destructured field; `local` is null when it keeps the field's own name. */
		field: (p: { meaning: string; local: string | null }) => string;
		/** Field meanings; `isLoading` depends on the major version. */
		fields: Record<Exclude<ResultField, "isLoading">, string>;
		isLoadingV4: string;
		isLoadingV5: string;
		/** `isLoading` when the major version is unknown. */
		isLoadingAny: string;
		/** Where a mutation's fields mean something else: `isPending` is "running". */
		mutationFields: { data: string; isPending: string; isLoading: string };
		/** `await mutation.mutateAsync(vars)` as a value. */
		resultOf: (p: { mutation: string; vars: string | null }) => string;
		/** `query.refetch()` and `fetchNextPage()`. */
		refetch: Phrase<"query">;
		fetchNextPage: Phrase<"query">;
		fetchPreviousPage: Phrase<"query">;
	};
	client: {
		/** `useQueryClient()`. */
		noun: string;
		/** `new QueryClient({ defaultOptions })`; `details` may be null. */
		create: (p: { details: string | null }) => string;
		/** Default options for every query or every mutation, already joined. */
		queryDefaults: Phrase<"details">;
		mutationDefaults: Phrase<"details">;
		/** Which cached queries a filter matches: by key prefix, exactly, or every one. */
		matching: Phrase<"key">;
		matchingKeyedBy: Phrase<"key">;
		exactly: Phrase<"key">;
		exactlyKeyedBy: Phrase<"key">;
		every: string;
		/** `predicate: (query) => …` narrowing a filter. */
		where: Phrase<"queries" | "condition">;
		/** `type: "active" | "inactive"` and `stale: true` narrowing a filter. */
		active: Phrase<"queries">;
		inactive: Phrase<"queries">;
		stale: Phrase<"queries">;
		invalidate: (p: { queries: string; refetch: "active" | "all" | "none" | "other" }) => string;
		refetch: Phrase<"queries">;
		cancel: Phrase<"queries">;
		remove: Phrase<"queries">;
		reset: Phrase<"queries">;
		/** `setQueryData(key, value)`. */
		setData: Phrase<"query" | "value">;
		/** `setQueryData(key, (old) => …)`; `given` names the current data. */
		updateData: (p: { query: string; value: string; given: string | null }) => string;
		updateDataSteps: (p: { query: string; given: string | null }) => string;
		/** `setQueriesData(filters, …)`. */
		setAllData: Phrase<"queries" | "value">;
		updateAllData: (p: { queries: string; value: string; given: string | null }) => string;
		updateAllDataSteps: (p: { queries: string; given: string | null }) => string;
		getData: Phrase<"query">;
		getAllData: Phrase<"queries">;
		getState: Phrase<"query">;
		/** `prefetchQuery(…)` as a statement. */
		prefetch: Phrase<"query">;
		prefetchInfinite: Phrase<"query">;
		/** `fetchQuery(…)` as a value: cached data when fresh, else fetched. */
		fetch: Phrase<"query">;
		fetchInfinite: Phrase<"query">;
		/** `ensureQueryData(…)`: cached data if there is any, else fetched. */
		ensure: Phrase<"query">;
		/** `fetchQuery(…)` / `queryClient.query(…)` used as a statement. */
		warm: Phrase<"query">;
		/** `ensureQueryData(…)` used as a statement. */
		ensureStmt: Phrase<"query">;
		/** `queryClient.query(…)` (v5.90+): the imperative fetch. */
		imperative: Phrase<"query">;
		clear: string;
		isFetching: (p: { queries: string | null }) => string;
		isMutating: string;
		setQueryDefaults: Phrase<"queries" | "details">;
		setMutationDefaults: Phrase<"key" | "details">;
		getQueryCache: string;
		getMutationCache: string;
		/** `queryClient.mount()` / `unmount()`. */
		mount: string;
		unmount: string;
		resumePausedMutations: string;
	};
	common: {
		units: { milliseconds: Unit; seconds: Unit; minutes: Unit; hours: Unit };
	};
};
