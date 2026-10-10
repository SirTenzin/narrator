/** A phrase built from already-rendered strings. */
type P<K extends string> = (p: { [k in K]: string }) => string;
/** A description ("the response to …") and a step to do ("send …"). */
type Form<K extends string> = { noun: P<K>; act: P<K> };

/** Every English fragment of the Effect HTTP companion plugin (`@usenarrator/plugin-effect/platform`). */
export type PlatformPhrases = {
	/** Exact source text of bare platform values (`HttpServer.withLogAddress`) -> how to say them. */
	constants: Record<string, string>;
	common: { labeled: P<"label" | "value">; stepFn: P<"step"> };
	client: {
		request: Form<"method" | "url">;
		requestWith: Form<"method" | "url" | "options">;
		execute: Form<"request">;
		newRequest: P<"method" | "url">;
		bodyJson: P<"body">;
		header: P<"name" | "value">;
		bearer: P<"token">;
		acceptJson: string;
		urlParams: P<"params">;
		prependUrl: P<"url">;
		filterStatusOk: string;
		retryTransient: P<"how">;
		retryTransientBare: string;
		times: P<"n">;
		jsonBody: Form<"response" | "type">;
		jsonBodyReader: P<"type">;
	};
	server: {
		json: P<"value">;
		text: P<"text">;
		html: P<"html">;
		empty: string;
		redirect: P<"url">;
		withStatus: P<"response" | "status">;
		requestBody: Form<"type">;
		pathParams: Form<"type">;
		searchParams: Form<"type">;
		serve: string;
	};
	router: {
		routes: string;
		route: P<"method" | "path" | "handler">;
		routeLayer: P<"method" | "path" | "handler">;
		mount: P<"prefix" | "router">;
		prefixAll: P<"prefix">;
		use: P<"middleware">;
		routesAdded: string;
	};
	api: {
		endpoint: P<"name" | "method" | "path">;
		params: P<"type">;
		query: P<"type">;
		payload: P<"type">;
		headers: P<"type">;
		success: P<"type">;
		error: P<"type">;
		errorStatus: P<"type" | "status">;
		group: P<"name">;
		api: P<"name">;
		prefix: P<"path">;
		namedGroup: P<"name" | "id">;
		namedApi: P<"name" | "id">;
		handlers: P<"group" | "api">;
		handler: P<"name" | "action">;
		handlerSteps: P<"name">;
		serveApi: P<"api">;
	};
};
