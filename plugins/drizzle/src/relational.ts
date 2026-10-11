import { D, type Doc, plain, vlen } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { compareOp } from "./operators";
import { type Ctx, condition, entryDoc, fnResult, isDb, isFn, isOne, items, keyName, listDoc, literalString, val } from "./shared";

/** `db.query.users` -> "users", or null when the receiver isn't a relational query table. */
function relationalTable(c: Ctx, obj: N | null): string | null {
	const t = unwrap(obj);
	if (t?.type !== "MemberExpression" || t.computed) return null;
	const q = unwrap(t.object);
	if (q?.type !== "MemberExpression" || q.computed || q.property.name !== "query" || !isDb(c.e, q.object)) return null;
	return t.property.name;
}

/** `db.query.users.findMany({ where, with, columns, orderBy, limit, offset, extras })`. */
export function findDoc(c: Ctx, { node, obj, stmt }: { node: N; obj: N | null; stmt: boolean }): Doc | null {
	const name = relationalTable(c, obj);
	if (!name) return null;
	const { e, say } = c;
	const r = say.relational;
	const first = unwrap(node.callee).property.name === "findFirst";
	const table = e.ref(name);
	const opts = unwrap(node.arguments[0]);
	const hasWhere = opts?.type === "ObjectExpression" && opts.properties.some((p: N) => keyName(p) === "where");
	const rows = first ? r.firstRow({ table }) : hasWhere ? r.rows({ table }) : r.everyRow({ table });
	const doc = queryOptions(c, rows, opts);
	return stmt ? D(r.lookUp({ rows: doc.t }), doc.kids) : doc;
}

function queryOptions(c: Ctx, rows: string, opts: N): Doc {
	const { e, say } = c;
	if (!opts) return D(rows);
	if (opts.type !== "ObjectExpression") {
		const o = val(c, opts);
		return D(say.relational.withOptions({ rows, options: o.t }), o.kids);
	}
	const kids = optionKids(c, opts);
	const only = kids.length === 1 && opts.properties.length === 1 && keyName(opts.properties[0]) === "where" ? kids[0]! : null;
	if (only && !only.cond.kids.length) {
		const inline = say.relational.filtered({ rows, condition: only.cond.t });
		if (vlen(inline) <= 110) return D(inline);
	}
	return D(
		`${rows}:`,
		kids.flatMap((k) => e.bullet(k.doc)),
	);
}

type Kid = { doc: Doc; cond: Doc };

function optionKids(c: Ctx, opts: N): Kid[] {
	const { e, say } = c;
	const r = say.relational;
	const out: Kid[] = [];
	const add = (doc: Doc, cond = doc) => out.push({ doc, cond });
	for (const p of opts.properties) {
		const k = keyName(p);
		if (!k) {
			add(entryDoc(e, p));
			continue;
		}
		const v = unwrap(p.value);
		if (k === "where" && (v.type === "Identifier" || v.type === "MemberExpression")) {
			const o = val(c, v);
			const w = D(r.matchesFilter({ filter: o.t }), o.kids);
			add(D(say.query.where({ condition: w.t }), w.kids), w);
		} else if (k === "where") {
			const w = whereDoc(c, v, false);
			add(D(say.query.where({ condition: w.t }), w.kids), w);
		} else if (k === "columns" && v.type === "ObjectExpression") add(columnsDoc(c, v));
		else if (k === "with" && v.type === "ObjectExpression") for (const rel of v.properties) add(withDoc(c, rel));
		else if (k === "orderBy") add(D(say.query.sortedBy({ columns: orderList(c, v) })));
		else if (k === "limit") add(D(say.query.atMost({ count: val(c, v).t, one: isOne(v) })));
		else if (k === "offset") add(D(say.query.skipping({ count: val(c, v).t, one: isOne(v) })));
		else if (k === "extras" && v.type === "ObjectExpression")
			for (const x of v.properties) {
				const xk = keyName(x);
				const xv = xk ? val(c, isFn(x.value) ? (fnResult(x.value) ?? x.value) : x.value) : entryDoc(e, x);
				add(xk ? D(r.extra({ name: e.prop(xk), value: xv.t }), xv.kids) : xv);
			}
		else {
			const o = val(c, v);
			const w = D(r.matchesFilter({ filter: o.t }), o.kids);
			add(D(say.query.where({ condition: w.t }), w.kids), w);
		}
	}
	return out;
}

function columnsDoc(c: Ctx, o: N): Doc {
	const { e, say } = c;
	const flags = o.properties.map((p: N) => ({ key: keyName(p), on: unwrap(p.value)?.type === "Literal" ? unwrap(p.value).value : null }));
	if (!flags.length) return D(say.relational.noColumns);
	if (flags.some((f: { key: string | null; on: unknown }) => !f.key || typeof f.on !== "boolean")) {
		const v = val(c, o);
		return D(say.relational.option({ key: e.prop("columns"), value: v.t }), v.kids);
	}
	const names = (on: boolean) => e.g.list(flags.filter((f: { on: unknown }) => f.on === on).map((f: { key: string }) => e.prop(f.key)));
	return flags.some((f: { on: unknown }) => f.on)
		? D(say.relational.pickingOnly({ columns: names(true) }))
		: D(say.relational.leavingOut({ columns: names(false) }));
}

