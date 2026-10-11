import { describe, expect, test } from "bun:test";
import { narrate, narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { en, type FastifyPhrases, fastify } from "../src";

const plugins = [fastify()];
const FA = `import Fastify from "fastify";\nconst fastify = Fastify({ logger: true });\n`;

/** Narrates with the plugin and asserts nothing fell back to raw code. */
const read = (code: string, p = plugins) => {
	const { text, fallbacks } = narrateWithStats(code, { plugins: p });
	expect(fallbacks).toBe(0);
	return text;
};
/** The narration after the server's creation line. */
const body = (code: string, p = plugins) =>
	read(FA + code, p)
		.split("\n")
		.slice(1)
		.join("\n")
		.trim();

describe("servers and routes", () => {
	test("the getting-started server, CommonJS style", () => {
		expect(
			read(`const fastify = require("fastify")({ logger: true });
fastify.get("/", async (request, reply) => {
  return { hello: "world" };
});
const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();`),
		).toBe(
			[
				"Let fastify be a new Fastify server (with request logging).",
				"",
				"Answer GET /:",
				`  Reply with an object with hello: "world".`,
				"",
				"To start (async):",
				"  Try the following:",
				"    Start fastify listening on port 3000.",
				"  If anything fails (call the problem error):",
				"    Log an error (with error).",
				"    Exit the process with code 1.",
				"",
				"Start.",
			].join("\n"),
		);
	});

	test("an expression-bodied handler reads inline", () => {
		expect(body(`fastify.get("/ping", async () => "pong");\nfastify.get("/old", (req, reply) => reply.redirect("/new", 301));`)).toBe(
			[`Answer GET /ping with "pong".`, "", "Answer GET /old:", `  Redirect to "/new" (status 301 Moved Permanently).`].join("\n"),
		);
	});

	test("route schemas read as validation and reply shapes", () => {
		const text = body(`fastify.post("/users", {
  schema: {
    body: { type: "object", required: ["name"], properties: { name: { type: "string", minLength: 1 }, role: { enum: ["admin", "member"] } } },
    response: { 201: { type: "object", properties: { id: { type: "string", format: "uuid" } } } },
  },
  preHandler: [fastify.authenticate],
}, async (request, reply) => {
  const user = await db.insert(request.body);
  if (!user) return reply.code(409).send({ error: "exists" });
  reply.code(201);
  return user;
});`);
		expect(text).toBe(
			[
				"Answer POST /users, after fastify's authenticate:",
				`  • Expect the body to be an object with name (a string, at least 1 character, required) and role (one of "admin" or "member")`,
				"  • A 201 Created reply is an object with id (a string, in uuid format)",
				"  Insert DB (the request body), and call the result user.",
				`  If user is missing, reply with an object with error: "exists" (status 409 Conflict).`,
				"  Set the reply status to 201 Created.",
				"  Reply with user.",
			].join("\n"),
		);
	});

	test("fastify.route with a v4 short-form querystring", () => {
		expect(body(`fastify.route({ method: ["GET", "HEAD"], url: "/search", schema: { querystring: { q: { type: "string" } } }, handler: search });`)).toBe(
			["Answer GET or HEAD /search with search:", "  • Expect the query string to be an object with q (a string)"].join("\n"),
		);
	});

	test("returns inside callbacks within a handler keep their meaning", () => {
		expect(body(`fastify.get("/a", async () => {\n  const ids = items.map((x) => { return x.id; });\n  return ids;\n});`)).toContain("Reply with IDs.");
	});
});

describe("hooks, plugins and decorators", () => {
	test("hooks, decorators and error handlers", () => {
		const text = body(`fastify.addHook("onRequest", async (request, reply) => {
  await request.jwtVerify();
});
fastify.addHook("onClose", closeDb);
fastify.decorate("authenticate", async (request, reply) => {
  await request.jwtVerify();
});
fastify.decorateRequest("user", null);
fastify.setErrorHandler((error, request, reply) => {
  reply.status(500).send({ ok: false });
});
fastify.setNotFoundHandler((request, reply) => reply.code(404).send("missing"));`);
		expect(text).toBe(
			[
				"When a request arrives:",
				"  Verify the request's JWT.",
				"",
				"When the server closes, run close DB.",
				"",
				"Add the authenticate function to the server:",
				"  Verify the request's JWT.",
				"",
				"Give every request a user property, starting as nothing.",
				"",
				"When a request fails:",
				"  Reply with an object with ok: false (status 500 Internal Server Error).",
				"",
				"When no route matches:",
				`  Reply with "missing" (status 404 Not Found).`,
			].join("\n"),
		);
	});

	test("register: official plugins by name, prefixes, autoload and inline plugins", () => {
		const text = read(`import Fastify from "fastify";
import cors from "@fastify/cors";
import autoload from "@fastify/autoload";
const app = Fastify();
await app.register(cors, { origin: true });
app.register(autoload, { dir: join(__dirname, "routes") });
app.register(import("./routes/users"), { prefix: "/v1" });
app.register(async (instance) => {
  instance.get("/health", async () => ({ ok: true }));
}, { prefix: "/internal" });`);
		expect(text).toBe(
			[
				"Let app be a new Fastify server.",
				"Register CORS (origin: yes).",
				`Register every plugin in join (dirname and "routes").`,
				`Register the module at "./routes/users" under /v1.`,
				"",
				"Register a plugin under /internal:",
				"  Answer GET /health with an object with ok: true.",
			].join("\n"),
		);
	});

	test("fastify-plugin wraps a shared plugin", () => {
		expect(
			read(
				`import fp from "fastify-plugin";\nexport default fp(async (fastify, opts) => {\n  fastify.decorate("db", createPool(opts.url));\n}, { name: "db" });`,
			),
		).toBe(
			[`Export a plugin shared with the server that registers it (name: "db") as the default:`, "  Add db to the server as create pool (options' URL)."].join(
				"\n",
			),
		);
	});

	test("inject in tests", () => {
		expect(body(`const res = await fastify.inject({ method: "GET", url: "/users/1" });`)).toBe(
			"Let response be the response to a test GET request to /users/1.",
		);
	});
});

describe("versions", () => {
	const src = `fastify.get("/r", (req, reply) => reply.redirect(a, b));`;
	test("reply.redirect's argument order follows the major when the code isn't a literal", () => {
		expect(body(src, [fastify({ version: 5 })])).toContain("Redirect to a (status b).");
		expect(body(src, [fastify({ version: 4 })])).toContain("Redirect to b (status a).");
		expect(body(`fastify.get("/r", (req, reply) => reply.redirect(302, "/x"));`, [fastify({ version: 5 })])).toContain(`Redirect to "/x" (status 302 Found).`);
	});
});

describe("guards", () => {
	test("without Fastify, same-named calls are left alone", () => {
		const src = `const server = createServer();\nserver.get("/x", handler);\nserver.listen({ port: 1 });\nreply.send(data);`;
		expect(narrate(src, { plugins })).toBe(narrate(src));
	});
	test("an Express app in a Fastify-free file is not a Fastify server", () => {
		const src = `import express from "express";\nconst app = express();\napp.register(thing);`;
		expect(narrate(src, { plugins })).toBe(narrate(src));
	});
});

describe("phrasebook", () => {
	test("English is complete against its own type", () => {
		expect(phrasebookGaps(en, en satisfies FastifyPhrases)).toEqual({ missing: [], extra: [] });
	});
});
