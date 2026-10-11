import { describe, expect, test } from "bun:test";
import { createNarrator, renderText } from "@usenarrator/core";
import { type TsPlugin, typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en as english } from "@usenarrator/locale-en";
import { narrate, narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { en, type HonoPhrases, hono } from "../src";

const plugins = [hono()];

/** Narrates with the Hono plugin and asserts nothing fell back to raw code. */
const read = (code: string) => {
	const { text, fallbacks } = narrateWithStats(code, { plugins });
	expect(fallbacks).toBe(0);
	return text;
};

const HONO = `import { Hono } from "hono";\n`;

describe("apps and routes", () => {
	test("the hello-world app reads as an API description", () => {
		expect(read(`${HONO}const app = new Hono();\napp.get("/", (c) => c.text("Hono!"));\nexport default app;`)).toBe(
			[`Create a Hono app as app.`, `Answer GET / with the text "Hono!".`, `Export app as this module's request handler.`].join("\n"),
		);
	});

	test("a handler with steps keeps every request read and reply", () => {
		const text = read(`${HONO}const app = new Hono();
app.get("/users/:id", async (c) => {
	const id = c.req.param("id");
	const page = c.req.query("page");
	const auth = c.req.header("Authorization");
	if (!user) return c.notFound();
	c.header("X-Id", id);
	c.status(201);
	return c.json({ id, page }, 201);
});`);
		expect(text).toBe(
			[
				"Create a Hono app as app.",
				"",
				"Answer GET /users/:id:",
				"  Let ID be the id path parameter.",
				"  Let page be the page query parameter.",
				"  Let auth be the Authorization request header.",
				"  If user is missing, reply with the not-found response.",
				"  Set the X-Id response header to ID.",
				"  Set the response status to 201 Created.",
				"  Reply with an object with ID and page as JSON (status 201 Created).",
			].join("\n"),
		);
	});

	test("Env generics and options become creation details", () => {
		const text = read(`${HONO}type Bindings = { DB: D1Database };
const app = new Hono<{ Bindings: Bindings; Variables: { user: User; requestId: string } }>({ strict: false });`);
		expect(text).toContain("Create a Hono app as app (bindings: Bindings; context variables: user and requestId; trailing slashes ignored).");
		expect(read(`${HONO}const app = new Hono<AppEnv>();`)).toBe("Create a Hono app as app (environment: AppEnv).");
	});

	test("basePath and chained route groups", () => {
		const text = read(`${HONO}const api = new Hono().basePath("/api");
const books = new Hono()
	.get("/", (c) => c.json("list books"))
	.post("/", (c) => c.json("create a book", 201))
	.get("/:id", (c) => c.json(\`get \${c.req.param("id")}\`));
api.route("/books", books);`);
		expect(text).toBe(
			[
				"Create a Hono app as API (every route under /api).",
				"",
				"Create a Hono app as books:",
				`  • Answer GET / with "list books" as JSON`,
				`  • Answer POST / with "create a book" as JSON (status 201 Created)`,
				`  • Answer GET /:id with "get {the id path parameter}" as JSON`,
				"",
				"Mount books under /books.",
			].join("\n"),
		);
	});

	test("a chain without paths reuses the previous path", () => {
		const text = read(`${HONO}const app = new Hono();
app.get("/endpoint", (c) => c.text("GET /endpoint")).post((c) => c.text("POST /endpoint")).delete((c) => c.text("DELETE /endpoint"));`);
		expect(text).toContain(
			[
				`Answer GET /endpoint with the text "GET /endpoint".`,
				`Answer POST /endpoint with the text "POST /endpoint".`,
				`Answer DELETE /endpoint with the text "DELETE /endpoint".`,
			].join("\n"),
		);
	});

	test("on, all, custom methods and path lists", () => {
		const text = read(`${HONO}const app = new Hono();
app.on("PURGE", "/cache", (c) => c.text("purged"));
app.on(["PUT", "DELETE"], "/post", (c) => c.text("ok"));
app.on("GET", ["/hello", "/ja/hello"], (c) => c.text("hi"));
app.all("/hello", (c) => c.text("Any Method /hello"));`);
		expect(text).toContain(`Answer PURGE /cache with the text "purged".`);
		expect(text).toContain(`Answer PUT or DELETE /post with the text "ok".`);
		expect(text).toContain(`Answer GET /hello and /ja/hello with the text "hi".`);
		expect(text).toContain(`Answer any request to /hello with the text "Any Method /hello".`);
	});

	test("an RPC route variable reads as the app with its routes", () => {
		const text = read(`${HONO}const app = new Hono();
const route = app.post("/posts", (c) => c.json({ ok: true }, 201)).get("/posts", (c) => c.json(posts));
export type AppType = typeof route;`);
		expect(text).toContain("Let route be app, with these routes:");
		expect(text).toContain("  • Answer POST /posts with an object with ok: true as JSON (status 201 Created)");
		expect(text).toContain("  • Answer GET /posts with posts as JSON");
	});

	test("responses: html, redirect, body, headers and init objects", () => {
		const text = read(`${HONO}const app = new Hono();
app.get("/page", (c) => c.html("<h1>Hello</h1>"));
app.get("/old", (c) => c.redirect("/new", 301));
app.get("/empty", (c) => c.body(null, 204));
app.get("/custom", (c) => c.text("hi", 200, { "X-Message": "Hello" }));
app.get("/init", (c) => c.json(data, { status: 202, headers: { "Cache-Control": "no-store" } }));`);
		expect(text).toContain(`Answer GET /page with "<h1>Hello</h1>" as HTML.`);
		expect(text).toContain(`Answer GET /old with a redirect to "/new" (status 301 Moved Permanently).`);
		expect(text).toContain("Answer GET /empty with an empty body (status 204 No Content).");
		expect(text).toContain(`Answer GET /custom with the text "hi" (status 200 OK; headers: X-Message: "Hello").`);
		expect(text).toContain(`Answer GET /init with data as JSON (status 202 Accepted; headers: Cache-Control: "no-store").`);
	});

	test("errors, not-found and HTTPException", () => {
		const text = read(`${HONO}import { HTTPException } from "hono/http-exception";
const app = new Hono();
app.post("/auth", async (c) => {
	throw new HTTPException(401, { message: "Unauthorized" });
});
app.notFound((c) => c.text("Custom 404 Message", 404));
app.onError((err, c) => {
	console.error(err);
	return c.text("Custom Error Message", 500);
});`);
		expect(text).toContain(`Answer POST /auth:\n  Fail with an HTTP 401 Unauthorized error with the message "Unauthorized".`);
		expect(text).toContain(`When no route matches:\n  Reply with the text "Custom 404 Message" (status 404 Not Found).`);
		expect(text).toContain(
			`When a request fails:\n  Log an error (with error).\n  Reply with the text "Custom Error Message" (status 500 Internal Server Error).`,
		);
	});

	test("context variables, bindings and background work", () => {
		const text = read(`${HONO}const app = new Hono();
app.get("/me", async (c) => {
	c.set("message", "Hono is cool!!");
	const message = c.get("message");
	c.executionCtx.waitUntil(logVisit(message));
	return c.text(message);
});`);
		expect(text).toContain(`Store "Hono is cool!!" as the message context variable.`);
		expect(text).toContain("Let message be the message context variable.");
		expect(text).toContain("Let log visit (message) finish in the background.");
		expect(text).toContain("Reply with the text message.");
	});

	test("request bodies", () => {
		const text = read(`${HONO}const app = new Hono();
app.post("/entry", async (c) => {
	const json = await c.req.json();
	const form = await c.req.parseBody();
	const tags = c.req.queries("tags");
	const all = c.req.query();
	return c.json({ json, form, tags, all });
});`);
		expect(text).toContain("Let JSON be the request body, parsed as JSON.");
		expect(text).toContain("Let form be the request body, parsed as a form.");
		expect(text).toContain("Let tags be every value of the tags query parameter.");
		expect(text).toContain("Let all be all query parameters.");
	});

	test("an app factory and a test request", () => {
		const text = read(`${HONO}import { createFactory } from "hono/factory";
const factory = createFactory();
const app = factory.createApp();
const res = await app.request("/hello");`);
		expect(text).toContain("Let factory be a factory for Hono apps and handlers.");
		expect(text).toContain("Create a Hono app as app.");
		expect(text).toContain("Let response be the response app gives to a test request for /hello.");
	});
});

describe("middleware", () => {
	test("built-in middleware reads by what it does, options kept in full", () => {
		const text = read(`${HONO}import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { basicAuth } from "hono/basic-auth";
import { bearerAuth } from "hono/bearer-auth";
import { jwt } from "hono/jwt";
import { secureHeaders } from "hono/secure-headers";
import { etag } from "hono/etag";
import { timing } from "hono/timing";
import { compress } from "hono/compress";
import { cache } from "hono/cache";
import { timeout } from "hono/timeout";
const app = new Hono();
app.use(logger());
app.use("/api/*", cors({ origin: "http://example.com", allowMethods: ["POST", "GET", "OPTIONS"], maxAge: 600, credentials: true }));
app.use("/admin/*", basicAuth({ username: "hono", password: "acoolproject" }));
app.use("/api/*", bearerAuth({ token }));
app.use("/auth/*", jwt({ secret: "it-is-very-secret", alg: "HS256" }));
app.use(secureHeaders(), etag(), timing(), compress());
app.get("*", cache({ cacheName: "my-app", cacheControl: "max-age=3600" }));
app.use("/slow/*", timeout(5000));`);
		expect(text).toBe(
			[
				"Create a Hono app as app.",
				"Run request logging on every request.",
				`Run CORS (allowed origins: "http://example.com"; allowed methods: "POST", "GET", and "OPTIONS"; max age: 600; credentials allowed: yes) on requests to /api/*.`,
				`Run basic auth (username: "hono"; password: "acoolproject") on requests to /admin/*.`,
				"Run bearer-token auth (token: token) on requests to /api/*.",
				`Run JWT auth (secret: "it-is-very-secret"; algorithm: "HS256") on requests to /auth/*.`,
				"Run security headers, ETag headers, Server-Timing headers, and response compression on every request.",
				`Answer GET * with response caching (cache name: "my-app"; Cache-Control: "max-age=3600").`,
				"Run a 5 seconds time limit on requests to /slow/*.",
			].join("\n"),
		);
	});

	test("inline middleware reads as its steps, around next()", () => {
		const text = read(`${HONO}const app = new Hono();
app.use(async (c, next) => {
	const start = Date.now();
	await next();
	c.header("X-Response-Time", \`\${Date.now() - start}\`);
});`);
		expect(text).toBe(
			[
				"Create a Hono app as app.",
				"",
				"For every request:",
				"  Let start be the current time.",
				"  Let the next handler run.",
				"  Set the X-Response-Time response header to the current time minus start.",
			].join("\n"),
		);
	});

	test("createMiddleware and route-level middleware", () => {
		const text = read(`${HONO}import { createMiddleware } from "hono/factory";
const app = new Hono();
const requireUser = createMiddleware<{ Variables: { user: User } }>(async (c, next) => {
	const user = await getUser(c.req.header("Authorization"));
	if (!user) return c.json({ error: "Unauthorized" }, 401);
	c.set("user", user);
	await next();
});
app.get("/me", requireUser, (c) => c.json(c.get("user")));`);
		expect(text).toContain("Let require user be custom middleware:");
		expect(text).toContain("  Get user (the Authorization request header) → user.");
		expect(text).toContain(`  If user is missing, reply with an object with error: "Unauthorized" as JSON (status 401 Unauthorized).`);
		expect(text).toContain("  Store user as the user context variable.");
		expect(text).toContain("  Let the next handler run.");
		expect(text).toContain("Answer GET /me with the user context variable as JSON, after require user.");
	});

	test("factory handlers spread into a route keep their middleware", () => {
		const text = read(`${HONO}import { createFactory } from "hono/factory";
import { logger } from "hono/logger";
const factory = createFactory<Env>();
const app = new Hono();
const handlers = factory.createHandlers(logger(), (c) => c.json({ ok: true }));
app.get("/api", ...handlers);
app.get("/inline", ...factory.createHandlers(logger(), (c) => c.text("hi")));`);
		expect(text).toContain("Let factory be a factory for Hono apps and handlers (environment: Env).");
		expect(text).toContain("Let handlers be route handlers that first run request logging:\n  Reply with an object with ok: true as JSON.");
		expect(text).toContain("Answer GET /api with everything in handlers.");
		expect(text).toContain(`Answer GET /inline with the text "hi", after request logging.`);
	});
});

describe("validation", () => {
	test("zValidator names the part of the request and the schema", () => {
		const text = read(`${HONO}import { zValidator } from "@hono/zod-validator";
const app = new Hono();
app.post("/posts", zValidator("json", postSchema), (c) => {
	const { title, body } = c.req.valid("json");
	return c.json({ title, body }, 201);
});
app.get("/search", zValidator("query", searchSchema), (c) => c.json(search(c.req.valid("query"))));`);
		expect(text).toContain("Answer POST /posts, after a check of the JSON body against post schema:");
		expect(text).toContain("  From the validated JSON body, take title and body.");
		expect(text).toContain(
			"Answer GET /search with search (the validated query parameters) as JSON, after a check of the query parameters against search schema.",
		);
	});

	test("a validator hook and a custom validator keep their steps", () => {
		const text = read(`${HONO}import { zValidator } from "@hono/zod-validator";
import { validator } from "hono/validator";
const app = new Hono();
app.post("/a", zValidator("form", schema, (result, c) => {
	if (!result.success) return c.text("Invalid!", 400);
}), (c) => c.text("ok"));
app.post("/b", validator("form", (value, c) => {
	const body = value["body"];
	if (!body || typeof body !== "string") return c.text("Invalid!", 400);
	return { body };
}), (c) => c.json({ message: "Created!" }, 201));`);
		expect(text).toContain(
			[
				`Answer POST /a with the text "ok", after a check of the form data against schema:`,
				"  • a check of the form data against schema:",
				"    • after the check:",
				`      If result's success is missing, reply with the text "Invalid!" (status 400 Bad Request).`,
			].join("\n"),
		);
		expect(text).toContain(`Answer POST /b with an object with message: "Created!" as JSON (status 201 Created), after a custom check of the form data:`);
		expect(text).toContain(`    If body is missing or body is not text, reply with the text "Invalid!" (status 400 Bad Request).`);
	});
});

describe("streaming", () => {
	test("server-sent events", () => {
		const text = read(`${HONO}import { streamSSE } from "hono/streaming";
const app = new Hono();
app.get("/sse", async (c) => {
	return streamSSE(c, async (stream) => {
		let id = 0;
		while (true) {
			await stream.writeSSE({ data: message, event: "time-update", id: String(id++) });
			await stream.sleep(1000);
		}
	});
});`);
		expect(text).toContain(
			[
				"Answer GET /sse:",
				"  Reply with a stream of server-sent events:",
				"    Let ID start as 0.",
				"    Keep repeating (until something stops it):",
				`      Send an event with data: message, event: "time-update", and ID: increase ID by 1 as text.`,
				"      Wait 1 second.",
			].join("\n"),
		);
	});

	test("text and byte streams", () => {
		const text = read(`${HONO}import { stream, streamText } from "hono/streaming";
const app = new Hono();
app.get("/text", (c) =>
	streamText(c, async (stream) => {
		stream.onAbort(() => { console.log("Aborted!"); });
		await stream.writeln("Hello");
		await stream.sleep(250);
		await stream.write("Hono!");
	}),
);
app.get("/bytes", (c) => stream(c, async (s) => { await s.pipe(readable); }));`);
		expect(text).toContain(
			[
				"Answer GET /text:",
				"  Reply with a text stream:",
				"    When the client disconnects:",
				`      Log "Aborted!".`,
				`    Write "Hello" to the stream as a line.`,
				"    Wait 250 milliseconds.",
				`    Write "Hono!" to the stream.`,
			].join("\n"),
		);
		expect(text).toContain("Answer GET /bytes:\n  Reply with a byte stream:\n    Pipe readable into the stream.");
	});
});

describe("RPC client", () => {
	test("hc and typed calls read as HTTP requests with their full paths", () => {
		const text = read(`import { hc } from "hono/client";
const client = hc<AppType>("http://localhost:8787/");
const res = await client.posts.$post({ form: { title: "Hello", body: "Hono is a cool project" } });
await client.posts[":id"].$get({ param: { id: "123" }, query: { page: "1" } });
const url = client.api.index.$url();`);
		expect(text).toBe(
			[
				`Let client be a typed API client for AppType at "http://localhost:8787/".`,
				`Let response be the response to POST /posts from client, sending the form data (title: "Hello" and body: "Hono is a cool project").`,
				`Send GET /posts/:id through client, with the path parameters (ID: "123") and the query parameters (page: "1").`,
				"Let URL be the URL of /api on client.",
			].join("\n"),
		);
	});
});

describe("cookies and serving", () => {
	test("cookie helpers", () => {
		const text = read(`${HONO}import { getCookie, setCookie, deleteCookie } from "hono/cookie";
const app = new Hono();
app.get("/cookie", (c) => {
	const yummy = getCookie(c, "yummy_cookie");
	setCookie(c, "delicious_cookie", "macha", { path: "/", secure: true, httpOnly: true, sameSite: "Strict" });
	deleteCookie(c, "old_cookie");
	return c.text("ok");
});`);
		expect(text).toContain("Let yummy be the yummy_cookie cookie.");
		expect(text).toContain(`Set the delicious_cookie cookie to "macha" (path: "/"; HTTPS only: yes; hidden from scripts: yes; same-site policy: "Strict").`);
		expect(text).toContain("Delete the old_cookie cookie.");
	});

	test("export default object, Node server, Bun and adapters", () => {
		expect(read(`${HONO}const app = new Hono();\nexport default { port: 3000, fetch: app.fetch };`)).toContain("Serve app on port 3000.");
		const node = read(`${HONO}import { serve } from "@hono/node-server";
const app = new Hono();
serve({ fetch: app.fetch, port: 8787 }, (info) => {
	console.log(\`Listening on http://localhost:\${info.port}\`);
});`);
		expect(node).toContain(`Serve app on port 8787:\n  • once the server is listening:\n    Log "Listening on http://localhost:{info's port}".`);
		expect(read(`${HONO}const app = new Hono();\nBun.serve({ fetch: app.fetch, port: 3000, hostname: "0.0.0.0" });`)).toContain(
			`Serve app on port 3000 (hostname: "0.0.0.0").`,
		);
		expect(read(`${HONO}const app = new Hono();\nDeno.serve(app.fetch);`)).toContain("Serve app.");
		const vercel = read(`${HONO}import { handle } from "hono/vercel";\nconst app = new Hono();\nexport const GET = handle(app);\nexport default handle(app);`);
		expect(vercel).toContain("Let get be app as a Vercel handler.");
		expect(vercel).toContain("Export app as this module's Vercel handler.");
	});
});

describe("guards", () => {
	test("Express routes and other `get`/`json`/`use` calls are left alone", () => {
		const code = `import express from "express";
const app = express();
app.get("/users", (req, res) => { res.json({ ok: true }); });
app.use(cors());
const v = cache.get("x");
function f(c) { return c.json(); }
export default app;`;
		expect(narrate(code, { plugins })).toBe(narrate(code));
	});

	test("in a Hono file, look-alike names that aren't Hono's stay generic", () => {
		const code = `${HONO}import { logger } from "./logger";
const cache = new Map<string, string>();
const hit = cache.get("k");
logger();
await api.get("/users");
await api.post("/users", body);
stream.write("x");
await other.posts.$get();`;
		const without = narrate(code).split("\n").slice(1);
		const withPlugin = narrate(code, { plugins }).split("\n").slice(1);
		expect(withPlugin).toEqual(without);
	});

	test("a route call with no handler is not a route", () => {
		const code = `${HONO}const app = new Hono();\napp.get("/users");`;
		expect(narrate(code, { plugins }).split("\n").at(-1)).toBe(narrate(code).split("\n").at(-1));
	});
});

describe("phrasebook", () => {
	test("rules take every word from the phrasebook", () => {
		const shouted: HonoPhrases = {
			...en,
			routes: { ...en.routes, answer: ({ method, path }) => `RESPONDER A ${method} ${path}` },
			response: { ...en.response, reply: ({ response }) => `RESPONDER CON ${response}`, text: ({ text }) => `EL TEXTO ${text}` },
		};
		const text = narrate(`${HONO}const app = new Hono();\napp.get("/", (c) => { return c.text("hola"); });`, {
			plugins,
			locale: { ...english, plugins: { hono: shouted } },
		});
		expect(text).toContain(`RESPONDER A GET /:\n  RESPONDER CON EL TEXTO "hola".`);
	});

	test("a complete translation has no gaps", () => {
		expect(phrasebookGaps(en, { ...en })).toEqual({ missing: [], extra: [] });
	});

	test("the plugin declares the Hono versions it reads", () => {
		expect(hono().library).toEqual({ name: "hono", versions: ">=4 <6" });
	});
});

/** Narrates `code` as a file of a package declaring `dependencies`, the way a host with package.json access would. */
function inPackage({ code, plugins, dependencies }: { code: string; plugins: TsPlugin[]; dependencies: Record<string, string> }) {
	const narrator = createNarrator({ languages: [typescript({ parser: oxcParser, plugins, dependencies: () => dependencies })], locale: english });
	return renderText(narrator.narrate(code, "snippet.ts").lines);
}

describe("files that use Hono without importing it", () => {
	test("a handler in a Hono package reads its context", () => {
		const code = 'export const list = async (c) => {\n  const rows = await load(c.req.query("page"));\n  return c.json(rows);\n};';
		expect(inPackage({ code, plugins, dependencies: {} })).toBe(narrate(code));
		expect(inPackage({ code, plugins, dependencies: { hono: "^4.6.0" } })).toBe(
			["To list (async), given c:", "  Load (the page query parameter), and call the result rows.", "  Reply with rows as JSON."].join("\n"),
		);
	});
});

describe("request properties and replies", () => {
	test("c.req.url, method, path and raw read as request facts", () => {
		const text = read(
			`${HONO}const app = new Hono();\napp.use(async (c, next) => {\n  log(c.req.method, c.req.path, c.req.url);\n  await audit(c.req.raw);\n  await next();\n});`,
		);
		expect(text).toContain("Log (the request method, the request path, and the request URL).");
		expect(text).toContain("Run audit (the raw request).");
	});

	test("a bulleted JSON body keeps its status ahead of the bullets", () => {
		const text = read(
			`${HONO}const app = new Hono();\napp.get("/x", (c) => c.json({ ok: false, error: { code: "bad", message: m, issues: [{ path: p, reason: r }] } }, 422));`,
		);
		expect(text).toContain("  Reply with JSON (status 422 Unprocessable Content) built from an object with:\n    • ok: false");
	});

	test("status constants from stoker read as codes", () => {
		const text = read(
			`${HONO}import * as HttpStatusCodes from "stoker/http-status-codes";\nconst app = new Hono();\napp.get("/x", (c) => c.json(rows, HttpStatusCodes.NOT_FOUND));`,
		);
		expect(text).toContain("rows as JSON (status 404 Not Found)");
	});
});
