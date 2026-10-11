import { describe, expect, test } from "bun:test";
import { narrate, narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { en, type TanStackQueryPhrases, tanstackQuery } from "../src";

const plugins = [tanstackQuery()];
const TQ = `import { useQuery, useMutation, useQueryClient, useInfiniteQuery, useSuspenseQuery, queryOptions, keepPreviousData, QueryClient, useQueries, useIsFetching } from "@tanstack/react-query";\n`;

/** Narrates with the plugin and asserts nothing fell back to raw code. */
const read = (code: string, opts: { plugins?: typeof plugins } = {}) => {
	const { text, fallbacks } = narrateWithStats(TQ + code, { plugins: opts.plugins ?? plugins, path: "snippet.tsx" });
	expect(fallbacks).toBe(0);
	return text;
};

describe("queries", () => {
	test("the docs' first query reads as its key, fetcher and the fields taken", () => {
		expect(
			read(
				`const { isPending, error, data } = useQuery({ queryKey: ["repoData"], queryFn: () => fetch("https://api.github.com/repos/TanStack/query").then((res) => res.json()) });`,
			),
		).toBe(
			[
				`Load the ["repoData"] query, and take whether it has no data yet, its error, and its data:`,
				`  • Fetched by fetch ("https://api.github.com/repos/TanStack/query"), then (with the result as response) response's JSON`,
			].join("\n"),
		);
	});

	test("enabled, staleTime and select become details", () => {
		expect(
			read(`const q = useQuery({ queryKey: ["todos", id], queryFn: () => fetchTodo(id), enabled: !!id, staleTime: 5 * 60 * 1000, select: (d) => d.items });`),
		).toBe(
			[
				`Let q be the ["todos", id] query:`,
				"  • Fetched by fetch todo (ID)",
				"  • Only when ID is set",
				"  • Fresh for 5 minutes",
				"  • Reshaped into d's items",
			].join("\n"),
		);
	});

	test("a key held in a variable reads by its name; renamed fields keep their local name", () => {
		expect(read(`const { data: todos } = useQuery({ queryKey, queryFn: fetchTodos, enabled: false });`)).toBe(
			"Load the query keyed by query key (fetched by fetch todos; only when refetched by hand), and take its data (as todos).",
		);
	});

	test("placeholder data, polling, retries and refetch flags", () => {
		const text = read(
			`const q = useQuery({ queryKey: ["projects", page], queryFn: () => fetchProjects(page), placeholderData: keepPreviousData, refetchInterval: 30_000, retry: false, refetchOnWindowFocus: false, gcTime: Infinity });`,
		);
		expect(text).toBe(
			[
				`Let q be the ["projects", page] query:`,
				"  • Fetched by fetch projects (page)",
				"  • Showing the previous data while new data loads",
				"  • Refetched every 30 seconds",
				"  • Not retried",
				"  • Not refetched when the window regains focus",
				"  • Kept in the cache forever",
			].join("\n"),
		);
	});

	test("a block-bodied fetcher keeps its steps; infinite queries read their paging", () => {
		const text = read(`const { data, fetchNextPage, hasNextPage } = useInfiniteQuery({
  queryKey: ["projects"],
  queryFn: async ({ pageParam }) => {
    const res = await fetch("/api/projects?cursor=" + pageParam);
    return res.json();
  },
  initialPageParam: 0,
  getNextPageParam: (lastPage) => lastPage.nextCursor,
});`);
		expect(text).toBe(
			[
				`Load the ["projects"] query, loaded page by page, and take its data, a way to load the next page, and whether there is a next page:`,
				"  • To fetch it, given page param:",
				`    Fetch ("/api/projects?cursor=" followed by page param), and call the result response.`,
				"    Give back response's JSON.",
				"  • Starting from page 0",
				"  • Next page: last page's next cursor",
			].join("\n"),
		);
	});

	test("queryOptions and suspense queries", () => {
		expect(
			read(`export const todoOptions = (id: number) => queryOptions({ queryKey: ["todos", id], queryFn: () => fetchTodo(id), staleTime: Infinity });`),
		).toContain(`the options for the ["todos", id] query (fetched by fetch todo (ID); never stale)`);
		expect(read(`const { data: todo } = useSuspenseQuery(todoOptions(5));`)).toBe(
			"Load the query described by todo options (5), waiting (suspended) until it has data, and take its data (as todo).",
		);
	});

	test("useQueries over a list reads as one query per item", () => {
		expect(read(`const results = useQueries({ queries: ids.map((id) => ({ queryKey: ["post", id], queryFn: () => fetchPost(id) })) });`)).toBe(
			`Let results be one query for each of IDs: the ["post", id] query (fetched by fetch post (ID)).`,
		);
	});
});

describe("versions", () => {
	const src = `const { isLoading } = useQuery({ queryKey: ["a"], queryFn: f, onSuccess: (data) => track(data) });`;
	test("isLoading and query callbacks read per major", () => {
		expect(read(src, { plugins: [tanstackQuery({ version: 5 })] })).toBe(
			`Load the ["a"] query (fetched by f; an onSuccess callback, which TanStack Query v5 no longer calls on queries), and take whether its first fetch is in flight.`,
		);
		expect(read(src, { plugins: [tanstackQuery({ version: 4 })] })).toBe(
			[`Load the ["a"] query, and take whether it has no data yet:`, "  • Fetched by f", "  • When it loads, given data:", "    Track (data)."].join("\n"),
		);
	});

	test("v4 positional arguments read like the object form", () => {
		expect(read(`const { data } = useQuery(["todos"], fetchTodos, { staleTime: 1000 });`)).toBe(
			`Load the ["todos"] query (fetched by fetch todos; fresh for 1 second), and take its data.`,
		);
		expect(read(`const m = useMutation(addTodo, { onSuccess: () => refresh() });`)).toBe(
			["Let m be a mutation:", "  • Running add todo", "  • When it succeeds:", "    Refresh."].join("\n"),
		);
	});
});

describe("mutations", () => {
	test("the optimistic-update recipe", () => {
		const text = read(`const qc = useQueryClient();
const addTodo = useMutation({
  mutationFn: (newTodo) => axios.post("/todos", newTodo),
  onMutate: async (newTodo) => {
    await qc.cancelQueries({ queryKey: ["todos"] });
    const previous = qc.getQueryData(["todos"]);
    qc.setQueryData(["todos"], (old) => [...old, newTodo]);
    return { previous };
  },
  onError: (err, newTodo, context) => {
    qc.setQueryData(["todos"], context.previous);
  },
  onSettled: () => qc.invalidateQueries({ queryKey: ["todos"] }),
});
addTodo.mutate({ title: "Do laundry" }, { onSuccess: () => navigate("/todos") });`);
		expect(text).toBe(
			[
				"Let qc be the query client.",
				"",
				"Let add todo be a mutation:",
				`  • Running post axios ("/todos" and new todo)`,
				"  • Before it runs, given new todo:",
				`    Cancel any fetch in flight for every cached query whose key starts with ["todos"].`,
				`    Let previous be the cached data of the ["todos"] query.`,
				`    Update the cached data of the ["todos"] query, calling the current data old, to a list of everything in old and new todo.`,
				"    Give back an object with previous.",
				"  • When it fails, given error, new todo, and context:",
				`    Set the cached data of the ["todos"] query to context's previous.`,
				"  • When it finishes, either way:",
				`    Mark every cached query whose key starts with ["todos"] as stale, so the ones in use refetch.`,
				"",
				`Run add todo with an object with title: "Do laundry":`,
				"  • When it succeeds:",
				`    Navigate ("/todos").`,
			].join("\n"),
		);
	});

	test("destructured mutate and isPending", () => {
		expect(read(`const { mutate, isPending: saving } = useMutation({ mutationFn: updateUser });\nmutate(user);`)).toBe(
			["Set up a mutation (running update user), and take a way to run it and whether it is running (as saving).", "Run the mutation with user."].join("\n"),
		);
	});

	test("mutateAsync as a statement and as a value", () => {
		expect(read(`const save = useMutation({ mutationFn: f });\nawait save.mutateAsync(v);\nconst r = await save.mutateAsync(v);`)).toContain(
			"Run save with v and wait for the result.",
		);
	});
});

describe("query client", () => {
	test("invalidation filters", () => {
		expect(read(`queryClient.invalidateQueries({ queryKey: ["todos", id], exact: true, refetchType: "none" });`)).toBe(
			`Mark the cached ["todos", id] query as stale, without refetching.`,
		);
		expect(read(`queryClient.invalidateQueries();`)).toBe("Mark every cached query as stale, so the ones in use refetch.");
		expect(read(`queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "todos" });`)).toContain("every cached query where");
		expect(read(`queryClient.invalidateQueries(["todos"]);`)).toBe(
			`Mark every cached query whose key starts with ["todos"] as stale, so the ones in use refetch.`,
		);
	});

	test("prefetch, fetch, clear and defaults", () => {
		expect(read(`await queryClient.prefetchQuery({ queryKey: ["user", id], queryFn: getUser });`)).toBe(
			`Prefetch the ["user", id] query (fetched by get user) into the cache.`,
		);
		expect(read(`const user = await queryClient.fetchQuery({ queryKey: ["user", id], queryFn: getUser });`)).toBe(
			`Let user be the data of the ["user", id] query (fetched by get user), from the cache if fresh, otherwise fetched.`,
		);
		expect(read(`queryClient.clear();`)).toBe("Clear the whole query cache.");
		expect(
			read(`export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60 * 1000, refetchOnWindowFocus: false, retry: 1 } } });`),
		).toBe(
			"Let query client be a new query client (queries by default: fresh for 1 minute, not refetched when the window regains focus, and retried up to 1 time).",
		);
	});

	test("router loaders reach the client through context", () => {
		expect(read(`const loader = ({ context }) => context.queryClient.ensureQueryData(todoOptions(1));`)).toContain(
			"the data of the query described by todo options (1), from the cache if there is any, otherwise fetched",
		);
	});
});

describe("guards", () => {
	test("same-named calls from other libraries are left alone", () => {
		const other = narrate(
			`import { useQuery, useMutation } from "convex/react";\nconst tasks = useQuery(api.tasks.get);\nconst { mutate } = useMutation(api.tasks.add);`,
			{ plugins },
		);
		expect(other).toBe(
			narrate(`import { useQuery, useMutation } from "convex/react";\nconst tasks = useQuery(api.tasks.get);\nconst { mutate } = useMutation(api.tasks.add);`),
		);
		const map = `const cache = new Map();\ncache.clear();\nform.reset();\nrouter.refetch();`;
		expect(narrate(map, { plugins })).toBe(narrate(map));
	});

	test("a query client method needs a query client", () => {
		const src = `import { useQuery } from "@tanstack/react-query";\nredis.clear();\nstore.setQueryData(["a"], 1);`;
		expect(narrate(src, { plugins })).toBe(narrate(src));
	});
});

describe("phrasebook", () => {
	test("English is complete against its own type", () => {
		const gaps = phrasebookGaps(en, en satisfies TanStackQueryPhrases);
		expect(gaps).toEqual({ missing: [], extra: [] });
	});
});
