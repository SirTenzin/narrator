/** Arguments are already-rendered markup strings unless typed otherwise. */
type P<K extends string> = { [key in K]: string };
type Phrase<K extends string> = (p: P<K>) => string;

/** Middleware the plugin names: Express's own and the common packages around it. */
export type Builtin =
	| "json"
	| "urlencoded"
	| "raw"
	| "text"
	| "static"
	| "cors"
	| "helmet"
	| "morgan"
	| "cookieParser"
	| "compression"
	| "rateLimit"
	| "session"
	| "methodOverride"
	| "favicon";

/** Package that exports each third-party builtin; Express's own come from `express`. */
export type Source = Exclude<Builtin, "json" | "urlencoded" | "raw" | "text" | "static">;

/** Express phrasebook. A translator implements this type in `src/<locale>.ts`. */
export type ExpressPhrases = {
	app: {
		/** `express()`. */
		noun: string;
		/** `express.Router()`; `details` may be null. */
		router: (p: { details: string | null }) => string;
		/** `express.Router({ mergeParams: true })`. */
		mergeParams: string;
		caseSensitive: string;
		strict: string;
	};
	routes: {
		/** One route. `method` is null for `app.all`; `handler` is set when the handler reads inline; `before` lists middleware. */
		answer: (p: { method: string | null; path: string | null; handler: string | null; before: string | null }) => string;
		/** `app.route("/book")` heading; its methods follow as bullets. */
		forPath: Phrase<"path">;
		/** `app.use(cors(), express.json())`; `path` is null for every request. */
		use: (p: { middleware: string; path: string | null }) => string;
		/** `app.use(async (req, res, next) => …)` heading. */
		useInline: (p: { path: string | null }) => string;
		/** `app.use("/api", apiRouter)`. */
		mount: Phrase<"router" | "path">;
		/** `app.use((err, req, res, next) => …)` heading: the error handler. */
		onError: (p: { path: string | null }) => string;
		/** `app.param("id", (req, res, next, id) => …)` heading. */
		param: Phrase<"name">;
		/** `...handlers` spread into a route. */
		everythingIn: Phrase<"value">;
	};
	settings: {
		/** `app.set("view engine", "pug")`. */
		set: Phrase<"name" | "value">;
		/** `app.get("view engine")` with one argument: a setting, not a route. */
		get: Phrase<"name">;
		enable: Phrase<"name">;
		disable: Phrase<"name">;
		/** `app.enabled("trust proxy")` as a condition. */
		enabled: (p: { name: string; neg: boolean }) => string;
		/** `app.engine("hbs", engine)`. */
		engine: Phrase<"ext" | "engine">;
	};
	request: {
		params: string;
		param: Phrase<"name">;
		query: string;
		queryParam: Phrase<"name">;
		body: string;
		headers: string;
		header: Phrase<"name">;
		cookies: string;
		cookie: Phrase<"name">;
		signedCookies: string;
		ip: string;
		path: string;
		method: string;
		url: string;
		originalUrl: string;
		hostname: string;
		protocol: string;
		/** `req.is("json")` as a condition. */
		is: (p: { type: string; neg: boolean }) => string;
		/** `req.accepts("html")`. */
		accepts: Phrase<"types">;
	};
	response: {
		/** A response sent as a statement: `res.json(x)`, `return res.status(404).send(…)`. */
		reply: Phrase<"response">;
		json: Phrase<"data">;
		send: Phrase<"body">;
		/** `res.send()` / `res.end()` with nothing. */
		empty: string;
		/** `res.sendStatus(204)`. */
		statusOnly: Phrase<"status">;
		/** `res.render("profile", { user })`; `locals` may be null. */
		render: (p: { view: string; locals: string | null }) => string;
		file: Phrase<"path">;
		download: Phrase<"path">;
		jsonp: Phrase<"data">;
		/** A response with its status, as in `res.status(201).json(…)`. */
		withStatus: Phrase<"response" | "status">;
		/** A status code with its name when known, e.g. "404 Not Found". */
		code: (p: { code: string; name: string | null }) => string;
		statusNames: Record<string, string>;
		/** `res.redirect(url)` / `res.redirect(301, url)`; `status` may be null. */
		redirect: (p: { url: string; status: string | null }) => string;
		/** `res.status(201)` on its own. */
		setStatus: Phrase<"status">;
		setHeader: Phrase<"name" | "value">;
		setHeaders: Phrase<"headers">;
		appendHeader: Phrase<"name" | "value">;
		/** `res.type("json")`. */
		setType: Phrase<"type">;
		/** `res.cookie(name, value, options?)`; `options` may be null. */
		setCookie: (p: { name: string; value: string; options: string | null }) => string;
		clearCookie: Phrase<"name">;
		/** `res.locals.user = user` read as a value. */
		locals: string;
		/** `res.headersSent` as a condition. */
		headersSent: (p: { neg: boolean }) => string;
		/** `res.end()` as a statement. */
		end: string;
	};
	next: {
		/** `next()`. */
		next: string;
		/** `next(err)`. */
		fail: Phrase<"error">;
		/** `next("route")`: skip the rest of this route's handlers. */
		skipRoute: string;
	};
	middleware: {
		names: Record<Builtin, string>;
		withOptions: Phrase<"name" | "options">;
		/** `express.static("public")`. */
		staticFrom: Phrase<"root">;
		/** `morgan("dev")`. */
		logFormat: Phrase<"format">;
	};
	server: {
		/** `app.listen(3000, cb?)`; `port` may be null. */
		listen: (p: { app: string; port: string | null; host: string | null }) => string;
		/** Heading over `listen`'s callback. */
		listening: string;
	};
	common: {
		option: Phrase<"name" | "value">;
		details: (p: { items: string[] }) => string;
		yes: string;
		no: string;
	};
};
