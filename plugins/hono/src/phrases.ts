/** Arguments are already-rendered markup strings unless typed otherwise. */
type P<K extends string> = { [key in K]: string };
type Phrase<K extends string> = (p: P<K>) => string;
/** `n` is the plain number, for plural agreement. */
type Unit = (p: { count: string; n: number }) => string;

/** Where a validator reads from (`zValidator("json", …)`, `c.req.valid("query")`, the RPC client's `{ query }`). */
export type Target = "json" | "form" | "query" | "param" | "header" | "cookie";

/** Built-in and first-party middleware the plugin names. */
export type Builtin =
	| "cors"
	| "logger"
	| "jwt"
	| "jwk"
	| "bearerAuth"
	| "basicAuth"
	| "secureHeaders"
	| "etag"
	| "timing"
	| "compress"
	| "cache"
	| "prettyJSON"
	| "csrf"
	| "requestId"
	| "bodyLimit"
	| "poweredBy"
	| "trimTrailingSlash"
	| "appendTrailingSlash"
	| "serveStatic"
	| "methodOverride"
	| "contextStorage";

/** Option keys with a reading of their own; any other key is shown by its humanized name. */
export type OptionKey =
	| "origin"
	| "allowMethods"
	| "allowHeaders"
	| "exposeHeaders"
	| "maxAge"
	| "credentials"
	| "secret"
	| "alg"
	| "cookie"
	| "token"
	| "verifyToken"
	| "username"
	| "password"
	| "verifyUser"
	| "realm"
	| "cacheName"
	| "cacheControl"
	| "maxSize"
	| "encoding"
	| "root"
	| "path"
	| "domain"
	| "secure"
	| "httpOnly"
	| "sameSite"
	| "expires";

/** Serverless adapters whose `handle(app)` the plugin names. */
export type Platform = "vercel" | "aws-lambda" | "lambda-edge" | "netlify" | "cloudflare-pages";

