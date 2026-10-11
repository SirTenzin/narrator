import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type HookKind, hookKind } from "./facts";
import type { ResultField } from "./phrases";
import { bullets, type Ctx, isFn, keyOf, objectArg } from "./shared";

/** What a destructured result field means; `isLoading` changed meaning in v5. */
function meaning(c: Ctx, field: string, kind: HookKind): string {
	const r = c.say.result;
	if (kind === "mutation" && field in r.mutationFields) return r.mutationFields[field as keyof typeof r.mutationFields];
	if (field === "isLoading") return c.major === 4 ? r.isLoadingV4 : c.major === 5 ? r.isLoadingV5 : r.isLoadingAny;
	return r.fields[field as Exclude<ResultField, "isLoading">] ?? c.e.prop(field);
}

/** One destructured field: its meaning, plus the local name when the code renames it. */
function fieldText(c: Ctx, p: N, kind: HookKind): string | null {
	const { e } = c;
	if (p.type !== "Property") return null;
	const field = keyOf(p);
	if (field === null) return null;
	const v = p.value.type === "AssignmentPattern" ? p.value.left : p.value;
	const m = meaning(c, field, kind);
	if (v.type === "Identifier") return c.say.result.field({ meaning: m, local: v.name === field ? null : e.ref(v.name) });
	return c.say.result.field({ meaning: m, local: e.g.list(e.patternNames(v)) });
}

/** `const { data, isLoading } = useQuery(…)` reads as "load the … query, and take its data and …". */
export function destructureStatement(c: Ctx, node: N, d: number, render: (call: N) => Doc | null): boolean {
	if (node.type !== "VariableDeclaration" || node.declarations.length !== 1) return false;
	const [decl] = node.declarations;
	if (decl.id.type !== "ObjectPattern" || !decl.init) return false;
	const kind = hookKind(c.facts, decl.init);
	if (!kind) return false;
	const call = unwrap(decl.init.type === "AwaitExpression" ? decl.init.argument : decl.init);
	const doc = render(call);
	if (!doc) return false;
	const fields = decl.id.properties.map((p: N) => fieldText(c, p, kind));
	if (fields.some((f: string | null) => f === null)) return false;
	const list = c.e.g.list(fields);
	const text = kind === "query" ? c.say.result.load({ query: doc.t, fields: list }) : c.say.result.setUp({ mutation: doc.t, fields: list });
	c.e.emitDoc(d, D(text, doc.kids), node);
	return true;
}

const isResult = (c: Ctx, obj: N | null, kind: HookKind): boolean => {
	const u = unwrap(obj);
	return u?.type === "Identifier" && c.facts.results.get(u.name) === kind;
};

/** `vars` of `mutate(vars, { onSuccess })`, plus the per-call callbacks as bullets. */
function runDoc(c: Ctx, mutation: string, args: N[], phrase: (p: { mutation: string; vars: string | null }) => string): Doc {
	const { e, say } = c;
	const [vars, opts] = args;
	const v = vars ? e.noun(vars) : null;
	const o = objectArg(opts);
	const heads: Record<string, (p: { given: string | null }) => string> = {
		onSuccess: say.mutation.onSuccess,
		onError: say.mutation.onError,
		onSettled: say.mutation.onSettled,
	};
	const kids = (o?.properties ?? []).flatMap((p: N) => {
		const k = keyOf(p);
		const h = k ? heads[k] : null;
		if (!h) return [];
		const cb = isFn(p.value)
			? D(h({ given: e.paramList(unwrap(p.value).params) }), e.body(blockOf(p.value), 0))
			: D(say.mutation.callbackBy({ heading: h({ given: null }), fn: e.text(p.value) }));
		return bullets(e, [cb]);
	});
	return D(phrase({ mutation, vars: v?.t ?? null }), [...(v?.kids ?? []), ...kids]);
}

const blockOf = (fn: N): N => {
	const f = unwrap(fn);
	if (f.body.type === "BlockStatement") return f.body;
	return { type: "ExpressionStatement", expression: f.body, start: f.body.start, end: f.body.end };
};

/** `save.mutate(vars)`, `todos.refetch()`, and the same functions destructured under their own names. */
export function actionCall(c: Ctx, m: string, obj: N | null, args: N[], stmt: boolean): Doc | null {
	const { e, say } = c;
	const kind: HookKind | null = obj
		? isResult(c, obj, "mutation")
			? "mutation"
			: isResult(c, obj, "query")
				? "query"
				: null
		: (c.facts.actions.get(m) ?? null);
	if (!kind) return null;
	const target = obj ? e.text(obj) : null;
	if (kind === "mutation") {
		const name = target ?? say.mutation.the;
		if (m === "mutate") return runDoc(c, name, args, say.mutation.run);
		if (m === "mutateAsync") return runDoc(c, name, args, stmt ? say.mutation.runAndWait : say.result.resultOf);
		if (m === "reset") return D(say.mutation.reset({ mutation: name }));
		return null;
	}
	if (!target) return null;
	if (m === "refetch") return D(say.result.refetch({ query: target }));
	if (m === "fetchNextPage") return D(say.result.fetchNextPage({ query: target }));
	if (m === "fetchPreviousPage") return D(say.result.fetchPreviousPage({ query: target }));
	return null;
}
