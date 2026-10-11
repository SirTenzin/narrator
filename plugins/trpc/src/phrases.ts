/** Arguments are already-rendered markup strings unless typed otherwise. */
type P<K extends string> = { [key in K]: string };
type Phrase<K extends string> = (p: P<K>) => string;

export type ProcedureKind = "query" | "mutation" | "subscription";

/** `TRPCError` codes, with the HTTP status tRPC sends for each. */
export type ErrorCode =
	| "PARSE_ERROR"
	| "BAD_REQUEST"
	| "UNAUTHORIZED"
	| "PAYMENT_REQUIRED"
	| "FORBIDDEN"
	| "NOT_FOUND"
	| "METHOD_NOT_SUPPORTED"
	| "TIMEOUT"
	| "CONFLICT"
	| "PRECONDITION_FAILED"
	| "PAYLOAD_TOO_LARGE"
	| "UNSUPPORTED_MEDIA_TYPE"
	| "UNPROCESSABLE_CONTENT"
	| "TOO_MANY_REQUESTS"
	| "CLIENT_CLOSED_REQUEST"
	| "INTERNAL_SERVER_ERROR"
	| "NOT_IMPLEMENTED"
	| "BAD_GATEWAY"
	| "SERVICE_UNAVAILABLE"
	| "GATEWAY_TIMEOUT";

/** Client links the plugin names. */
export type Link = "httpBatchLink" | "httpLink" | "httpBatchStreamLink" | "httpSubscriptionLink" | "loggerLink" | "wsLink" | "splitLink" | "retryLink";

/** Query-utils methods (`utils.post.invalidate()`) and the TanStack integration's helpers (`trpc.post.queryOptions()`). */
export type UtilsMethod = "invalidate" | "refetch" | "cancel" | "reset" | "fetch" | "prefetch" | "ensureData" | "getData" | "setData";
export type OptionsHelper =
	| "queryOptions"
	| "infiniteQueryOptions"
	| "mutationOptions"
	| "subscriptionOptions"
	| "queryKey"
	| "pathKey"
	| "queryFilter"
	| "pathFilter"
	| "mutationKey";

