import { D, type Doc, plain, vlen } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { whereDoc } from "./filters";
import { type Ctx, entryDoc, isTrue, items, keyName, literalString } from "./shared";

/** A `select` / `include` / `omit` / `orderBy` / `take` ... option, as bullet docs. `where` docs carry their condition for inlining. */
export type OptionDoc = { doc: Doc; where?: Doc };

const QUERY_KEYS = new Set(["where", "select", "include", "omit", "orderBy", "take", "skip", "cursor", "distinct"]);

/** Reads the options object of a query or write, skipping `skip` keys (like `data`) the caller renders itself. */
export function optionDocs(c: Ctx, opts: N, skip: Set<string> = new Set()): OptionDoc[] {
	const { e, say } = c;
	const o = unwrap(opts);
	const out: OptionDoc[] = [];
	for (const p of o.properties) {
		const k = keyName(p);
		if (k && skip.has(k)) continue;
		const v = unwrap(p.value);
		if (!k) out.push({ doc: entryDoc(e, p) });
		else if (k === "where") {
			const w = whereDoc(c, v);
			out.push({ doc: D(say.options.where({ condition: w.t }), w.kids), where: w });
		} else if (k === "select" && v?.type === "ObjectExpression") out.push(...selectDocs(c, v).map((doc) => ({ doc })));
		else if (k === "include" && v?.type === "ObjectExpression") out.push(...includeDocs(c, v).map((doc) => ({ doc })));
		else if (k === "omit" && v?.type === "ObjectExpression") out.push({ doc: D(say.options.leavingOut({ fields: flagged(c, v) })) });
		else if (k === "orderBy") out.push({ doc: D(say.options.sortedBy({ columns: orderList(c, v) })) });
		else if (k === "take") {
			const neg = v?.type === "UnaryExpression" && v.operator === "-";
			out.push({ doc: D((neg ? say.options.lastOnes : say.options.atMost)({ count: e.text(neg ? v.argument : v) })) });
		} else if (k === "skip") out.push({ doc: D(say.options.skipping({ count: e.text(v) })) });
		else if (k === "cursor") {
			const w = whereDoc(c, v);
			out.push({ doc: D(say.options.startingFrom({ condition: w.t }), w.kids) });
		} else if (k === "distinct") {
			const fields = items(v).map((x) => (literalString(x) !== null ? e.prop(literalString(x)!) : e.text(x)));
			out.push({ doc: D(say.options.distinct({ fields: e.g.list(fields) })) });
		} else out.push({ doc: entryDoc(e, p) });
	}
	return out;
}

export const isQueryKey = (k: string | null) => k !== null && QUERY_KEYS.has(k);

/** Names of the keys set to `true`. */
const flagged = (c: Ctx, o: N) => c.e.g.list(o.properties.filter((p: N) => isTrue(p.value) && keyName(p)).map((p: N) => c.e.prop(keyName(p)!)));

/** `_count: true` / `_count: { select: { posts: true } }`. */
function countDocs(c: Ctx, v: N): Doc[] {
	const { say } = c;
	if (isTrue(v)) return [D(say.options.countAll)];
	const sel = v?.type === "ObjectExpression" ? unwrap(v.properties.find((p: N) => keyName(p) === "select")?.value) : null;
	if (sel?.type !== "ObjectExpression") return [c.e.noun(v)];
	return sel.properties.map((p: N) => {
		const k = keyName(p);
		if (!k) return entryDoc(c.e, p);
		const inner = unwrap(p.value);
		const head = say.options.countOf({ relation: c.e.prop(k) });
		if (inner?.type !== "ObjectExpression") return D(head);
		const w = inner.properties.find((x: N) => keyName(x) === "where")?.value;
		if (!w) return D(head);
		const cond = whereDoc(c, w);
		return D(say.options.countOfWhere({ relation: c.e.prop(k), condition: cond.t }), cond.kids);
	});
}

/** A relation with its own nested query options, e.g. `posts: { where, orderBy, take }`. */
function relationDoc(c: Ctx, key: string, v: N): Doc {
	const head = c.say.options.including({ relation: c.e.prop(key) });
	if (v?.type !== "ObjectExpression") return D(head);
	const kids = optionDocs(c, v).map((x) => x.doc);
	return D(
		head,
		kids.flatMap((k) => c.e.bullet(k)),
	);
}

/** `...shared` inside `select` / `include`. */
function spreadDoc(c: Ctx, p: N): Doc {
	if (p.type !== "SpreadElement") return entryDoc(c.e, p);
	const v = c.e.noun(p.argument);
	return D(c.say.options.includingAllIn({ value: v.t }), v.kids);
}

