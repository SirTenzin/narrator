import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { isCookieStore, isHeaderStore, isNextUrl, isRequest, isRouter, isSearchParams, nextName } from "./facts";
import { type Ctx, codeText, detailsOf, initItems, isFn, keyOf, objectArg, optionText, propOf, secondsText, str } from "./shared";

type Site = { node: N; args: N[]; obj: N | null; stmt: boolean };
export type Rule = (c: Ctx, site: Site) => Doc | string | null;

const scope = (c: Ctx) => ({ e: c.e, facts: c.facts });

/** Runs only when the callee is the named Next.js import. */
const imported =
	(name: string | string[], f: Rule): Rule =>
	(c, site) => {
		const n = nextName(scope(c), site.node.callee);
		return n && (Array.isArray(name) ? name.includes(n) : n === name) ? f(c, site) : null;
	};

/** `NextResponse`, or the web `Response` inside a route handler file. */
export const isResponseClass = (c: Ctx, n: N) => {
	const o = unwrap(n);
	if (o?.type !== "Identifier") return false;
	if (c.facts.imports.get(o.name)?.name === "NextResponse") return true;
	return (
		o.name === "Response" &&
		!c.facts.imports.has("Response") &&
		(c.facts.file?.kind === "route" || c.facts.file?.kind === "middleware" || c.facts.file?.kind === "proxy")
	);
};

/** `NextResponse.json(…)`: the object must be the imported `NextResponse` (or `Response` in a route file). */
const onNextResponse =
	(f: Rule): Rule =>
	(c, site) =>
		isResponseClass(c, site.obj) ? f(c, site) : null;

/** `new URL("/login", request.url)` reads as just `/login`. */
export function urlText(c: Ctx, n: N): string {
	const u = unwrap(n);
	if (u?.type === "NewExpression" && unwrap(u.callee)?.name === "URL" && u.arguments.length === 2) {
		const base = unwrap(u.arguments[1]);
		if (base?.type === "MemberExpression" && !base.computed && ["url", "nextUrl"].includes(base.property.name)) return codeText(c.e, u.arguments[0]);
	}
	return codeText(c.e, n);
}

const tagsText = (c: Ctx, args: N[]) => c.e.g.list(args.map((a) => codeText(c.e, a)));

/** `{ stale: 60, revalidate: 3600 }` as cache-life details. */
function lifeDetails(c: Ctx, n: N): string {
	const o = objectArg(n);
	if (!o) return c.e.text(n);
	const f = c.say.server.cacheLifeFields;
	const items = o.properties.map((p: N) => {
		const k = keyOf(p) as keyof typeof f | null;
		return k && f[k] ? f[k]({ duration: secondsText(c, p.value) }) : optionText(c, p);
	});
	return c.e.g.list(items);
}

const steps = (c: Ctx, fn: N) => {
	const f = unwrap(fn);
	if (f.body.type === "BlockStatement") return c.e.body(f.body, 0);
	return c.e.body({ type: "ExpressionStatement", expression: f.body, start: f.body.start, end: f.body.end }, 0);
};

