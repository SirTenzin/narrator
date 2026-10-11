import { describe, expect, test } from "bun:test";
import { createNarrator, renderText } from "@usenarrator/core";
import { type TsPlugin, typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en as english } from "@usenarrator/locale-en";
import { narrate, narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { type ElysiaPhrases, elysia, en } from "../src";

const IMPORTS = `import { Elysia, t } from "elysia";\n`;

/** Narrates with the Elysia plugin and asserts nothing fell back to raw code. */
const say = (code: string, opts: { version?: 1 | 2 } = {}) => {
	const { text, fallbacks } = narrateWithStats(code, { plugins: [elysia(opts)] });
	expect(fallbacks).toBe(0);
	return text;
};
const without = (code: string) => narrate(code);

describe("apps and routes", () => {
	test("the quick-start app reads as a server with routes", () => {
		const text = say(`${IMPORTS}const app = new Elysia({ prefix: "/api" })
	.get("/", () => "Hello Elysia")
	.get("/users/:id", ({ params: { id }, status }) => {
		const user = findUser(id);
		if (!user) return status(404, "User not found");
		return user;
	}, { params: t.Object({ id: t.Numeric() }) })
	.listen(3000);`);
		expect(text).toBe(
			[
				'Let app be a web server (Elysia) (every path starts with "/api"):',
				'  • answer GET "/" with "Hello Elysia"',
				'  • answer GET "/users/:id":',
				"    • the path parameters must be an object with ID (a number, even if sent as text)",
				"    • then:",
				"      Find user (ID).",
				'      If user is missing, reply with a 404 (Not Found) response with "User not found".',
				"      Give back user.",
				"  • start listening on port 3000",
			].join("\n"),
		);
	});

	test("body schema, docs, and a one-line handler", () => {
		const text = say(`${IMPORTS}new Elysia().post("/users", ({ body }) => createUser(body), {
	body: t.Object({ name: t.String({ minLength: 1 }), email: t.String({ format: "email" }), age: t.Optional(t.Number()) }),
	detail: { summary: "Create a user", tags: ["users"], deprecated: true }
});`);
		expect(text).toBe(
			[
				"A web server (Elysia):",
				'  • answer POST "/users":',
				"    • the body must be an object with name (text, at least 1 character), email (an email address), and age (optional, a number)",
				"    • API docs:",
				'      • summary: "Create a user"',
				'      • tagged "users"',
				"      • marked as deprecated",
				"    • reply with create user (body)",
			].join("\n"),
		);
	});

	test("every route form: all, route, named handler, static value, export default", () => {
		const text = say(`${IMPORTS}export default new Elysia({ name: "core" })
	.all("/any", "ok")
	.route("PATCH", "/x", ({ body }) => body)
	.get("/list", getList)
	.put("/users/:id", updateUser, { params: t.Object({ id: t.String() }) });`);
		expect(text).toBe(
			[
				'Export a web server (Elysia) (named "core", so it\'s only added once) as the default:',
				'  • answer any request to "/any" with "ok"',
				'  • answer PATCH "/x" with body',
				'  • answer GET "/list" using get list',
				'  • answer PUT "/users/:id":',
				"    • the path parameters must be an object with ID (text)",
				"    • let update user handle it",
			].join("\n"),
		);
	});

	test("steps added to an existing app", () => {
		const code = `${IMPORTS}const app = new Elysia();\napp.get("/redirect", ({ redirect }) => redirect("https://elysiajs.com", 302));\napp.listen({ port: 3000, hostname: "0.0.0.0" });`;
		const text = say(code);
		expect(text).toContain('On app, answer GET "/redirect" with a 302 (Found) redirect to "https://elysiajs.com".');
		expect(text).toContain('On app, start listening on "0.0.0.0", port 3000.');
	});

	test("app.handle in tests", () => {
		expect(say(`${IMPORTS}const app = new Elysia();\nconst res = await app.handle(new Request("http://localhost/"));`)).toContain(
			'Let response be the response app gives to a new request ("http://localhost/").',
		);
	});

	test("set.status, set.headers, and listen callbacks", () => {
		const text = say(`${IMPORTS}new Elysia()
	.post("/sign-in", ({ body, set }) => { set.status = 201; set.headers["x-powered-by"] = "Elysia"; return signIn(body) })
	.listen(3000, ({ hostname, port }) => console.log(\`running at \${hostname}:\${port}\`));`);
		expect(text).toContain("Set the response status to 201 (Created).");
		expect(text).toContain('Set the response header "x-powered-by" to "Elysia".');
		expect(text).toContain("• start listening on port 3000:\n    • once it's running:");
	});

	test("WebSocket routes and mounts", () => {
		const text = say(`${IMPORTS}new Elysia()
	.ws("/chat", { body: t.Object({ message: t.String() }), open(ws) { ws.subscribe("room") }, message(ws, { message }) { ws.send(message) } })
	.mount("/hono", hono.fetch);`);
		expect(text).toContain('• accept WebSocket connections on "/chat":');
		expect(text).toContain("• the body must be an object with message (text)");
		expect(text).toContain("• when a client connects:");
		expect(text).toContain("• when a message arrives:");
		expect(text).toContain(`• pass every request under "/hono" to hono's fetch`);
	});
});

describe("hooks, lifecycle, and composition", () => {
	test("group, guard, and the routes inside", () => {
		const text = say(`${IMPORTS}new Elysia()
	.group("/v1", { headers: t.Object({ "x-api-key": t.String() }) }, (app) => app.get("/ping", () => "pong"))
	.guard({ body: "sign" }, (app) => app.post("/sign-up", ({ body }) => signUp(body)))
	.guard({ query: t.Object({ page: t.Numeric({ minimum: 1, default: 1 }) }) })
	.get("/items", ({ query }) => list(query.page));`);
		expect(text).toBe(
			[
				"A web server (Elysia):",
				'  • under "/v1":',
				"    • each one:",
				'      • the headers must be an object with "x-api-key" (text)',
				'    • answer GET "/ping" with "pong"',
				"  • for the routes inside:",
				"    • each one:",
				"      • the body must be the sign schema",
				'    • answer POST "/sign-up" with sign up (body)',
				"  • for every route from here on:",
				"    • the query string must be an object with page (a number, even if sent as text, at least 1, defaults to 1)",
				'  • answer GET "/items" with list (query\'s page)',
			].join("\n"),
		);
	});

	test("lifecycle hooks on the app and on one route", () => {
		const text = say(`${IMPORTS}new Elysia()
	.onRequest(({ request }) => log(request.url))
	.onBeforeHandle({ as: "global" }, ({ headers, error }) => { if (!headers.authorization) return error(401) })
	.onError(({ code }) => { if (code === "NOT_FOUND") return "Not found :(" })
	.onAfterResponse(() => metrics.flush())
	.get("/", () => "hi", { beforeHandle: [checkA, checkB], afterHandle: ({ response }) => wrap(response), parse: "json" });`);
		expect(text).toBe(
			[
				"A web server (Elysia):",
				"  • on every request, before routing:",
				"    Log (request's URL).",
				"  • before every handler, also for every app that uses this one:",
				"    If headers' authorization is missing, reply with a 401 (Unauthorized) response.",
				"  • when something goes wrong:",
				'    If code is "NOT_FOUND", give back "Not found :(".',
				"  • after every response is sent:",
				"    Flush metrics.",
				'  • answer GET "/":',
				"    • before the handler, run check a",
				"    • before the handler, run check b",
				"    • after the handler:",
				"      Wrap (response).",
				"    • read the body as JSON",
				'    • reply with "hi"',
			].join("\n"),
		);
	});

	test("state, decorate, derive, resolve, model, macro, error codes, as", () => {
		const text = say(`${IMPORTS}export const auth = new Elysia({ name: "auth" })
	.state("version", 1)
	.decorate("db", db)
	.decorate("logger", new Logger())
	.model({ sign: t.Object({ username: t.String(), password: t.String({ minLength: 8 }) }) })
	.derive({ as: "scoped" }, ({ headers }) => ({ bearer: headers.authorization }))
	.resolve(async ({ cookie: { session } }) => {
		const user = await getUser(session.value);
		return { user };
	})
	.macro({ isSignIn: { beforeHandle({ user, status }) { if (!user) return status("Unauthorized") } } })
	.error({ MyError })
	.get("/profile", ({ user }) => user, { isSignIn: true, response: { 200: t.Object({ name: t.String() }), 401: t.String() } })
	.as("scoped");`);
		expect(text).toBe(
			[
				'Let auth be a web server (Elysia) (named "auth", so it\'s only added once):',
				"  • keep version in the shared store, starting at 1",
				"  • give every handler DB",
				"  • give every handler logger: a new logger",
				"  • name these schemas:",
				"    • sign: an object with username (text) and password (text, at least 8 characters)",
				"  • for every request, work out values for the handler, also for the app that uses this one:",
				"    • bearer: headers' authorization",
				"  • for every request, work out user (after validation):",
				"    Get user (session's value).",
				"    Give back an object with user.",
				"  • add a route option isSignIn:",
				"    • before the handler:",
				"      If user is missing, reply with a 401 (Unauthorized) response.",
				"  • know these errors by code:",
				"    • MyError: my error",
				'  • answer GET "/profile":',
				"    • isSignIn is on",
				"    • it replies with:",
				"      • 200 (OK): an object with name (text)",
				"      • 401 (Unauthorized): text",
				"    • reply with user",
				"  • share the hooks above with the app that uses this one",
			].join("\n"),
		);
	});

	test("a plugin function typed with Elysia", () => {
		const text = say(`${IMPORTS}const counter = (app: Elysia) => app.state("counter", 0).get("/count", ({ store }) => store.counter++);`);
		expect(text).toContain("• keep counter in the shared store, starting at 0");
		expect(text).toContain(`• answer GET "/count" with increase store's counter by 1`);
	});
});

describe("official plugins", () => {
	test("cors, swagger, openapi, jwt, static, cron, sub-apps, lazy plugins", () => {
		const text = say(`import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { openapi } from "@elysiajs/openapi";
import { jwt } from "@elysiajs/jwt";
import { staticPlugin } from "@elysiajs/static";
import { cron } from "@elysiajs/cron";
new Elysia()
	.use(cors({ origin: "https://example.com" }))
	.use(swagger())
	.use(openapi({ path: "/docs" }))
	.use(jwt({ name: "auth", secret: process.env.JWT_SECRET!, exp: "7d" }))
	.use(staticPlugin({ assets: "public", prefix: "/" }))
	.use(cron({ name: "heartbeat", pattern: "*/10 * * * * *", run() { console.log("Heartbeat") } }))
	.use(userRoutes)
	.use(import("./plugin"))
	.get("/sign/:name", ({ auth, params: { name } }) => auth.sign({ name }))
	.get("/me", ({ auth, headers }) => auth.verify(headers.authorization));`);
		expect(text).toBe(
			[
				"A web server (Elysia):",
				"  • allow cross-origin requests (CORS):",
				'    • origin: "https://example.com"',
				"  • publish API docs (Swagger)",
				'  • publish API docs (OpenAPI) at "/docs"',
				'  • sign and check JSON Web Tokens as "auth":',
				"    • using the secret the JWT_SECRET environment variable",
				'    • tokens expire after "7d"',
				'  • serve the files in "public" under "/"',
				'  • run "heartbeat" on the schedule "*/10 * * * * *":',
				"    • each time:",
				'      Log "Heartbeat".',
				"  • add the routes and hooks of user routes",
				'  • load the plugin in "./plugin" and add it',
				'  • answer GET "/sign/:name" with a signed token holding an object with name',
				"  • answer GET \"/me\" with what headers' authorization holds, if it's a valid token",
			].join("\n"),
		);
	});
});

describe("TypeBox schemas", () => {
	test("standalone schemas and every builder shape", () => {
		const text = say(`${IMPORTS}const Upload = t.Object({
	file: t.File({ type: "image", maxSize: "5m" }),
	kind: t.Union([t.Literal("a"), t.Literal("b")]),
	id: t.Union([t.String({ format: "uuid" }), t.Integer()]),
	tags: t.Array(t.String(), { minItems: 1, uniqueItems: true }),
	meta: t.Optional(t.Record(t.String(), t.Number())),
	when: t.Nullable(t.Date()),
	slug: t.String({ pattern: "^[a-z-]+$", maxLength: 1 }),
	role: t.Enum(Role),
	user: t.Ref("user"),
	patch: t.Partial(t.Omit(User, ["id"])),
});`);
		expect(text).toBe(
			[
				'Let upload be a schema for an object with file (a file, of type "image", at most "5m"), kind (one of "a" or "b"), ID (either a UUID or a whole number), tags (a list of text, at least 1 item, no repeats), meta (optional, a lookup from text to number), when (a date, or nothing), slug (text, matching ^[a-z-]+$, at most 1 character), role (one of the role values), user (the user schema), and patch (user without "id", every field optional).',
			].join("\n"),
		);
	});

	test("model names in hooks", () => {
		expect(say(`${IMPORTS}new Elysia().post("/sign-in", ({ body }) => body, { body: "sign", response: "session[]" });`)).toContain(
			"the body must be the sign schema",
		);
	});

	test("TypeBox imported from @sinclair/typebox", () => {
		expect(say(`import { Type } from "@sinclair/typebox";\nconst Id = Type.Integer({ minimum: 1 });`)).toBe(
			"Let ID be a schema for a whole number, at least 1.",
		);
	});
});

describe("Eden treaty", () => {
	const EDEN = `import { treaty } from "@elysiajs/eden";\nimport type { App } from "./server";\n`;

	test("client creation and calls", () => {
		const text = say(`${EDEN}const api = treaty<App>("localhost:3000");
const { data, error } = await api.users({ id: 1 }).get();
await api.users.post({ name: "Ann" });
const page = await api.items.get({ query: { page: 2 } });
const home = await api.index.get();
await api.users({ id: "1" }).posts.put({ title: "x" }, { headers: { authorization: "Bearer x" } });
const chat = api.chat.subscribe();`);
		expect(text).toBe(
			[
				'Let API be a typed client for the App API at "localhost:3000".',
				'From the reply to GET "/users/:id" through API (ID 1), take data and error.',
				'Send POST "/users" through API (sending an object with name: "Ann").',
				'Let page be the reply to GET "/items" through API (query an object with page: 2).',
				'Let home be the reply to GET "/" through API.',
				'Send PUT "/users/:id/posts" through API (ID "1", sending an object with title: "x", headers an object with authorization: "Bearer x").',
				'Let chat be a live WebSocket connection to "/chat" through API.',
			].join("\n"),
		);
	});

	test("a client that calls the app directly", () => {
		expect(say(`${EDEN}const client = treaty(app);`)).toBe("Let client be a typed client that calls app directly.");
	});
});

describe("versions", () => {
	test("auto mode reads Elysia 2 hook-first routes, prefix-less lifecycle, error classes, and problem()", () => {
		const text = say(`import { Elysia, t, problem } from "elysia";
new Elysia()
	.post("/", { body: t.Object({ name: t.String() }) }, ({ body }) => body.name)
	.beforeHandle("plugin", ({ headers }) => check(headers))
	.error(MyError, () => problem(418, { detail: "I love teapot" }))
	.derive(({ headers }) => { const user = auth(headers); return { user } });`);
		expect(text).toBe(
			[
				"A web server (Elysia):",
				'  • answer POST "/":',
				"    • the body must be an object with name (text)",
				"    • reply with body's name",
				"  • before every handler, also for the app that uses this one:",
				"    Check (headers).",
				"  • when my error is thrown:",
				'    Reply with a 418 (I\'m a teapot) problem report: "I love teapot".',
				"  • for every request, work out user:",
				"    Let user be the result of auth (headers).",
				"    Give back an object with user.",
			].join("\n"),
		);
	});

	test("version 2 swaps ambiguous route arguments and times derive after validation", () => {
		const code = `${IMPORTS}new Elysia().get("/", hook, handler).derive(({ headers }) => { const user = auth(headers); return { user } });`;
		const v2 = say(code, { version: 2 });
		expect(v2).toContain("• with the rules in hook");
		expect(v2).toContain("• let handler handle it");
		expect(v2).toContain("work out user (after validation)");
		const v1 = say(code, { version: 1 });
		expect(v1).toContain("• with the rules in handler");
		expect(v1).toContain("work out user (before validation)");
	});

	test("version 1 drops Elysia 2 names and version 2 drops Elysia 1 names", () => {
		const v1 = say(`${IMPORTS}new Elysia().beforeHandle(check).error(MyError, handle);`, { version: 1 });
		expect(v1).not.toContain("before every handler");
		expect(v1).not.toContain("when my error is thrown");
		const v2 = say(`${IMPORTS}new Elysia().onBeforeHandle(check).resolve(load).get("/", ({ error }) => error(404));`, { version: 2 });
		expect(v2).not.toContain("before every handler");
		expect(v2).not.toContain("after validation");
		expect(v2).not.toContain("404 (Not Found)");
	});
});

describe("guards", () => {
	test("unrelated .get/.post/.use/.listen/.error calls are left to the engine", () => {
		const code = `import express from "express";
const app = express();
app.get("/", (req, res) => res.send("hi"));
app.listen(3000);
const cache = new Map();
cache.get("x");
logger.error("boom");
api.users.get();`;
		expect(say(code)).toBe(without(code));
	});

	test("status/error/redirect need Elysia; plugin names need the official package", () => {
		const code = `import { cors } from "hono/cors";
import { redirect } from "next/navigation";
const r = error(404, "x");
const s = status(500);
use(cors());
redirect("/login");`;
		expect(say(code)).toBe(without(code));
	});

	test("an Elysia class from another package is not Elysia", () => {
		const code = `import { Elysia } from "./my-elysia";\nconst x = new Elysia().get("/", () => 1);`;
		expect(say(code)).toBe(without(code));
	});

	test("t.* without an Elysia or TypeBox import is not TypeBox", () => {
		const code = `const x = t.Object({ a: t.String() });`;
		expect(say(code)).toBe(without(code));
	});

	test("treaty from elsewhere is not Eden", () => {
		const code = `import { treaty } from "./treaty";\nconst api = treaty("x");\nawait api.users.get();`;
		expect(say(code)).toBe(without(code));
	});
});

describe("phrasebook", () => {
	test("plugin metadata", () => {
		const p = elysia();
		expect(p.name).toBe("elysia");
		expect(p.library?.name).toBe("elysia");
	});

	test("English is complete against its own type", () => {
		const ref: ElysiaPhrases = en;
		expect(phrasebookGaps(ref, en)).toEqual({ missing: [], extra: [] });
	});
});

/** Narrates `code` as a file of a package declaring `dependencies`, the way a host with package.json access would. */
function inPackage({ code, plugins, dependencies }: { code: string; plugins: TsPlugin[]; dependencies: Record<string, string> }) {
	const narrator = createNarrator({ languages: [typescript({ parser: oxcParser, plugins, dependencies: () => dependencies })], locale: english });
	return renderText(narrator.narrate(code, "snippet.ts").lines);
}

describe("files that use Elysia without importing it", () => {
	test("handler-context calls in an Elysia package read as replies", () => {
		const code =
			'export const getUser = ({ params, status }) => {\n  const user = find(params.id);\n  if (!user) return status(404, "missing");\n  return user;\n};';
		expect(inPackage({ code, plugins: [elysia()], dependencies: {} })).toBe(narrate(code));
		expect(inPackage({ code, plugins: [elysia()], dependencies: { elysia: "^1.3.0" } })).toContain('reply with a 404 (Not Found) response with "missing"');
	});

	test("a local function named like a context helper is left alone", () => {
		const code = 'function status(code, msg) { return { code, msg }; }\nexport const f = () => status(404, "x");';
		expect(inPackage({ code, plugins: [elysia()], dependencies: { elysia: "^1.3.0" } })).toBe(narrate(code));
	});
});
