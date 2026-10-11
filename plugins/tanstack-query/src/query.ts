import { D, type Doc, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { importedAs } from "./facts";
import type { OptionKey } from "./phrases";
import { bool, type Ctx, callbackDoc, exprOrSteps, isFn, isIdent, keyOf, msText, objectArg, propOf, queryName, str, withDetails } from "./shared";

export type QueryKind = "query" | "infinite" | "suspense" | "suspenseInfinite";

/** A query's options, whether passed as one object (v5) or as v4's `(key, fn, options)`. */
type QueryArgs = { key: N | null; fn: N | null; props: N[] } | { from: N };

export function queryArgs(args: N[]): QueryArgs | null {
	const [a, b, c] = args.map(unwrap);
	if (!a) return null;
	const o = objectArg(a);
	if (o) return { key: propOf(o, "queryKey"), fn: null, props: o.properties };
	if (args.length === 1 && a.type !== "ArrayExpression" && str(a) === null) return { from: a };
	const fnArg = b && (isFn(b) || b.type === "Identifier" || b.type === "MemberExpression") ? b : null;
	const opts = objectArg(fnArg ? c : b);
	return { key: a, fn: fnArg, props: opts?.properties ?? [] };
}

const callbackHeads = (c: Ctx) => ({
	onSuccess: c.say.options.onLoad,
	onError: c.say.options.onLoadError,
	onSettled: c.say.options.onLoadSettled,
});

function refetchOn(c: Ctx, event: "focus" | "mount" | "reconnect", v: N): Doc {
	const b = bool(v);
	const s = str(v);
	const mode = b === false ? "never" : s === "always" ? "always" : b === true ? "stale" : "other";
	return D(c.say.options.refetchOn({ event, mode, value: c.e.text(v) }));
}

/** One query or mutation option as a detail, or null to leave it out. */
export function optionDoc(c: Ctx, key: string, v: N, kind: "query" | "mutation"): Doc | null {
	const { e, say } = c;
	const o = say.options;
	const ms = (f: (p: { duration: string }) => string, forever: string) => {
		const d = msText(c, v);
		return D(d === null ? forever : f({ duration: d }));
	};
	switch (key) {
		case "queryKey":
		case "mutationKey":
			return null;
		case "queryFn":
			return exprOrSteps(c, v, (fn) => o.fetchedBy({ fn }), o.fetchSteps);
		case "enabled": {
			if (bool(v) === true) return null;
			if (bool(v) === false) return D(o.manualOnly);
			if (isFn(v)) {
				const ex = e.lambdaExpr(unwrap(v));
				if (ex) return D(o.onlyWhen({ condition: e.cond(ex).t }), e.cond(ex).kids);
			}
			const cnd = e.cond(v);
			return D(o.onlyWhen({ condition: cnd.t }), cnd.kids);
		}
		case "staleTime":
			if (str(v) === "static") return D(o.static);
			return ms(o.freshFor, o.neverStale);
		case "gcTime":
		case "cacheTime":
			return ms(o.keptFor, o.keptForever);
		case "refetchInterval":
			if (bool(v) === false) return null;
			if (isFn(v))
				return exprOrSteps(
					c,
					v,
					(fn) => o.pollWith({ fn }),
					() => o.pollWith({ fn: e.text(v) }),
				);
			return ms(o.pollEvery, o.neverStale);
		case "refetchIntervalInBackground":
			return bool(v) === true ? D(o.pollInBackground) : null;
		case "refetchOnWindowFocus":
			return refetchOn(c, "focus", v);
		case "refetchOnMount":
			return refetchOn(c, "mount", v);
		case "refetchOnReconnect":
			return refetchOn(c, "reconnect", v);
		case "retry": {
			if (bool(v) === false) return D(o.noRetry);
			if (bool(v) === true) return D(o.retryForever);
			const n = e.fold(v);
			if (n !== null && Number.isInteger(n)) return D(n === 0 ? o.noRetry : o.retryTimes({ count: mk("l", e.g.formatNumber(n)), n }));
			if (isFn(v)) {
				const ex = e.lambdaExpr(unwrap(v));
				if (ex) return D(o.retryWhen({ fn: e.cond(ex).t }));
			}
			return D(o.option({ name: o.names.retry, value: e.text(v) }));
		}
		case "retryDelay": {
			if (isFn(v)) return D(o.retryDelay({ delay: e.text(v) }));
			const d = msText(c, v);
			return D(o.retryDelay({ delay: d ?? o.forever }));
		}
		case "select":
			return exprOrSteps(
				c,
				v,
				(value) => o.select({ value }),
				o.selectSteps,
				(fn) => o.selectWith({ fn }),
			);
		case "placeholderData":
			if (importedAs(c.facts, v) === "keepPreviousData" || (isFn(v) && isIdent(e.lambdaExpr(unwrap(v)) ?? null))) return D(o.keepPrevious);
			return D(o.placeholder({ value: e.text(v) }));
		case "keepPreviousData":
			return bool(v) === true ? D(o.keepPrevious) : null;
		case "initialData":
			return D(o.initialData({ value: e.text(isFn(v) ? (e.lambdaExpr(unwrap(v)) ?? v) : v) }));
		case "initialPageParam":
			return D(o.initialPageParam({ value: e.text(v) }));
		case "getNextPageParam":
			return exprOrSteps(c, v, (value) => o.nextPage({ value }), o.nextPageSteps);
		case "getPreviousPageParam":
			return exprOrSteps(c, v, (value) => o.previousPage({ value }), o.previousPageSteps);
		case "throwOnError":
		case "useErrorBoundary":
			if (bool(v) === false) return null;
			if (bool(v) === true) return D(o.throwOnError);
			return D(o.throwOnErrorWhen({ fn: isFn(v) && e.lambdaExpr(unwrap(v)) ? e.cond(e.lambdaExpr(unwrap(v))).t : e.text(v) }));
		case "suspense":
			return bool(v) === true ? D(o.suspense) : null;
		case "onSuccess":
		case "onError":
		case "onSettled": {
			if (kind === "mutation") {
				const head = { onSuccess: say.mutation.onSuccess, onError: say.mutation.onError, onSettled: say.mutation.onSettled }[key];
				return callbackDoc(c, v, head);
			}
			if (c.major === 5) return D(o.ignoredCallback({ name: mk("c", key) }));
			return callbackDoc(c, v, callbackHeads(c)[key]);
		}
		case "mutationFn":
			return exprOrSteps(c, v, (fn) => say.mutation.runs({ fn }), say.mutation.runSteps);
		case "onMutate":
			return callbackDoc(c, v, say.mutation.before);
		default: {
			const name = o.names[key as OptionKey] ?? e.prop(key);
			const b = bool(v);
			return D(o.option({ name, value: b === null ? e.text(v) : b ? o.yes : o.no }));
		}
	}
}

/** Every option of an options object, in source order, as details. */
export function optionDocs(c: Ctx, props: N[], kind: "query" | "mutation"): Doc[] {
	return props.flatMap((p: N): Doc[] => {
		if (p.type === "SpreadElement") return [spreadDoc(c, p)];
		const key = keyOf(p);
		if (key === null) return [];
		const d = optionDoc(c, key, p.value, kind);
		return d ? [d] : [];
	});
}

/** `...todoOptions` inside a query's options: everything it carries. */
function spreadDoc(c: Ctx, p: N): Doc {
	const v = c.e.noun(p.argument);
	return D(c.e.say.expressions.everythingIn({ value: v.t }), v.kids);
}

const KIND_WRAP: Record<QueryKind, (c: Ctx, q: string) => string> = {
	query: (_c, q) => q,
	infinite: (c, q) => c.say.query.paginated({ query: q }),
	suspense: (c, q) => c.say.query.suspending({ query: q }),
	suspenseInfinite: (c, q) => c.say.query.suspending({ query: c.say.query.paginated({ query: q }) }),
};

/** A query described by its key, with how it fetches and refreshes as details. */
export function queryDoc(c: Ctx, args: N[], kind: QueryKind, wrap?: (q: string) => string): Doc | null {
	const qa = queryArgs(args);
	if (!qa) return null;
	if ("from" in qa) {
		const v = c.e.noun(qa.from);
		const subject = KIND_WRAP[kind](c, c.say.query.fromOptions({ options: v.t }));
		return D(wrap ? wrap(subject) : subject, v.kids);
	}
	const name = qa.key ? queryName(c, qa.key) : c.say.query.keyed({ key: mk("c", "[]") });
	const subject = KIND_WRAP[kind](c, name);
	const items = [...(qa.fn ? [optionDoc(c, "queryFn", qa.fn, "query")!] : []), ...optionDocs(c, qa.props, "query")];
	return withDetails(c, wrap ? wrap(subject) : subject, items);
}

/** `useMutation({ mutationFn, onSuccess, … })` or v4's `useMutation(fn, options)`. */
export function mutationDoc(c: Ctx, args: N[], wrap?: (m: string) => string): Doc | null {
	const [a, b] = args.map(unwrap);
	if (!a) return D(wrap ? wrap(c.say.mutation.noun) : c.say.mutation.noun);
	const o = objectArg(a);
	let props: N[];
	let fn: N | null = null;
	let key: N | null = null;
	if (o) {
		props = o.properties;
		key = propOf(o, "mutationKey");
	} else if (isFn(a) || a.type === "Identifier" || a.type === "MemberExpression" || (a.type === "CallExpression" && args.length === 1)) {
		if (!isFn(a) && args.length === 1) {
			const v = c.e.noun(a);
			return D(c.say.mutation.fromOptions({ options: v.t }), v.kids);
		}
		fn = a;
		props = objectArg(b)?.properties ?? [];
	} else {
		key = a;
		fn = b ?? null;
		props = objectArg(args[2])?.properties ?? [];
	}
	const subject = key ? c.say.mutation.keyed({ key: mk("c", c.e.code(key).replace(/\s+/g, " ")) }) : c.say.mutation.noun;
	const items = [...(fn ? [optionDoc(c, "mutationFn", fn, "mutation")!] : []), ...optionDocs(c, props, "mutation")];
	return withDetails(c, wrap ? wrap(subject) : subject, items);
}

/** `useQueries({ queries: [...] })` and `queries: ids.map((id) => ({ … }))`. */
export function queriesDoc(c: Ctx, args: N[]): Doc | null {
	const o = objectArg(args[0]);
	const list = unwrap(propOf(o, "queries"));
	if (!list) return null;
	if (list.type === "ArrayExpression") {
		const docs = list.elements.filter(Boolean).map((x: N) => queryDoc(c, [x], "query") ?? c.e.noun(x));
		return D(
			c.say.query.several,
			docs.flatMap((d: Doc) => c.e.bullet(d)),
		);
	}
	const callee = list.type === "CallExpression" ? unwrap(list.callee) : null;
	const fn = list.arguments?.[0] ? unwrap(list.arguments[0]) : null;
	if (callee?.type === "MemberExpression" && callee.property.name === "map" && fn && isFn(fn)) {
		const body = c.e.lambdaExpr(fn);
		const q = body ? queryDoc(c, [body], "query") : null;
		if (q) return D(c.say.options.eachOf({ list: c.e.text(callee.object), item: q.t }), q.kids);
	}
	return null;
}