/** `select: { id: true, posts: { select: { title: true } }, _count: ... }`. */
function selectDocs(c: Ctx, o: N): Doc[] {
	const { e, say } = c;
	const picked: string[] = [];
	const rest: Doc[] = [];
	for (const p of o.properties) {
		const k = keyName(p);
		const v = unwrap(p.value);
		if (!k) rest.push(spreadDoc(c, p));
		else if (k === "_count") picked.push(...countDocs(c, v).map((d) => d.t));
		else if (isTrue(v)) picked.push(e.prop(k));
		else if (v?.type === "Literal" && v.value === false) continue;
		else if (v?.type === "ObjectExpression") rest.push(relationDoc(c, k, v));
		else rest.push(entryDoc(e, p));
	}
	const out = picked.length ? [D(say.options.pickingOnly({ fields: e.g.list(picked) }))] : [];
	return [...out, ...rest];
}

function includeDocs(c: Ctx, o: N): Doc[] {
	const { e } = c;
	return o.properties.flatMap((p: N): Doc[] => {
		const k = keyName(p);
		const v = unwrap(p.value);
		if (!k) return [spreadDoc(c, p)];
		if (k === "_count") return countDocs(c, v);
		if (v?.type === "Literal" && v.value === false) return [];
		if (isTrue(v) || v?.type === "ObjectExpression") return [relationDoc(c, k, v)];
		return [entryDoc(e, p)];
	});
}

/** `orderBy`: `{ createdAt: "desc" }`, a list of those, relation counts, nested relation fields and `{ sort, nulls }`. */
export function orderList(c: Ctx, v: N): string {
	return c.e.g.list(items(v).flatMap((x) => orderItems(c, x, null)));
}

function orderItems(c: Ctx, v: N, parent: string | null): string[] {
	const { e, say } = c;
	const o = unwrap(v);
	if (o?.type !== "ObjectExpression") return [e.text(v)];
	return o.properties.map((p: N) => {
		const k = keyName(p);
		if (!k) return entryDoc(e, p).t;
		const column = parent ? `${e.g.possessive(parent)} ${e.prop(k)}` : e.prop(k);
		const val = unwrap(p.value);
		const dir = literalString(val);
		if (dir === "asc" || dir === "desc") return direction(c, column, dir);
		if (val?.type === "ObjectExpression") {
			const sort = literalString(val.properties.find((x: N) => keyName(x) === "sort")?.value);
			const nulls = literalString(val.properties.find((x: N) => keyName(x) === "nulls")?.value);
			const count = literalString(val.properties.find((x: N) => keyName(x) === "_count")?.value);
			if (Object.hasOwn(AGGREGATE_ORDER, k)) return aggregateOrder(c, k, val);
			if (k === "_relevance") {
				const fields = val.properties.find((x: N) => keyName(x) === "fields")?.value;
				const search = val.properties.find((x: N) => keyName(x) === "search")?.value;
				if (fields && search) return say.order.relevance({ fields: e.text(fields), search: e.text(search) });
			}
			if (count === "asc" || count === "desc") return say.order.byCount({ relation: e.prop(k), descending: count === "desc" });
			if (sort === "asc" || sort === "desc") {
				const order = direction(c, column, sort);
				return nulls === "first" || nulls === "last" ? say.order.nulls({ order, first: nulls === "first" }) : order;
			}
			return orderItems(c, val, column).join(", ");
		}
		return say.options.option({ key: column, value: e.text(val) });
	});
}

const AGGREGATE_ORDER: Record<string, "avg" | "sum" | "min" | "max" | "count"> = { _avg: "avg", _sum: "sum", _min: "min", _max: "max", _count: "count" };

/** `orderBy: { _count: { programId: "desc" } }` in a `groupBy`. */
function aggregateOrder(c: Ctx, k: string, o: N): string {
	const { e, say } = c;
	const name = AGGREGATE_ORDER[k]!;
	return e.g.list(
		o.properties.map((p: N) => {
			const f = keyName(p);
			const dir = literalString(p.value);
			if (!f || (dir !== "asc" && dir !== "desc")) return entryDoc(e, p).t;
			const column = name === "count" ? say.aggregate.setCount({ field: e.prop(f) }) : say.aggregate[name]({ fields: e.prop(f) });
			return direction(c, column, dir);
		}),
	);
}

function direction(c: Ctx, column: string, dir: "asc" | "desc"): string {
	const time = c.e.g.isTimeLike(plain(column));
	return dir === "asc" ? c.say.order.ascending({ column, time }) : c.say.order.descending({ column, time });
}

/** The rows phrase with its options: a lone short `where` goes inline, anything more becomes bullets. */
export function rowsWithOptions(c: Ctx, rows: string, opts: N, skip?: Set<string>): Doc {
	const { e, say } = c;
	const o = unwrap(opts);
	if (!o) return D(rows);
	if (o.type !== "ObjectExpression") {
		const v = e.noun(o);
		return D(say.rows.withOptions({ rows, options: v.t }), v.kids);
	}
	const docs = optionDocs(c, o, skip);
	const where = docs.find((d) => d.where)?.where;
	if (where && !where.kids.length) {
		const inline = say.rows.filtered({ rows, condition: where.t });
		const rest = docs.filter((d) => !d.where);
		if (vlen(inline) <= 110)
			return D(
				inline,
				rest.flatMap((d) => e.bullet(d.doc)),
			);
	}
	return D(
		rows,
		docs.flatMap((d) => e.bullet(d.doc)),
	);
}