/** tRPC phrasebook. A translator implements this type in `src/<locale>.ts`. */
export type TrpcPhrases = {
	server: {
		/** `initTRPC.context<Ctx>().create(opts)`; `details` may be null. */
		init: (p: { details: string | null }) => string;
		context: Phrase<"type">;
		meta: Phrase<"type">;
		/** `t.router`, `t.procedure`, `t.middleware`, `t.mergeRouters`, `t.createCallerFactory` as values. */
		routerBuilder: string;
		procedureBuilder: string;
		middlewareBuilder: string;
		mergeBuilder: string;
		callerFactoryBuilder: string;
	};
	router: {
		/** `router({ … })`; its procedures follow as bullets. */
		noun: string;
		/** `mergeRouters(a, b)`. */
		merged: Phrase<"routers">;
		/** A sub-router mounted at a key: `post: postRouter`. */
		nested: Phrase<"path" | "router">;
		/** `createCallerFactory(appRouter)`. */
		callerFactory: Phrase<"router">;
		/** `createCaller(ctx)`. */
		caller: Phrase<"context">;
	};
	procedure: {
		/** One procedure: "answer the post.byId query". `path` is null for a procedure outside a router. */
		head: (p: { kind: ProcedureKind; path: string | null }) => string;
		/** A procedure built on another one than the plain base, e.g. "for signed-in users" from `protectedProcedure`. */
		using: Phrase<"base">;
		/** `.input(schema)`; several `.input` calls merge. */
		input: Phrase<"shape">;
		output: Phrase<"shape">;
		/** `.use(mw)` steps before the resolver. */
		after: Phrase<"middleware">;
		meta: Phrase<"meta">;
		/** A procedure builder that hasn't got its resolver yet: `t.procedure.use(isAuthed)`. */
		builder: (p: { base: string; details: string | null }) => string;
		/** Heading over the resolver's steps when it has details first. */
		resolve: string;
	};
	middleware: {
		/** `t.middleware(fn)` heading. */
		noun: string;
		/** `next()` inside a middleware. */
		next: string;
		/** `next({ ctx: { user } })`. */
		nextWith: Phrase<"context">;
	};
	errors: {
		/** `new TRPCError({ code, message })`; `message` may be null. */
		error: (p: { code: string; message: string | null }) => string;
		/** Each code with its article and HTTP status: "a not found (404)". */
		codes: Record<ErrorCode, string>;
	};
	adapters: {
		/** `createHTTPServer({ router, createContext })`. */
		httpServer: Phrase<"router">;
		/** `fetchRequestHandler({ endpoint, req, router })`. */
		fetch: (p: { router: string; endpoint: string | null }) => string;
		nextApi: Phrase<"router">;
		express: Phrase<"router">;
		standalone: Phrase<"router">;
		/** A context factory passed to an adapter. */
		withContext: Phrase<"handler" | "context">;
	};
	client: {
		/** `createTRPCClient<AppRouter>({ links })`; `router` and `details` may be null. */
		create: (p: { router: string | null; details: string | null }) => string;
		/** The client's links, as a detail. */
		sending: Phrase<"links">;
		/** `createTRPCReact<AppRouter>()`. */
		react: (p: { router: string | null }) => string;
		/** `useTRPC()` from the TanStack integration. */
		useTRPC: string;
		/** `createTRPCContext<AppRouter>()`. */
		context: (p: { router: string | null }) => string;
		/** `api.useUtils()` / v10 `trpc.useContext()`. */
		utils: string;
		links: Record<Link, string>;
		/** A link with its target URL; `details` may be null. */
		linkTo: (p: { link: string; url: string | null; details: string | null }) => string;
		/** `splitLink({ condition, true, false })`. */
		split: Phrase<"condition" | "yes" | "no">;
		/** `client.post.byId.query(input)` as a value; `input` may be null. */
		query: (p: { path: string; input: string | null }) => string;
		/** `client.post.add.mutate(input)` as a statement. */
		mutate: (p: { path: string; input: string | null }) => string;
		/** The same as a value. */
		mutateResult: (p: { path: string; input: string | null }) => string;
		subscribe: (p: { path: string; input: string | null }) => string;
	};
	react: {
		/** `api.post.byId.useQuery(input, opts)`; `details` may be null. */
		useQuery: (p: { path: string; details: string | null }) => string;
		useSuspenseQuery: (p: { path: string; details: string | null }) => string;
		useInfiniteQuery: (p: { path: string; details: string | null }) => string;
		useMutation: (p: { path: string; details: string | null }) => string;
		useSubscription: (p: { path: string; details: string | null }) => string;
		usePrefetchQuery: (p: { path: string; details: string | null }) => string;
		input: Phrase<"input">;
		/** `skipToken` as the input: the query is off. */
		skipped: string;
		onlyWhen: Phrase<"condition">;
		/** Heading over a mutation callback. */
		onSuccess: (p: { given: string | null }) => string;
		onError: (p: { given: string | null }) => string;
		onSettled: (p: { given: string | null }) => string;
		onMutate: (p: { given: string | null }) => string;
		onData: (p: { given: string | null }) => string;
		option: Phrase<"name" | "value">;
		/** Cache helpers on `utils`; `input` may be null. */
		utils: Record<UtilsMethod, (p: { target: string; input: string | null; value: string | null }) => string>;
		/** What a utils call targets: every tRPC query, a router's, or one procedure's (the phrase adds "cached" where it reads). */
		everything: string;
		under: Phrase<"path">;
		exactly: Phrase<"path">;
		/** TanStack integration helpers. */
		helpers: Record<OptionsHelper, (p: { path: string; input: string | null }) => string>;
	};
	common: {
		/** A subject followed by its parenthetical details. */
		withDetails: Phrase<"subject" | "details">;
		option: Phrase<"name" | "value">;
		details: (p: { items: string[] }) => string;
		yes: string;
		no: string;
	};
};
