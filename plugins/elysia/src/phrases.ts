/** Arguments are already-rendered markup strings. */
type P<K extends string> = (p: { [key in K]: string }) => string;
/** A count phrase; `n` is the number when it's a literal, so a translator can pick singular or plural. */
type Count<K extends string = never> = (p: { [key in K]: string } & { count: string; n: number | null }) => string;

/** Lifecycle events, named as in Elysia 2 (Elysia 1 adds an `on` prefix: `onBeforeHandle`). */
export type LifecycleEvent =
	| "request"
	| "parse"
	| "transform"
	| "beforeHandle"
	| "afterHandle"
	| "mapResponse"
	| "error"
	| "afterResponse"
	| "start"
	| "stop"
	| "trace";

/** Where a hook applies: Elysia 1 `{ as: "scoped" }`, Elysia 2 `"plugin"`. */
export type HookScope = "local" | "scoped" | "global" | "plugin";

/** Request parts a route can validate. */
export type RequestPart = "body" | "query" | "params" | "headers" | "cookie";

/** Built-in TypeBox / Elysia types that take no type arguments. */
export type BaseType =
	| "String"
	| "Number"
	| "Integer"
	| "Boolean"
	| "Null"
	| "Undefined"
	| "Void"
	| "Any"
	| "Unknown"
	| "Never"
	| "Date"
	| "BigInt"
	| "Symbol"
	| "Uint8Array"
	| "Numeric"
	| "BooleanString"
	| "ObjectString"
	| "ArrayString"
	| "File"
	| "Files";

/** String formats TypeBox / Elysia check (`t.String({ format: "email" })`). */
export type StringFormat = "email" | "uri" | "url" | "uuid" | "date" | "date-time" | "time" | "ipv4" | "ipv6" | "hostname" | "uri-reference" | "regex";