function withDoc(c: Ctx, p: N): Doc {
	const { e, say } = c;
	const k = keyName(p);
	if (!k) return entryDoc(e, p);
	const v = unwrap(p.value);
	const relation = e.prop(k);
	if (v.type !== "ObjectExpression") return D(say.relational.including({ relation }));
	return D(
		say.relational.including({ relation }),
		optionKids(c, v).flatMap((x) => e.bullet(x.doc)),
	);
}

/** `orderBy`: an array, a callback, a single column, or the v2 object form `{ id: "desc" }`. */
function orderList(c: Ctx, v: N): string {
	const { e, say } = c;
	const body = isFn(v) ? unwrap(fnResult(v) ?? v) : v;
	if (body.type === "ObjectExpression")
		return e.g.list(
			body.properties.map((p: N) => {
				const k = keyName(p);
				const dir = literalString(p.value);
				if (!k || (dir !== "asc" && dir !== "desc")) return entryDoc(e, p).t;
				const column = e.prop(k);
				const time = e.g.isTimeLike(plain(column));
				return dir === "asc" ? say.order.ascending({ column, time }) : say.order.descending({ column, time });
			}),
		);
	return listDoc(
		e,
		items(body).map((x) => val(c, x)),
	).t;
}

const OPERATORS = new Set([
	"eq",
	"ne",
	"gt",
	"gte",
	"lt",
	"lte",
	"in",
	"notIn",
	"like",
	"notLike",
	"ilike",
	"notIlike",
	"isNull",
	"isNotNull",
	"arrayContains",
	"arrayContained",
	"arrayOverlaps",
	"OR",
	"AND",
	"NOT",
]);

/** A relational `where`: a callback, a SQL condition, or the v2 filter object. */
function whereDoc(c: Ctx, v: N, neg: boolean): Doc {
	const u = unwrap(v);
	if (isFn(u)) {
		const body = fnResult(u);
		return body ? whereDoc(c, body, neg) : c.e.noun(u);
	}
	if (u?.type === "ObjectExpression") return combine(c, filterItems(c, u, null, neg), neg);
	return condition(c, u, neg);
}

const combine = (c: Ctx, docs: Doc[], neg: boolean, isAnd = true): Doc => {
	if (docs.length === 1) return docs[0]!;
	return D(
		isAnd !== neg ? c.say.logic.all : c.say.logic.any,
		docs.flatMap((d) => c.e.bullet(d)),
	);
};

/** The entries of a v2 filter object; `column` is set inside a column's operator object. */
function filterItems(c: Ctx, o: N, column: Doc | null, neg: boolean): Doc[] {
	const { e, say } = c;
	return o.properties.map((p: N): Doc => {
		const k = keyName(p);
		if (!k) return entryDoc(e, p);
		const v = unwrap(p.value);
		if (k === "OR" || k === "AND")
			return combine(
				c,
				items(v).map((x) => filterValue(c, x, column, neg)),
				neg,
				k === "AND",
			);
		if (k === "NOT") return filterValue(c, v, column, !neg);
		if (k === "RAW") return whereDoc(c, v, neg);
		if (column) return opDoc(c, k, column, v, neg);
		const col = D(e.prop(k));
		if (v.type !== "ObjectExpression") return compareDoc(c, "eq", col, v, neg);
		const keys = v.properties.map(keyName);
		if (keys.length && keys.every((x: string | null) => x && OPERATORS.has(x))) return combine(c, filterItems(c, v, col, neg), neg);
		const inner = combine(c, filterItems(c, v, null, false), false);
		return D(say.relational.hasRelated({ relation: col.t, condition: inner.t, neg }), inner.kids);
	});
}

function filterValue(c: Ctx, v: N, column: Doc | null, neg: boolean): Doc {
	const u = unwrap(v);
	if (u?.type === "ObjectExpression") return combine(c, filterItems(c, u, column, neg), neg);
	return whereDoc(c, u, neg);
}

function opDoc(c: Ctx, op: string, column: Doc, v: N, neg: boolean): Doc {
	if (op === "isNull" || op === "isNotNull") {
		const on = unwrap(v)?.type === "Literal" ? unwrap(v).value !== false : true;
		return D(c.say.compare.empty({ value: column.t, neg: (neg !== (op === "isNotNull")) !== !on }));
	}
	return compareDoc(c, op, column, v, neg);
}

function compareDoc(c: Ctx, op: string, column: Doc, v: N, neg: boolean): Doc {
	return compareOp(c, op, [null, v], neg, column) ?? c.e.noun(v);
}
