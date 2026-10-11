import { describe, expect, test } from "bun:test";
import { zod } from "@usenarrator/plugin-zod";
import { narrate, narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { en, type TrpcPhrases, trpc } from "../src";

const plugins = [zod(), trpc()];
const SERVER = `import { initTRPC, TRPCError } from "@trpc/server";\nimport { z } from "zod";\n`;

/** Narrates with the plugin and asserts nothing fell back to raw code. */
const read = (code: string) => {
	const { text, fallbacks } = narrateWithStats(code, { plugins, path: "snippet.tsx" });
	expect(fallbacks).toBe(0);
	return text;
};

describe("server", () => {
	test("initTRPC and the exported builders", () => {
		expect(
			read(`${SERVER}const t = initTRPC.context<Context>().create({ transformer: superjson });
export const router = t.router;
export const publicProcedure = t.procedure;`),
		).toBe(
			[
				"Let t be a tRPC setup (context: Context; transformer: superjson).",
				"Let router be the tRPC router builder.",
				"Let public procedure be the base tRPC procedure.",
			].join("\n"),
		);
	});

	test("a router reads as its procedures with dotted paths, inputs and resolvers", () => {
		const text = read(`${SERVER}export const appRouter = router({
  greeting: publicProcedure.input(z.object({ name: z.string() })).query(({ input }) => \`Hello \${input.name}\`),
  post: router({
    byId: publicProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
      const post = await ctx.db.post.findUnique({ where: { id: input.id } });
      if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found" });
      return post;
    }),
    create: protectedProcedure.input(z.object({ title: z.string().min(1) })).mutation(({ ctx, input }) => ctx.db.post.create({ data: input })),
  }),
  user: userRouter,
});`);
		expect(text).toBe(
			[
				"Let app router be a tRPC router with these procedures:",
				"  • Answer the greeting query (takes an object with name):",
				`    Give back "Hello {input's name}".`,
				"  • Answer the post.byId query (takes an object with ID):",
				"    Find the DB's post unique (where: an object with ID: input's ID), and call the result post.",
				`    If post is missing, fail with a not found (404) error with the message "Post not found".`,
				"    Give back post.",
				"  • Handle the post.create mutation (built on protected procedure; takes an object with title):",
				"    Create the DB's post (data: input), and give back the result.",
				"  • Under user, the procedures of user router",
			].join("\n"),
		);
	});

	test("middleware: auth checks and next({ ctx })", () => {
		const text = read(`${SERVER}const t = initTRPC.context<Context>().create();
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { session: ctx.session } });
});
export const protectedProcedure = t.procedure.use(isAuthed);`);
		expect(text).toBe(
			[
				"Let t be a tRPC setup (context: Context).",
				"",
				"Let is authed be a tRPC middleware:",
				"  If the session's user is missing, fail with an unauthorized (401) error.",
				"  Let the procedure run, adding an object with session: the session to the context.",
				"",
				"Let protected procedure be a procedure built on the base tRPC procedure (after is authed).",
			].join("\n"),
		);
	});

	test("subscriptions and adapters", () => {
		const text = read(`${SERVER}import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
const onAdd = publicProcedure.subscription(async function* ({ signal }) { yield 1; });
const handler = (req: Request) => fetchRequestHandler({ endpoint: "/api/trpc", req, router: appRouter, createContext });`);
		expect(text).toContain("Let on add be a subscription:");
		expect(text).toContain("the response from app router at /api/trpc, building each request's context with create context");
	});
});

describe("clients", () => {
	test("the vanilla client and its links", () => {
		const text = read(`import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
const client = createTRPCClient<AppRouter>({ links: [loggerLink(), httpBatchLink({ url: "http://localhost:3000" })] });
const user = await client.user.byId.query({ id: "1" });
await client.post.create.mutate({ title: "hi" });`);
		expect(text).toBe(
			[
				`Let client be a tRPC client for AppRouter (sending a log of every request and batched HTTP requests to "http://localhost:3000").`,
				`Let user be the result of the user.byId query with an object with ID: "1".`,
				`Run the post.create mutation with an object with title: "hi".`,
			].join("\n"),
		);
	});

	test("React Query hooks and cache helpers", () => {
		const text = read(`import { createTRPCReact } from "@trpc/react-query";
export const api = createTRPCReact<AppRouter>();
function Posts({ id }) {
  const utils = api.useUtils();
  const { data } = api.post.byId.useQuery({ id }, { enabled: !!id });
  const create = api.post.create.useMutation({
    onSuccess: async () => {
      await utils.post.invalidate();
    },
  });
  utils.post.byId.setData({ id }, (old) => ({ ...old, title }));
}`);
		expect(text).toBe(
			[
				"Let API be tRPC React hooks for AppRouter.",
				"",
				"To posts, given ID:",
				"  Let utils be the tRPC cache helpers.",
				"  From the post.byId query (input: an object with ID; only when ID is set), take data.",
				"  Let create be the post.create mutation:",
				"    • When it succeeds:",
				"      Mark every post query as stale, so the ones in use refetch.",
				"  Set the cached data of the post.byId query with an object with ID to old, but with title set to title.",
			].join("\n"),
		);
	});

	test("skipToken turns a query off until its input exists", () => {
		expect(
			read(
				`import { skipToken } from "@tanstack/react-query";\nimport { api } from "~/trpc/react";\nconst q = api.user.byId.useQuery(id ? { id } : skipToken);`,
			),
		).toBe("Let q be the user.byId query (input: an object with ID; only when ID is set).");
	});

	test("the TanStack integration's options helpers", () => {
		const text = read(`import { useTRPC } from "@trpc/tanstack-react-query";
const trpc = useTRPC();
const opts = trpc.post.byId.queryOptions({ id });
const key = trpc.post.queryKey();
const filter = trpc.post.pathFilter();`);
		expect(text).toBe(
			[
				"Let trpc be the tRPC query helpers.",
				"Let options be the options for the post.byId query with an object with ID.",
				"Let key be the cache key of the post query.",
				"Let filter be every cached post query.",
			].join("\n"),
		);
	});
});

describe("guards", () => {
	test("without tRPC, look-alike calls are left alone", () => {
		const src = `const api = makeApi();\nconst r = router({ a: 1 });\nconst x = api.users.list.query({ id });\nconst q = db.select().query(fn);`;
		expect(narrate(src, { plugins })).toBe(narrate(src, { plugins: [zod()] }));
	});
});

describe("phrasebook", () => {
	test("English is complete against its own type", () => {
		expect(phrasebookGaps(en, en satisfies TrpcPhrases)).toEqual({ missing: [], extra: [] });
	});
});