/** Elysia (elysiajs.com) phrasebook. A translator implements this type in `src/<locale>.ts`. */
export type ElysiaPhrases = {
	app: {
		/** `new Elysia()`; `traits` are rendered constructor options (prefix, name, …), maybe empty. */
		server: (p: { traits: string[] }) => string;
		prefix: P<"prefix">;
		/** `name` makes Elysia apply the plugin only once. */
		name: P<"name">;
		option: P<"name" | "value">;
		/** Several steps added to an existing app: `app.get(...).post(...)`. */
		onApp: P<"app">;
		/** One step added to an existing app. */
		stepOnApp: P<"app" | "step">;
		/** `app.handle(request)`: the response the app gives, used as a value. */
		handle: P<"app" | "request">;
		stop: string;
		compile: string;
		/** Any other instance method; `args` may be empty. */
		other: P<"method" | "args">;
	};
	routes: {
		/** `method` is an HTTP method (`GET`) or `anyMethod`. */
		answer: P<"method" | "path">;
		/** A handler that's a single value or expression. */
		answerWith: P<"method" | "path" | "reply">;
		/** A handler passed by name. */
		answerUsing: P<"method" | "path" | "handler">;
		/** `.all(path, …)`. */
		anyMethod: string;
		/** Introduces a handler's steps when the route also lists rules. */
		handler: string;
		replyWith: P<"reply">;
		handledBy: P<"handler">;
		/** `.ws(path, options)`. */
		websocket: P<"path">;
		/** WebSocket handler keys. */
		ws: Record<"open" | "message" | "close" | "drain" | "ping" | "pong", string>;
		/** `.mount(path, handler)` / `.mount(handler)`. */
		mount: P<"path" | "handler">;
		mountAll: P<"handler">;
	};
	hooks: {
		/** "the body must be …"; `schema` is a rendered schema. */
		validate: Record<RequestPart, P<"schema">>;
		response: P<"schema">;
		/** `response: { 200: …, 404: … }` introduces one bullet per status. */
		responses: string;
		responseFor: P<"status" | "schema">;
		/** Lifecycle hook intros inside one route's options. */
		local: Record<LifecycleEvent, string>;
		/** Lifecycle hook intros registered on the app (`.onBeforeHandle(fn)`), for every route after it. */
		app: Record<LifecycleEvent, string>;
		/** A hook given as a named function. */
		callBy: P<"intro" | "fn">;
		/** `parse: "json"`: how to read the body; `type` is from `parsers` or the literal. */
		parseAs: P<"type">;
		parsers: Record<string, string>;
		/** A hook intro with where it also applies. */
		withScope: (p: { thing: string; scope: HookScope }) => string;
		/** `as: "scoped"` on its own (guards, `.as()`). */
		scope: Record<HookScope, string>;
		/** Elysia 2 `schema: "standalone"`: guard schemas add to a route's own. */
		standalone: string;
		/** Elysia 2 `schema: "override"`: a route's own schema replaces the guard's. */
		override: string;
		/** `detail: {...}` OpenAPI docs. */
		docs: string;
		summary: P<"value">;
		description: P<"value">;
		tags: P<"items">;
		deprecated: string;
		hidden: string;
		operationId: P<"value">;
		/** Macro options (`auth: true`) and anything else the plugin doesn't know. */
		turnedOn: P<"name">;
		turnedOff: P<"name">;
		option: P<"name" | "value">;
		/** Hook options passed as a variable. */
		from: P<"value">;
	};
	context: {
		/** `.derive(fn)`: per-request values; `stage` says when it runs relative to validation (null when version-neutral). */
		derive: (p: { names: string; stage: "beforeValidation" | "afterValidation" | null }) => string;
		/** `.derive(fn)` whose result names can't be listed. */
		deriveSome: (p: { stage: "beforeValidation" | "afterValidation" | null }) => string;
		state: P<"name" | "value">;
		stateAll: string;
		decorate: P<"name" | "value">;
		decorateSame: P<"name">;
		decorateAll: string;
		models: string;
		model: P<"name" | "schema">;
		macro: P<"name">;
		macros: string;
		/** Elysia 1 `.error({ CODE: Class })`. */
		errorCodes: string;
		errorCode: P<"code" | "error">;
		/** Elysia 2 `.error(Class, fn)` / `.error(fn)`. */
		onError: P<"error">;
		onAnyError: string;
		headers: P<"headers">;
		/** `.as("scoped")`: lifts the hooks above it to a wider scope. */
		share: Record<HookScope, string>;
	};
	compose: {
		/** `.use(subApp)`. */
		useApp: P<"app">;
		/** `.use(import("./x"))`. */
		useLazy: P<"path">;
		use: P<"plugin">;
		/** `.group(prefix, app => …)`. */
		group: P<"prefix">;
		/** `.guard(hook, app => …)`. */
		guardInside: string;
		/** `.guard(hook)`: rules for every route after it. */
		guardRest: string;
		/** Introduces the guard's shared rules. */
		guardRules: string;
	};
	listen: {
		port: P<"port">;
		portHost: P<"port" | "host">;
		options: P<"options">;
		/** Introduces the `.listen(port, callback)` body. */
		then: string;
	};
	plugins: {
		cors: string;
		swagger: string;
		openapi: string;
		docsAt: P<"docs" | "path">;
		jwt: P<"name">;
		jwtSecret: P<"secret">;
		jwtExpires: P<"duration">;
		/** `staticPlugin({ assets, prefix })`; either may be null when left at its default. */
		staticFiles: (p: { folder: string | null; prefix: string | null }) => string;
		html: string;
		bearer: string;
		serverTiming: string;
		opentelemetry: string;
		cron: P<"name" | "pattern">;
		cronRun: string;
		option: P<"name" | "value">;
	};
	responses: {
		/** `code` and `name` are the HTTP status; `name` may be empty. */
		status: P<"code" | "name">;
		/** `status(404, "Not found")` used as a value. */
		statusValue: P<"status">;
		statusWith: P<"status" | "value">;
		/** `return status(...)` / `return redirect(...)`. */
		reply: P<"response">;
		/** HTTP status names by code. */
		names: Record<number, string>;
		redirect: P<"url">;
		redirectWith: P<"url" | "status">;
		/** Elysia 2 `problem(status, { detail })` (RFC 9457). */
		problem: P<"status">;
		problemWith: P<"status" | "detail">;
		setStatus: P<"status">;
		setHeader: P<"name" | "value">;
		setRedirect: P<"url">;
		jwtSign: P<"payload">;
		jwtVerify: P<"token">;
	};
	schema: {
		/** A TypeBox schema used as a value. */
		of: P<"type">;
		base: Record<BaseType, string>;
		formats: Record<StringFormat, string>;
		object: P<"fields">;
		emptyObject: string;
		field: P<"name" | "type">;
		optionalField: P<"name" | "type">;
		optional: P<"type">;
		array: P<"item">;
		oneOf: P<"options">;
		either: P<"options">;
		literal: P<"value">;
		nullable: P<"type">;
		maybeEmpty: P<"type">;
		record: P<"key" | "value">;
		tuple: P<"items">;
		enumOf: P<"name">;
		keysOf: P<"type">;
		model: P<"name">;
		modelList: P<"name">;
		partial: P<"type">;
		required: P<"type">;
		pick: P<"type" | "keys">;
		omit: P<"type" | "keys">;
		allOf: P<"types">;
		not: P<"type">;
		cookie: P<"type">;
		form: P<"type">;
		unchecked: P<"type">;
		/** A type followed by its rendered options, e.g. "text (at least 1 character)". */
		withModifiers: (p: { type: string; modifiers: string[] }) => string;
		modifiers: {
			minLength: Count;
			maxLength: Count;
			minimum: P<"value">;
			maximum: P<"value">;
			exclusiveMinimum: P<"value">;
			exclusiveMaximum: P<"value">;
			multipleOf: P<"value">;
			minItems: Count;
			maxItems: Count;
			uniqueItems: string;
			pattern: P<"pattern">;
			default: P<"value">;
			format: P<"format">;
			description: P<"text">;
			error: P<"message">;
			fileType: P<"types">;
			maxSize: P<"size">;
			minSize: P<"size">;
			option: P<"name" | "value">;
		};
	};
	eden: {
		/** `treaty<App>(url)`; `app` is the type argument, maybe empty. */
		client: P<"app" | "url">;
		/** `treaty(app)`: calls the app in-process. */
		clientDirect: P<"app">;
		/** An Eden call as a statement; `details` are rendered params/body/query/headers. */
		send: (p: { method: string; path: string; client: string; details: string[] }) => string;
		/** An Eden call used as a value. */
		reply: (p: { method: string; path: string; client: string; details: string[] }) => string;
		/** `.subscribe()` on a WebSocket route. */
		subscribe: P<"path" | "client">;
		param: P<"name" | "value">;
		body: P<"value">;
		query: P<"value">;
		headers: P<"value">;
		option: P<"name" | "value">;
	};
};
