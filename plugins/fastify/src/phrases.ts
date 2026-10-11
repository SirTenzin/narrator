/** Arguments are already-rendered markup strings unless typed otherwise. */
type P<K extends string> = { [key in K]: string };
type Phrase<K extends string> = (p: P<K>) => string;
/** `count` is the plain number, for plural agreement. */
type Count = (p: { n: string; count: number }) => string;

/** Request and server lifecycle hooks, as named in `addHook` and route options. */
export type Hook =
	| "onRequest"
	| "preParsing"
	| "preValidation"
	| "preHandler"
	| "preSerialization"
	| "onSend"
	| "onResponse"
	| "onError"
	| "onTimeout"
	| "onRequestAbort"
	| "onReady"
	| "onListen"
	| "onClose"
	| "preClose"
	| "onRoute"
	| "onRegister";

/** The parts of a request a route schema validates. */
export type Part = "body" | "querystring" | "params" | "headers";

/** Official plugins the plugin names when they're registered. */
export type Plugin =
	| "cors"
	| "helmet"
	| "jwt"
	| "cookie"
	| "static"
	| "swagger"
	| "swagger-ui"
	| "rate-limit"
	| "multipart"
	| "formbody"
	| "sensible"
	| "autoload"
	| "websocket"
	| "compress"
	| "env"
	| "postgres"
	| "redis"
	| "mongodb";

/** JSON Schema `type` values. */
export type JsonType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

/** Fastify phrasebook. A translator implements this type in `src/<locale>.ts`. */
export type FastifyPhrases = {
	server: {
		/** `Fastify({ logger: true })`; `details` may be null. */
		create: (p: { details: string | null }) => string;
		logger: string;
		/** `listen({ port, host })`; `port` and `host` may be null. */
		listen: (p: { server: string; port: string | null; host: string | null }) => string;
		/** Heading over v4's `listen(port, cb)` callback. */
		listening: string;
		/** `await fastify.ready()`. */
		ready: string;
		close: string;
		/** `app.inject({ method, url })` in tests; `details` may be null. */
		inject: (p: { method: string | null; url: string | null; details: string | null }) => string;
	};
	routes: {
		/** One route; `handler` is set when it reads inline; `before` lists route-level hooks. */
		answer: (p: { method: string; path: string; handler: string | null; before: string | null }) => string;
		/** `method: ["GET", "HEAD"]`. */
		methods: Phrase<"list">;
		/** Heading over `setErrorHandler`'s steps. */
		onError: string;
		/** `setErrorHandler(handler)` by name. */
		onErrorWith: Phrase<"handler">;
		notFound: string;
		notFoundWith: Phrase<"handler">;
		/** `setNotFoundHandler({ preHandler }, handler)`. */
		notFoundAfter: Phrase<"before">;
		/** A route option the plugin has no reading for. */
		option: Phrase<"name" | "value">;
	};
	schema: {
		/** One validated request part: "expect the body to be …". */
		check: Phrase<"part" | "shape">;
		parts: Record<Part, string>;
		/** `response: { 200: schema }`. */
		response: Phrase<"status" | "shape">;
		/** JSON Schema shapes. */
		types: Record<JsonType, string>;
		objectWith: Phrase<"fields">;
		/** One property; `required` marks it. */
		field: (p: { name: string; type: string; required: boolean }) => string;
		arrayOf: Phrase<"items">;
		oneOf: Phrase<"list">;
		/** `enum: ["a", "b"]`. */
		enumOf: Phrase<"list">;
		/** Constraints after a type, already joined. */
		withRules: Phrase<"type" | "rules">;
		format: Phrase<"format">;
		minLength: Count;
		maxLength: Count;
		minimum: Count;
		maximum: Count;
		minItems: Count;
		maxItems: Count;
		pattern: Phrase<"pattern">;
		defaultValue: Phrase<"value">;
		nullable: string;
		noExtra: string;
		/** A schema referenced by `$ref`. */
		ref: Phrase<"ref">;
	};
	request: {
		/** `request.jwtVerify()` from `@fastify/jwt`. */
		jwtVerify: string;
		params: string;
		query: string;
		body: string;
		headers: string;
		ip: string;
		hostname: string;
		url: string;
		method: string;
		id: string;
		log: string;
		cookies: string;
		user: string;
	};
	reply: {
		/** A reply sent as a statement or a handler's return value. */
		reply: Phrase<"response">;
		send: Phrase<"body">;
		empty: string;
		/** `reply.code(201).send(x)`. */
		withStatus: Phrase<"response" | "status">;
		code: (p: { code: string; name: string | null }) => string;
		statusNames: Record<string, string>;
		/** `reply.redirect(url, code?)`; `status` may be null. */
		redirect: (p: { url: string; status: string | null }) => string;
		setStatus: Phrase<"status">;
		setHeader: Phrase<"name" | "value">;
		setHeaders: Phrase<"headers">;
		setType: Phrase<"type">;
		setCookie: (p: { name: string; value: string; options: string | null }) => string;
		clearCookie: Phrase<"name">;
		/** `reply.view("index.ejs", data)`. */
		view: (p: { view: string; data: string | null }) => string;
		file: Phrase<"path">;
		notFound: string;
		/** `reply.hijack()`. */
		hijack: string;
		/** `reply.sent` / `reply.raw`. */
		raw: string;
	};
	hooks: {
		/** Heading over a hook's steps, by hook. */
		when: Record<Hook, string>;
		/** `addHook("onRequest", fastify.authenticate)`. */
		run: Phrase<"when" | "handler">;
		/** A route-level hook: a heading over its steps when inline. */
		named: Record<Hook, string>;
	};
	plugins: {
		names: Record<Plugin, string>;
		/** `register(plugin, opts)`; `prefix` and `details` may be null. */
		register: (p: { plugin: string; prefix: string | null; details: string | null }) => string;
		/** Heading over an inline plugin's steps. */
		registerInline: (p: { prefix: string | null }) => string;
		/** `fp(fn, { name })`; a plugin whose decorations and hooks reach its parent. */
		shared: (p: { details: string | null }) => string;
		/** `fp(namedFn)`. */
		sharedFn: (p: { fn: string; details: string | null }) => string;
		/** `@fastify/autoload` with `dir`. */
		autoload: Phrase<"dir">;
	};
	decorate: {
		/** `decorate("db", pool)`. */
		server: Phrase<"name" | "value">;
		/** `decorate("authenticate", async (req, reply) => …)` heading. */
		serverFn: Phrase<"name">;
		request: Phrase<"name" | "value">;
		reply: Phrase<"name" | "value">;
		/** `decorateRequest("user", null)`. */
		requestEmpty: Phrase<"name">;
		replyEmpty: Phrase<"name">;
		/** Heading over a request/reply decorator function. */
		requestFn: Phrase<"name">;
		replyFn: Phrase<"name">;
		/** `fastify.hasDecorator("x")`. */
		has: (p: { name: string; neg: boolean }) => string;
	};
	common: {
		option: Phrase<"name" | "value">;
		details: (p: { items: string[] }) => string;
		yes: string;
		no: string;
		nothing: string;
	};
};