/** Hono phrasebook. A translator implements this type in `src/<locale>.ts`. */
export type HonoPhrases = {
	app: {
		/** `new Hono()` as a value. */
		noun: string;
		/** `const app = new Hono()`; `details` is null or the joined details. */
		create: (p: { name: string; details: string | null }) => string;
		/** `app.get(…).post(…)` as a value: the app followed by its routes as bullets. */
		withRoutes: Phrase<"app">;
		/** `app.basePath("/api")` as a value. */
		under: Phrase<"app" | "path">;
		/** A creation detail: every route lives under `path`. */
		basePath: Phrase<"path">;
		/** `new Hono<Env>()` with a named environment type. */
		env: Phrase<"type">;
		/** Generic types of `new Hono<{ Bindings; Variables }>()`. */
		bindings: Phrase<"type">;
		variables: Phrase<"type">;
		/** `new Hono({ strict })`: whether `/a` and `/a/` are different routes. */
		strict: (p: { strict: boolean }) => string;
	};
	routes: {
		/** One route. `method` is null for `app.all`; `handler` is set when the handler reads inline; `before` lists middleware and validators. */
		answer: (p: { method: string | null; path: string; handler: string | null; before: string | null }) => string;
		/** `app.use(cors(), logger())`; `path` is null for every request. */
		use: (p: { middleware: string; path: string | null }) => string;
		/** `app.use(async (c, next) => …)` heading. */
		useInline: (p: { path: string | null }) => string;
		/** `app.route("/books", books)`. */
		mount: Phrase<"app" | "path">;
		/** `app.mount("/legacy", other.fetch)`. */
		mountHandler: Phrase<"handler" | "path">;
		onError: string;
		onErrorWith: Phrase<"handler">;
		notFound: string;
		notFoundWith: Phrase<"handler">;
		/** `...handlers` spread into a route. */
		everythingIn: Phrase<"value">;
		/** `app.request("/hello")` in tests. */
		testRequest: (p: { app: string; path: string; init: string | null }) => string;
	};
	request: {
		param: Phrase<"name">;
		params: string;
		query: Phrase<"name">;
		queries: string;
		queryValues: Phrase<"name">;
		allQueryValues: string;
		header: Phrase<"name">;
		headers: string;
		json: string;
		text: string;
		formData: string;
		parseBody: string;
		arrayBuffer: string;
		blob: string;
		/** `c.req.valid("json")`. */
		valid: Phrase<"target">;
		/** `c.req.url`, `c.req.method`, ... read as properties. */
		url: string;
		method: string;
		path: string;
		routePath: string;
		raw: string;
	};
	response: {
		/** A handler's `return c.json(…)` and friends. */
		reply: Phrase<"response">;
		json: Phrase<"data">;
		/** `c.json({ … })` whose data is listed as bullets; `details` is the joined status and headers, or null. */
		jsonFrom: (p: { data: string; details: string | null }) => string;
		text: Phrase<"text">;
		html: Phrase<"html">;
		body: Phrase<"body">;
		emptyBody: string;
		redirect: Phrase<"url">;
		notFound: string;
		render: Phrase<"content">;
		/** A response with its status and headers, `details` already joined. */
		withDetails: Phrase<"response" | "details">;
		status: Phrase<"status">;
		headers: Phrase<"headers">;
		/** A status code with its name when known, e.g. "404 Not Found". */
		code: (p: { code: string; name: string | null }) => string;
		statusNames: Record<string, string>;
		setStatus: Phrase<"status">;
		setHeader: Phrase<"name" | "value">;
		appendHeader: Phrase<"name" | "value">;
		removeHeader: Phrase<"name">;
	};
	context: {
		set: Phrase<"name" | "value">;
		get: Phrase<"name">;
		/** `c.executionCtx.waitUntil(p)`. */
		waitUntil: Phrase<"task">;
		/** `env(c)` from `hono/adapter`. */
		env: string;
		/** `c.var`. */
		variables: string;
	};
	middleware: {
		names: Record<Builtin, string>;
		withOptions: Phrase<"name" | "options">;
		/** `createMiddleware(async (c, next) => …)`; its steps follow beneath. */
		custom: string;
		/** `createMiddleware(handler)` with a named handler. */
		customWith: Phrase<"handler">;
		/** `await next()`. */
		next: string;
		/** `timeout(5000)`. */
		timeout: Phrase<"duration">;
	};
	validation: {
		targets: Record<Target, string>;
		/** `zValidator("json", schema)`. */
		check: Phrase<"target" | "schema">;
		/** `validator("form", (value, c) => …)`; its steps follow beneath. */
		customCheck: Phrase<"target">;
		/** Heading over a validator hook's steps. */
		hook: string;
	};
	errors: {
		/** `new HTTPException(401, { message })`; `message` may be null. */
		http: (p: { status: string; message: string | null }) => string;
	};
	client: {
		/** `hc<AppType>(url)`; `type` may be null. */
		create: (p: { type: string | null; url: string }) => string;
		/** `client.posts.$get({ query })` as a value; `parts` may be null. */
		request: (p: { method: string; path: string; client: string; parts: string | null }) => string;
		/** The same call as a statement. */
		send: (p: { method: string; path: string; client: string; parts: string | null }) => string;
		/** `client.posts.$url()`. */
		url: Phrase<"path" | "client">;
		/** One request part, e.g. the query parameters and their value. */
		part: Phrase<"target" | "value">;
	};
	stream: {
		sse: string;
		text: string;
		bytes: string;
		writeSSE: Phrase<"fields">;
		write: Phrase<"value">;
		writeln: Phrase<"value">;
		sleep: Phrase<"duration">;
		pipe: Phrase<"source">;
		onAbort: string;
		onError: string;
		close: string;
	};
	factory: {
		/** `createFactory<Env>()`; `env` may be null. */
		noun: (p: { env: string | null }) => string;
		/** `factory.createHandlers(logger(), (c) => …)`; the last handler's steps follow beneath. */
		handlers: (p: { before: string | null }) => string;
	};
	serve: {
		/** `export default app`. */
		exportApp: Phrase<"app">;
		/** `export default { port, fetch: app.fetch }`, `serve({ fetch: app.fetch, port })`, `Bun.serve(…)`; `port` and `details` may be null. */
		serve: (p: { app: string; port: string | null; details: string | null }) => string;
		/** Heading over `serve(…)`'s listening callback. */
		listening: string;
		/** `handle(app)` from a serverless adapter. */
		adapter: Phrase<"app" | "platform">;
		/** `export default handle(app)`. */
		exportAdapter: Phrase<"app" | "platform">;
		platforms: Record<Platform, string>;
	};
	cookies: {
		get: Phrase<"name">;
		getSigned: Phrase<"name">;
		all: string;
		allSigned: string;
		set: Phrase<"name" | "value">;
		setSigned: Phrase<"name" | "value">;
		delete: Phrase<"name">;
	};
	common: {
		/** "name: value" inside a parenthetical. */
		option: Phrase<"name" | "value">;
		/** Several details joined into one parenthetical. */
		details: (p: { items: string[] }) => string;
		options: Record<OptionKey, string>;
		/** Boolean option values. */
		yes: string;
		no: string;
		units: { milliseconds: Unit; seconds: Unit; minutes: Unit };
	};
};
