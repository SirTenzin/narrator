import { D, type Doc, mk } from "@usenarrator/core";
import { type CallRule, type CondRule, definePlugin, type N, type StmtRule, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { clientSpecs, pluginDoc, serverSpecs } from "./config";
import { en } from "./en";
import { endpointCalls, fieldSpecs } from "./endpoints";
import type { BetterAuthPhrases } from "./phrases";
import { type Ctx, callbackDoc, calleeName, findProp, fnBody, isFn, keyOf, literal, objectArg, optionDocs } from "./render";

export { en } from "./en";
export type { BetterAuthPhrases } from "./phrases";

type P = BetterAuthPhrases;
type Rule = CallRule<P>;

/** `betterAuth({...})` / `createAuthClient({...})` as "set up authentication with:" plus one bullet per option. */
function setupDoc({ e, say, args, client, name }: Ctx & { args: N[]; client: boolean; name: string | null }): Doc {
	const s = say.setup;
	const arg = args[0];
	const opts: Doc[] = !arg
		? []
		: objectArg(arg)
			? optionDocs({ e, say, node: arg, specs: client ? clientSpecs(fieldSpecs) : serverSpecs })
			: [D(say.frame.everythingIn({ value: e.text(arg) }))];
	if (!opts.length) {
		if (client) return D(name ? s.clientDefaultAs({ name }) : s.clientDefault);
		return D(name ? s.serverDefaultAs({ name }) : s.serverDefault);
	}
	const title = client ? (name ? s.clientAs({ name }) : s.client) : name ? s.serverAs({ name }) : s.server;
	return D(
		title,
		opts.flatMap((o) => e.bullet(o)),
	);
}

/** `const auth = betterAuth(...)` and route exports like `export const { GET, POST } = toNextJsHandler(auth)`. */
const setupStatement: StmtRule<P> = ({ node, e, d, say }) => {
	if (node.type !== "VariableDeclaration" || node.declarations.length !== 1) return false;
	const v = node.declarations[0];
	const init = unwrap(v.init);
	const fn = init?.type === "CallExpression" ? calleeName(init) : null;
	if (v.id.type === "Identifier" && (fn === "betterAuth" || fn === "createAuthClient") && fromBetterAuth({ e, node: init })) {
		e.emitDoc(d, setupDoc({ e, say, args: init.arguments, client: fn === "createAuthClient", name: e.ref(v.id.name) }), node);
		return true;
	}
	if (v.id.type === "ObjectPattern" && (fn === "toNextJsHandler" || fn === "toSolidStartHandler") && fromBetterAuth({ e, node: init })) {
		const methods = v.id.properties.map((p: N) => mk("l", keyOf(p) ?? e.code(p)));
		e.emitDoc(d, D(say.mount.routeMethods({ auth: e.text(init.arguments[0]), methods: e.g.list(methods) })), node);
		return true;
	}
	return false;
};

const ADAPTERS: Record<string, keyof P["orms"]> = {
	drizzleAdapter: "drizzle",
	prismaAdapter: "prisma",
	mongodbAdapter: "mongodb",
	kyselyAdapter: "kysely",
};

/** `drizzleAdapter(db, { provider: "pg" })` -> "DB through Drizzle (PostgreSQL)". */
const adapterRule =
	(orm: keyof P["orms"]): Rule =>
	({ e, say, args }) => {
		const db = e.text(args[0]);
		const opts = objectArg(args[1]);
		const p = findProp(opts, "provider") ?? findProp(opts, "type");
		if (!p) return D(say.adapterNoProvider({ orm: say.orms[orm], db }));
		const lit = literal(p.value);
		const provider = (typeof lit === "string" && say.databases[lit]) || e.text(p.value);
		return D(say.adapter({ orm: say.orms[orm], db, provider }));
	};

const pluginRule =
	(name: string): Rule =>
	({ e, say, args }) =>
		pluginDoc({ e, say, name, args });

/** The handler a framework route forwards to: `toNodeHandler(auth)` or `auth.handler`. */
function forwardedAuth({ e, node }: Pick<Ctx, "e"> & { node: N }): string | null {
	const u = unwrap(node);
	if (u?.type === "CallExpression" && calleeName(u) === "toNodeHandler") return e.text(u.arguments[0]);
	if (u?.type === "MemberExpression" && !u.computed && u.property.name === "handler") return e.text(u.object);
	return null;
}

/** `app.all("/api/auth/*", toNodeHandler(auth))` -> "send every request under "/api/auth/*" to auth". */
const mountRoute: Rule = ({ e, say, args }) => {
	const last = args.at(-1);
	const auth = last ? forwardedAuth({ e, node: last }) : null;
	if (!auth) return null;
	if (args.length === 1) return D(say.mount.routeAll({ auth }));
	return D(say.mount.route({ path: e.text(args[0]), auth }));
};

const looksLikeAuth = (n: N) => unwrap(n)?.type === "Identifier" && /auth/i.test(unwrap(n).name);

function statusText({ e, say, node }: Ctx & { node: N }): string {
	const lit = literal(node);
	return (typeof lit === "string" && say.errors.statuses[lit]) || say.errors.unknownStatus({ value: node ? e.text(node) : "" });
}

/** `new APIError("BAD_REQUEST", { message })` -> "a bad-request error: message". */
const apiError: Rule = ({ e, say, args }) => {
	const error = statusText({ e, say, node: args[0] });
	const msg = findProp(objectArg(args[1]), "message");
	if (!msg) return D(error);
	const m = e.noun(msg.value);
	return D(say.errors.apiError({ error, message: m.t }), m.kids);
};

const isApiError: CondRule<P> = ({ e, say, args, neg }) => D(say.errors.isApiError({ value: e.text(args[0]), neg }));

/** `createAuthEndpoint("/hello", { method: "GET", use: [sessionMiddleware] }, handler)`. */
const authEndpoint: Rule = ({ e, say, args }) => {
	const opts = objectArg(args[1]);
	const m = findProp(opts, "method")?.value;
	const mu = unwrap(m);
	const methods =
		mu?.type === "ArrayExpression" ? mu.elements.map((x: N) => mk("l", String(literal(x) ?? e.code(x)))) : m ? [mk("l", String(literal(m) ?? e.code(m)))] : [];
	const use = unwrap(findProp(opts, "use")?.value);
	const signedIn = use?.type === "ArrayExpression" && use.elements.some((x: N) => unwrap(x)?.name === "sessionMiddleware");
	const handler = unwrap(args[2]);
	const title = say.helpers.endpoint({ path: e.text(args[0]), method: e.g.list(methods, "or"), signedIn });
	return D(title, isFn(handler) ? fnBody(e, handler) : []);
};

const middleware: Rule = ({ e, say, args }) => {
	const fn = unwrap(args[0]);
	if (!isFn(fn)) return null;
	return D(say.helpers.middleware, fnBody(e, fn));
};

const customSession: Rule = ({ e, say, args }) =>
	args[0] ? callbackDoc({ e, say, node: args[0], intro: say.plugins.customSession }) : D(say.plugins.features.customSession!);

const PLUGIN_NAMES = [
	"twoFactor",
	"organization",
	"admin",
	"passkey",
	"magicLink",
	"emailOTP",
	"username",
	"anonymous",
	"phoneNumber",
	"jwt",
	"bearer",
	"apiKey",
	"multiSession",
	"oneTap",
	"genericOAuth",
	"sso",
	"stripe",
	"autumn",
	"polar",
	"openAPI",
	"nextCookies",
	"haveIBeenPwned",
	"captcha",
	"oidcProvider",
	"mcp",
	"lastLoginMethod",
	"deviceAuthorization",
	"inferAdditionalFields",
];

const pluginCalls: Record<string, Rule> = Object.fromEntries(
	PLUGIN_NAMES.flatMap((n) => [
		[n, pluginRule(n)],
		[`${n}Client`, pluginRule(`${n}Client`)],
	]),
);

const bareCalls: Record<string, Rule> = {
	betterAuth: ({ e, say, args }) => setupDoc({ e, say, args, client: false, name: null }),
	createAuthClient: ({ e, say, args }) => setupDoc({ e, say, args, client: true, name: null }),
	...Object.fromEntries(Object.entries(ADAPTERS).map(([k, orm]) => [k, adapterRule(orm)])),
	customSession,
	customSessionClient: pluginRule("customSession"),
	toNextJsHandler: ({ e, say, args }) => D(say.mount.nextHandlers({ auth: e.text(args[0]) })),
	toNodeHandler: ({ e, say, args }) => D(say.mount.nodeHandler({ auth: e.text(args[0]) })),
	toSolidStartHandler: ({ e, say, args }) => D(say.mount.solidStartHandler({ auth: e.text(args[0]) })),
	svelteKitHandler: ({ e, say, args }) => {
		const auth = findProp(objectArg(args[0]), "auth");
		return auth ? D(say.mount.svelteKitHandler({ auth: e.text(auth.value) })) : null;
	},
	headers: ({ say, args }) => (args.length ? null : D(say.mount.requestHeaders)),
	fromNodeHeaders: ({ e, args }) => e.noun(args[0]),
	createAuthMiddleware: middleware,
	createAuthEndpoint: authEndpoint,
	getSessionFromCtx: ({ say }) => D(say.helpers.sessionFromContext),
	getSessionCookie: ({ e, say, args }) => D(say.helpers.sessionCookie({ request: e.text(args[0]) })),
	getCookieCache: ({ e, say, args }) => D(say.helpers.cookieCache({ request: e.text(args[0]) })),
};

/** `better-auth`, `better-auth/plugins`, `@better-auth/sso`, and integrations like `autumn-js/better-auth`. */
const isBetterAuthModule = (m: string) => /(^|[/@])better-auth(\/|$)/.test(m);

/**
 * A bare call like `organization()` or `betterAuth()` is Better Auth's when its name is imported from a Better Auth
 * package, or isn't imported (nor declared here) in a file whose package depends on Better Auth.
 */
function fromBetterAuth({ e, node, also }: { e: Ctx["e"]; node: N; also?: string }): boolean {
	const callee = unwrap(node.callee);
	const name = callee?.type === "Identifier" ? callee.name : null;
	if (!name) return false;
	const from = e.imports.get(name)?.from;
	if (from) return isBetterAuthModule(from) || from === also;
	return !e.localFns.has(name) && e.usesLibrary("better-auth");
}

/** Gates every bare-name rule on `fromBetterAuth`; member rules (`auth.api.*`, `*.handler`) keep their own shape checks. */
const gated = (rules: Record<string, Rule>, also?: Record<string, string>): Record<string, Rule> =>
	Object.fromEntries(
		Object.entries(rules).map(([k, r]) => [k, k.includes(".") ? r : (ctx) => (fromBetterAuth({ e: ctx.e, node: ctx.node, also: also?.[k] }) ? r(ctx) : null)]),
	);

/** Better Auth (better-auth.com): server config, `auth.api.*`, the client, hooks, handlers, and plugin helpers. */
export const betterAuth = (): TsPlugin<P> =>
	definePlugin<P>({
		name: "better-auth",
		library: { name: "better-auth", versions: ">=1.2 <2" },
		phrases: { en },
		statements: [setupStatement],
		calls: {
			...gated(pluginCalls),
			...endpointCalls(),
			...gated(bareCalls, { headers: "next/headers" }),
			"*.handler": ({ e, say, args, obj }) => (looksLikeAuth(obj) ? D(say.mount.handle({ auth: e.text(obj), request: e.text(args[0]) })) : null),
			"*.all": mountRoute,
			"*.use": mountRoute,
			"new APIError": (ctx) => (fromBetterAuth({ e: ctx.e, node: ctx.node }) ? apiError(ctx) : null),
		},
		conditions: { isAPIError: (ctx) => (fromBetterAuth({ e: ctx.e, node: ctx.node }) ? isApiError(ctx) : null) },
	});

declare module "@usenarrator/core" {
	interface PluginPhrases {
		"better-auth": BetterAuthPhrases;
	}
}