const serverRules: Record<string, Rule> = {
	redirect: imported("redirect", (c, { args }) => c.say.server.redirect({ path: urlText(c, args[0]) })),
	permanentRedirect: imported("permanentRedirect", (c, { args }) => c.say.server.permanentRedirect({ path: urlText(c, args[0]) })),
	notFound: imported("notFound", (c) => c.say.server.notFound),
	forbidden: imported("forbidden", (c) => c.say.server.forbidden),
	unauthorized: imported("unauthorized", (c) => c.say.server.unauthorized),
	revalidatePath: imported("revalidatePath", (c, { args }) => c.say.server.revalidatePath({ path: codeText(c.e, args[0]), layout: str(args[1]) === "layout" })),
	revalidateTag: imported("revalidateTag", (c, { args }) => {
		const tag = codeText(c.e, args[0]);
		if (!args[1]) return c.say.server.revalidateTag({ tag });
		const profile = str(args[1]);
		if (profile === null) return c.say.server.revalidateTagWith({ tag, profile: null, life: lifeDetails(c, args[1]) });
		return c.say.server.revalidateTagWith({ tag, profile: profile === "max" ? null : codeText(c.e, args[1]), life: null });
	}),
	updateTag: imported("updateTag", (c, { args }) => c.say.server.updateTag({ tag: codeText(c.e, args[0]) })),
	refresh: imported("refresh", (c) => c.say.server.refresh),
	cacheTag: imported(["cacheTag", "unstable_cacheTag"], (c, { args }) => c.say.server.cacheTag({ tags: tagsText(c, args) })),
	unstable_cacheTag: imported(["cacheTag", "unstable_cacheTag"], (c, { args }) => c.say.server.cacheTag({ tags: tagsText(c, args) })),
	cacheLife: imported(["cacheLife", "unstable_cacheLife"], (c, { args }) =>
		str(args[0]) !== null ? c.say.server.cacheLife({ profile: codeText(c.e, args[0]) }) : c.say.server.cacheLifeCustom({ details: lifeDetails(c, args[0]) }),
	),
	unstable_cache: imported("unstable_cache", (c, { args }) => {
		const o = objectArg(args[2]);
		const items: string[] = [];
		const tags = unwrap(propOf(o, "tags"));
		if (tags?.type === "ArrayExpression") items.push(c.say.server.cacheDetails.tags({ tags: tagsText(c, tags.elements) }));
		const every = propOf(o, "revalidate");
		if (every && unwrap(every).value !== false) items.push(c.say.server.cacheDetails.every({ duration: secondsText(c, every) }));
		return c.say.server.unstableCache({ fn: c.e.text(args[0]), details: detailsOf(items) });
	}),
	cookies: imported("cookies", (c) => c.say.server.cookies),
	headers: imported("headers", (c) => c.say.server.headers),
	draftMode: imported("draftMode", (c) => c.say.server.draftMode),
	connection: imported("connection", (c) => c.say.server.connection),
	after: imported("after", (c, { args }) =>
		isFn(args[0]) ? D(`${c.say.server.after}:`, steps(c, args[0])) : D(`${c.say.server.after}, ${c.e.text(args[0])}`),
	),
	dynamic: imported("default", (c, { node, args }) => {
		if (c.facts.imports.get(unwrap(node.callee).name)?.from !== "next/dynamic") return null;
		const body = isFn(args[0]) ? unwrap(c.e.lambdaExpr(unwrap(args[0]))) : null;
		const path = body?.type === "ImportExpression" ? c.e.text(body.source) : body?.type === "CallExpression" ? c.e.text(body) : null;
		if (!path) return null;
		return c.say.dynamicImport({ path, browserOnly: unwrap(propOf(objectArg(args[1]), "ssr"))?.value === false });
	}),
	useRouter: imported("useRouter", (c) => c.say.navigation.router),
	usePathname: imported("usePathname", (c) => c.say.navigation.pathname),
	useSearchParams: imported("useSearchParams", (c) => c.say.navigation.searchParams),
	useParams: imported("useParams", (c) => c.say.navigation.params),
	useSelectedLayoutSegment: imported("useSelectedLayoutSegment", (c) => c.say.navigation.segment),
	useSelectedLayoutSegments: imported("useSelectedLayoutSegments", (c) => c.say.navigation.segments),
	"NextResponse.json": onNextResponse((c, { args }) => {
		const body = c.e.noun(args[0]);
		return D(c.say.responses.json({ body: body.t, details: detailsOf(initItems(c, args[1])) }), body.kids);
	}),
	"NextResponse.redirect": onNextResponse((c, { args }) => {
		const status = args[1] && !objectArg(args[1]) ? [c.e.text(args[1])] : initItems(c, args[1]);
		return c.say.responses.redirect({ url: urlText(c, args[0]), details: detailsOf(status) });
	}),
	"NextResponse.rewrite": onNextResponse((c, { args }) => c.say.responses.rewrite({ url: urlText(c, args[0]) })),
	"NextResponse.next": onNextResponse((c) => c.say.responses.next),
	"new NextResponse": (c, site) => newResponse(c, site),
	"new Response": (c, site) => newResponse(c, site),
	"*.get": (c, { obj, args }) => {
		if (!args[0] || !c.facts.active) return null;
		const name = codeText(c.e, args[0]);
		if (isCookieStore(scope(c), obj)) return c.say.server.cookie({ name });
		if (isHeaderStore(scope(c), obj)) return c.say.server.header({ name });
		if (isSearchParams(scope(c), obj)) return c.say.responses.queryParam({ name });
		return null;
	},
	"*.getAll": (c, { obj, args }) => (!args.length && isCookieStore(scope(c), obj) ? c.say.server.allCookies : null),
	"*.set": (c, { obj, args }) => {
		if (!isCookieStore(scope(c), obj)) return null;
		const o = objectArg(args[0]);
		const [name, value, opts] = o ? [propOf(o, "name"), propOf(o, "value"), null] : args;
		if (!name || !value) return null;
		const optItems = objectArg(opts)?.properties.map((p: N) => optionText(c, p)) ?? [];
		return c.say.server.setCookie({ name: codeText(c.e, name), value: c.e.text(value), details: detailsOf(optItems) });
	},
	"*.delete": (c, { obj, args }) => (args[0] && isCookieStore(scope(c), obj) ? c.say.server.deleteCookie({ name: codeText(c.e, args[0]) }) : null),
	"*.clone": (c, { obj }) => (isNextUrl(scope(c), obj) ? c.say.responses.urlCopy : null),
	"*.push": (c, { obj, args }) => (isRouter(scope(c), obj) ? c.say.navigation.push({ href: urlText(c, args[0]) }) : null),
	"*.replace": (c, { obj, args }) => (isRouter(scope(c), obj) ? c.say.navigation.replace({ href: urlText(c, args[0]) }) : null),
	"*.back": (c, { obj }) => (isRouter(scope(c), obj) ? c.say.navigation.back : null),
	"*.forward": (c, { obj }) => (isRouter(scope(c), obj) ? c.say.navigation.forward : null),
	"*.refresh": (c, { obj }) => (isRouter(scope(c), obj) ? c.say.navigation.refresh : null),
	"*.prefetch": (c, { obj, args }) => (isRouter(scope(c), obj) ? c.say.navigation.prefetch({ href: urlText(c, args[0]) }) : null),
};

