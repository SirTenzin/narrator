import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, entryDoc, isNullLit, items, keyName, literalString } from "./shared";

const SCALAR_OPS = new Set([
	"equals",
	"not",
	"in",
	"notIn",
	"lt",
	"lte",
	"gt",
	"gte",
	"contains",
	"startsWith",
	"endsWith",
	"search",
	"mode",
	"has",
	"hasEvery",
	"hasSome",
	"isEmpty",
	"isSet",
]);
const RELATION_OPS = new Set(["some", "every", "none", "is", "isNot"]);

/** Several conditions under one heading; a single one stands alone. */
export function combine(c: Ctx, docs: Doc[], neg: boolean, isAnd = true): Doc {
	if (docs.length === 1) return docs[0]!;
	return D(
		isAnd !== neg ? c.say.logic.all : c.say.logic.any,
		docs.flatMap((d) => c.e.bullet(d)),
	);
}

/** A `where` object, a variable holding one, or anything else as a plain condition. */
export function whereDoc(c: Ctx, v: N, neg = false, column: Doc | null = null): Doc {
	const u = unwrap(v);
	if (u?.type === "ObjectExpression") return combine(c, filterItems(c, u, column, neg), neg);
	if (u?.type === "Identifier" || u?.type === "MemberExpression") {
		const f = c.e.noun(u);
		return D(c.say.logic.matchesFilter({ filter: f.t, neg }), f.kids);
	}
	return c.e.cond(u, neg);
}

const keysOf = (o: N): (string | null)[] => o.properties.map(keyName);
const allIn = (o: N, set: Set<string>) => {
	const ks = keysOf(o);
	return ks.length > 0 && ks.every((k) => k !== null && set.has(k));
};

/** The column a filter talks about: `author: { name }` reads "author's name". */
const columnOf = (c: Ctx, key: string, parent: Doc | null): Doc =>
	D(parent ? c.say.relation.field({ relation: parent.t, field: c.e.prop(key) }) : c.e.prop(key));

function filterItems(c: Ctx, o: N, parent: Doc | null, neg: boolean): Doc[] {
	return o.properties.map((p: N): Doc => {
		const k = keyName(p);
		if (!k) return entryDoc(c.e, p);
		const v = unwrap(p.value);
		if (k === "AND" || k === "OR") {
			if (v?.type !== "ArrayExpression" && v?.type !== "ObjectExpression") {
				const list = c.e.noun(v);
				return D((k === "AND" ? c.say.logic.allIn : c.say.logic.anyIn)({ list: list.t, neg }), list.kids);
			}
			return combine(
				c,
				items(v).map((x) => whereDoc(c, x, neg, parent)),
				neg,
				k === "AND",
			);
		}
		if (k === "NOT")
			return combine(
				c,
				items(v).map((x) => whereDoc(c, x, !neg, parent)),
				neg,
				true,
			);
		if (isCompoundKey(k, v)) return combine(c, filterItems(c, v, parent, neg), neg);
		return fieldFilter(c, columnOf(c, k, parent), v, neg);
	});
}

/** `partnerId_programId: { partnerId, programId }`: a compound unique key is just its fields. */
const isCompoundKey = (k: string, v: N) =>
	k.includes("_") && v?.type === "ObjectExpression" && v.properties.length > 0 && v.properties.every((p: N) => k.split("_").includes(keyName(p) ?? ""));

/** One field's filter: a value, an operator object, a relation filter, or a to-one relation's own fields. */
export function fieldFilter(c: Ctx, column: Doc, v: N, neg: boolean): Doc {
	const { say } = c;
	if (isNullLit(v)) return D(say.compare.empty({ value: column.t, neg }));
	if (v?.type !== "ObjectExpression") return equal(c, column, v, neg);
	if (!v.properties.length) return D(say.relation.hasAny({ relation: column.t, neg }));
	if (allIn(v, SCALAR_OPS)) return combine(c, operatorDocs(c, column, v, neg), neg);
	if (allIn(v, RELATION_OPS)) return combine(c, relationDocs(c, column, v, neg), neg);
	return combine(c, filterItems(c, v, column, neg), neg);
}

function equal(c: Ctx, column: Doc, v: N, neg: boolean): Doc {
	const r = c.e.noun(v);
	return D(c.say.compare.equal({ left: column.t, right: r.t, neg }), r.kids);
}

const ORDERED: Record<string, ["moreThan" | "atLeast" | "lessThan" | "atMost", "moreThan" | "atLeast" | "lessThan" | "atMost"]> = {
	gt: ["moreThan", "atMost"],
	gte: ["atLeast", "lessThan"],
	lt: ["lessThan", "atLeast"],
	lte: ["atMost", "moreThan"],
};

function operatorDocs(c: Ctx, column: Doc, o: N, neg: boolean): Doc[] {
	const { e, say } = c;
	const ignoreCase = o.properties.some((p: N) => keyName(p) === "mode" && literalString(p.value) === "insensitive");
	return o.properties
		.filter((p: N) => keyName(p) !== "mode")
		.map((p: N): Doc => {
			const k = keyName(p)!;
			const v = unwrap(p.value);
			const r = () => e.noun(v);
			const left = column.t;
			if (k === "equals") return isNullLit(v) ? D(say.compare.empty({ value: left, neg })) : equal(c, column, v, neg);
			if (k === "not") {
				if (isNullLit(v)) return D(say.compare.empty({ value: left, neg: !neg }));
				return v?.type === "ObjectExpression" ? combine(c, operatorDocs(c, column, v, !neg), !neg) : equal(c, column, v, !neg);
			}
			if (k === "in" || k === "notIn") {
				const x = r();
				return D(say.compare.in({ left, right: x.t, neg: neg !== (k === "notIn") }), x.kids);
			}
			if (ORDERED[k]) {
				const x = r();
				return D(say.compare[ORDERED[k][neg ? 1 : 0]]({ left, right: x.t }), x.kids);
			}
			if (k === "contains" || k === "startsWith" || k === "endsWith") {
				const x = r();
				return D(say.pattern[k]({ value: left, text: x.t, neg, ignoreCase }), x.kids);
			}
			if (k === "search") return D(say.pattern.search({ value: left, text: r().t, neg }));
			if (k === "has") return D(say.list.has({ value: left, item: r().t, neg }));
			if (k === "hasEvery" || k === "hasSome") return D(say.list[k]({ value: left, items: r().t, neg }));
			if (k === "isEmpty") return D(say.list.isEmpty({ value: left, neg: neg !== (v?.value === false) }));
			if (k === "isSet") return D(say.compare.empty({ value: left, neg: neg !== (v?.value !== false) }));
			return entryDoc(e, p);
		});
}

function relationDocs(c: Ctx, relation: Doc, o: N, neg: boolean): Doc[] {
	const { say } = c;
	return o.properties.map((p: N): Doc => {
		const k = keyName(p)!;
		const v = unwrap(p.value);
		const empty = v?.type === "ObjectExpression" && !v.properties.length;
		if (k === "some" || k === "none") {
			const n = neg !== (k === "none");
			if (empty) return D(say.relation.hasAny({ relation: relation.t, neg: n }));
			const w = whereDoc(c, v);
			return D(say.relation.has({ relation: relation.t, condition: w.t, neg: n }), w.kids);
		}
		if (k === "every") {
			const w = whereDoc(c, v);
			return D(say.relation.every({ relation: relation.t, condition: w.t, neg }), w.kids);
		}
		const n = neg !== (k === "isNot");
		if (isNullLit(v)) return D(say.relation.missing({ relation: relation.t, neg: n }));
		return whereDoc(c, v, n, relation);
	});
}
