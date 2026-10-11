import { describe, expect, test } from "bun:test";
import { narrate, narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { effect } from "../src";
import { effectPlatform, en as platformEn } from "../src/platform";
import { effectSql, en as sqlEn } from "../src/sql";
import { effectTesting, en as testingEn } from "../src/testing";

const plugins = [effect(), effectPlatform(), effectSql(), effectTesting()];

function read(code: string) {
	const { text, fallbacks } = narrateWithStats(code, { plugins });
	expect(fallbacks).toBe(0);
	return text;
}

const V3_HTTP = `import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform"
`;
const V4_HTTP = `import { Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientResponse, HttpRouter, HttpServerResponse } from "effect/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
`;

describe("HTTP client (v3 @effect/platform)", () => {
	const text = read(`${V3_HTTP}
const fetchUser = (id: string) => Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.get(\`https://api.example.com/users/\${id}\`)
  const user = yield* HttpClientResponse.schemaBodyJson(User)(response)
  const created = yield* client.post("https://api.example.com/users", { body: payload })
  return user
})
const req = HttpClientRequest.post("/users").pipe(HttpClientRequest.bodyJson({ name: "Ada" }), HttpClientRequest.bearerToken(token))`);
	test("service, requests with full URLs, schema-checked bodies", () =>
		expect(text).toContain(`    Get the HttpClient service, and call it client.
    Send a GET request to https://api.example.com/users/\${id}, and call the result response.
    Read the JSON body of response and check that it's a user, and call the result user.
    Send a POST request to https://api.example.com/users (body: payload), and call the result created.`));
	test("request builders", () =>
		expect(text).toContain(`Let request be the result of these steps:
  1. Start with a POST request to /users
  2. With an object with name: "Ada" as the JSON body
  3. Authenticated with the bearer token token`));
});

describe("HTTP client (v4 effect/http)", () => {
	test("client middleware and response decoding in a pipe", () => {
		const text = read(`${V4_HTTP}
const getTodo = Effect.fn("getTodo")(function* (id: number) {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk, HttpClient.retryTransient({ times: 3 }))
  const todo = yield* client.get(\`/todos/\${id}\`).pipe(Effect.flatMap(HttpClientResponse.schemaJson(Todo)))
  return todo
})`);
		expect(text).toContain(`  Let client be the result of these steps:
    1. Start with the HttpClient service
    2. Apply the check that the response status is 2xx
    3. Retry temporary failures up to 3 times
  Send a GET request to /todos/\${id}, then read the JSON body and check that it's a todo, and call the result todo.`);
	});
});

describe("HTTP router and responses", () => {
	test("v3 HttpRouter.empty.pipe(...) reads as a route list", () => {
		expect(
			read(`${V3_HTTP}
const router = HttpRouter.empty.pipe(
  HttpRouter.get("/", HttpServerResponse.text("Hello World")),
  HttpRouter.get("/users/:id", Effect.gen(function* () {
    const { id } = yield* HttpRouter.schemaPathParams(Schema.Struct({ id: Schema.NumberFromString }))
    return HttpServerResponse.json({ id }, { status: 200 })
  })),
  HttpRouter.post("/users", createUser),
)`),
		).toBe(`Let router be an HTTP router with these routes:
  • answer GET / with a text response saying "Hello World"
  • answer GET /users/:id with an effect that runs these steps:
    Read the path parameters and check that they're an object with ID (a number written as text), and take its ID.
    Give back a JSON response with an object with ID, with status 200.
  • answer POST /users with create user`);
	});
	test("v3 serving", () =>
		expect(read(`${V3_HTTP}const app = router.pipe(HttpServer.serve(), HttpServer.withLogAddress)`)).toContain(
			"  2. Serve it over HTTP\n  3. Apply logging of the address it listens on",
		));
	test("v4 HttpRouter.add and HttpRouter.use", () => {
		const text = read(`${V4_HTTP}
const Health = HttpRouter.add("GET", "/health", HttpServerResponse.text("ready"))
const Routes = HttpRouter.use((router) => router.add("POST", "/todos", createTodo))`);
		expect(text).toContain(`Let health be a route that answers GET /health with a text response saying "ready".`);
		expect(text).toContain("Let routes be routes added to the HTTP router:\n  • answer POST /todos with create todo");
	});
});

describe("HttpApi", () => {
	test("v3 builder chain, class group, handlers, serving", () => {
		const text = read(`${V3_HTTP}
class UsersGroup extends HttpApiGroup.make("users").add(
  HttpApiEndpoint.get("getUser", "/users/:id").setPath(Schema.Struct({ id: Schema.NumberFromString })).addSuccess(User).addError(NotFound, { status: 404 })
).add(HttpApiEndpoint.post("createUser", "/users").setPayload(NewUser).addSuccess(User)) {}
const MyApi = HttpApi.make("myApi").add(UsersGroup)
const UsersLive = HttpApiBuilder.group(MyApi, "users", (handlers) =>
  handlers.handle("getUser", ({ path }) => findUser(path.id)).handle("createUser", ({ payload }) => insertUser(payload)))
const ApiLive = HttpApiBuilder.api(MyApi).pipe(Layer.provide(UsersLive))`);
		expect(text).toContain(`API group UsersGroup (users):
  • the getUser endpoint (GET /users/:id):
    • path parameters: an object with ID (a number written as text)
    • succeeds with a user
    • can fail with a not found (status 404)
  • the createUser endpoint (POST /users):
    • request body: a new user
    • succeeds with a user`);
		expect(text).toContain("Let my API be the API myApi:\n  • users group");
		expect(text).toContain(`Let users live be the handlers for the users group of my API:
  • getUser: find user (path's ID)
  • createUser: insert user (payload)`);
		expect(text).toContain("Let API live be a layer that serves my API over HTTP, then feed in users live to satisfy its dependencies.");
	});
	test("v4 options object, several errors, prefix, HttpApiBuilder.layer", () => {
		const text = read(`${V4_HTTP}
const Api = HttpApi.make("todos").add(
  HttpApiGroup.make("todos").add(
    HttpApiEndpoint.get("getTodo", "/todos/:id", { params: { id: Schema.NumberFromString }, success: Todo, error: [NotFound, Unauthorized] }),
    HttpApiEndpoint.post("createTodo", "/todos", { payload: { title: Schema.String } }),
  ).prefix("/v1"),
)
const Server = HttpApiBuilder.layer(Api)`);
		expect(text).toBe(`Let API be the API todos:
  • the API group todos:
    • the getTodo endpoint (GET /todos/:id):
      • path parameters: an object with ID (a number written as text)
      • succeeds with a todo
      • can fail with a not found or an unauthorized
    • the createTodo endpoint (POST /todos):
      • request body: an object with title (text)
    • every path starts with /v1

Let server be a layer that serves API over HTTP.`);
	});
});

describe("SQL", () => {
	test("tagged queries keep their full text; transactions; SqlSchema", () => {
		const text = read(`import { Effect, Schema } from "effect"
import { SqlClient, SqlSchema } from "@effect/sql"
const listUsers = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql\`SELECT id, name FROM users WHERE org_id = \${orgId} AND id IN \${sql.in(ids)} ORDER BY name\`
  yield* sql.withTransaction(sql\`UPDATE users SET seen = now() WHERE id = \${id}\`)
})
const findById = SqlSchema.findOne({ Request: Schema.Number, Result: User, execute: (id) => sql\`SELECT * FROM users WHERE id = \${id}\` })`);
		expect(text).toContain(
			"Run the SQL query SELECT id, name FROM users WHERE org_id = ${orgId} AND id IN ${sql.in(ids)} ORDER BY name, and call the result rows.",
		);
		expect(text).toContain("Run the SQL query UPDATE users SET seen = now() WHERE id = ${id} inside a database transaction.");
		expect(text).toContain(
			"Let find by ID be a query function that takes a number, runs the SQL query SELECT * FROM users WHERE id = ${id}, and gives back the first row as a user, if there is one.",
		);
	});
	test("v4 effect/sql import path", () =>
		expect(read(`import { SqlClient } from "effect/sql"\nconst q = sql\`DELETE FROM sessions WHERE expires_at < now()\``)).toBe(
			"Let q be the SQL query DELETE FROM sessions WHERE expires_at < now().",
		));
	test("sql templates outside Effect SQL files are left to other plugins", () => {
		const code = `import { sql } from "drizzle-orm"\nconst q = sql\`select 1\``;
		expect(narrate(code, { plugins })).toBe(narrate(code));
	});
});

describe("@effect/vitest and TestClock", () => {
	test("it.effect, layer(...) suites, TestClock, assert", () => {
		expect(
			read(`import { Effect, TestClock } from "effect"
import { assert, it, layer } from "@effect/vitest"
it.effect("expires sessions after an hour", () =>
  Effect.gen(function* () {
    const session = yield* createSession
    yield* TestClock.adjust("61 minutes")
    const valid = yield* isValid(session)
    assert.strictEqual(valid, false)
  }))
layer(TestDb)("users repo", (it) => {
  it.effect("inserts", () => Effect.gen(function* () { yield* insertUser(alice) }))
})`),
		).toBe(`Test "expires sessions after an hour", run as an effect:
  Run create session, and call the result session.
  Move the test clock forward 61 minutes.
  Check whether session is valid, and call the result valid.
  Check that valid equals false.

Tests "users repo", sharing test DB:
  Test "inserts", run as an effect:
    Insert user (alice).`);
	});
	test("plain vitest's it is left alone", () => {
		const code = `import { it } from "vitest"\nimport { Effect } from "effect"\nit.effect("x", () => Effect.void)`;
		expect(narrate(code, { plugins })).toBe(narrate(code, { plugins: [effect()] }));
	});
});

describe("guards and phrasebooks", () => {
	test("non-Effect HTTP code is untouched", () => {
		const code = `import { Effect } from "effect"\nconst client = makeClient()\nconst res = client.get("/users")\nrouter.add("GET", "/x", handler)\nconst g = HttpApiGroup.make("x").add(y)`;
		expect(narrate(code, { plugins })).toBe(narrate(code, { plugins: [effect()] }));
	});
	test("each companion ships a complete English phrasebook", () => {
		for (const book of [platformEn, sqlEn, testingEn]) expect(phrasebookGaps(book, book)).toEqual({ missing: [], extra: [] });
	});
});

describe("@effect/vitest edge cases", () => {
	test("a test whose body is a bare effect value doesn't crash", () => {
		const text = read('import { it } from "@effect/vitest";\nimport { Effect } from "effect";\nit.effect("does nothing", () => Effect.void);');
		expect(text).toBe('Test "does nothing", run as an effect:\n  • an effect that does nothing');
	});

	test("plain vitest's it and assert are not @effect/vitest's", () => {
		const code = 'import { it, assert } from "vitest";\nimport { Effect } from "effect";\nit.effect("x", () => Effect.void);\nassert.strictEqual(a, b);';
		expect(read(code)).not.toContain("run as an effect");
	});

	test("an Effect sql template is left to other plugins when sql comes from elsewhere", () => {
		const code = 'import { SqlClient } from "@effect/sql";\nimport { sql } from "drizzle-orm";\nconst q = sql`select 1`;';
		expect(narrate(code, { plugins })).toBe(narrate(code));
	});
});