function newResponse(c: Ctx, { node, args }: Site) {
	if (!isResponseClass(c, node.callee)) return null;
	const body = args[0] && unwrap(args[0]).value !== null ? c.e.text(args[0]) : null;
	return c.say.responses.response({ body, details: detailsOf(initItems(c, args[1])) });
}

export const calls = (): Record<string, Rule> => {
	const out = { ...serverRules };
	for (const m of ["json", "redirect"]) out[`Response.${m}`] = out[`NextResponse.${m}`]!;
	return out;
};

type Cond = (c: Ctx, site: { obj: N | null; args: N[]; neg: boolean }) => string | null;

export const conditions = (): Record<string, Cond> => ({
	"*.has": (c, { obj, args, neg }) => {
		if (!args[0]) return null;
		const name = codeText(c.e, args[0]);
		if (isCookieStore(scope(c), obj)) return c.say.server.hasCookie({ name, neg });
		if (isHeaderStore(scope(c), obj)) return c.say.server.hasHeader({ name, neg });
		return null;
	},
});

type Member = (c: Ctx, site: { obj: N; prop: string }) => string | null;

/** A cookie read: `cookies().get("x")` or `store.get("x")`. */
const isCookieRead = (c: Ctx, n: N) => {
	const u = unwrap(n);
	const callee = unwrap(u?.callee);
	return u?.type === "CallExpression" && callee?.type === "MemberExpression" && callee.property.name === "get" && isCookieStore(scope(c), callee.object);
};

export const members = (): Record<string, Member> => ({
	"*.nextUrl.pathname": (c, { obj }) => (isNextUrl(scope(c), obj) ? c.say.responses.requestPath : null),
	"*.nextUrl.searchParams": (c, { obj }) => (isNextUrl(scope(c), obj) ? c.say.responses.queryParams : null),
	"*.nextUrl": (c, { obj }) => (isRequest(scope(c), obj) ? c.say.responses.requestUrl : null),
	"*.value": (c, { obj }) => (isCookieRead(c, obj) ? c.say.server.cookieValue({ cookie: c.e.text(obj) }) : null),
	"*.query": (c, { obj }) => (isRouter(scope(c), obj) ? c.say.navigation.query : null),
	"*.pathname": (c, { obj }) => (isRouter(scope(c), obj) ? c.say.navigation.pathname : null),
	"*.asPath": (c, { obj }) => (isRouter(scope(c), obj) ? c.say.navigation.asPath : null),
	"*.isReady": (c, { obj }) => (isRouter(scope(c), obj) ? c.say.navigation.isReady : null),
});
