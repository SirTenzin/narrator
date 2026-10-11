import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { combine, fieldFilter, whereDoc } from "./filters";
import { optionDocs, orderList, rowsWithOptions } from "./options";
import { type Ctx, entryDoc, isTrue, items, keyName, literalString, type ModelCall, tableOf } from "./shared";

/** `findMany` / `findFirst` / `findUnique` (and `...OrThrow`): "the rows of users where ...". */
export function findDoc(c: Ctx, call: ModelCall, stmt: boolean): Doc {
	const { e, say } = c;
	const table = tableOf(e, call.model);
	const o = unwrap(call.opts);
	const hasWhere = o?.type === "ObjectExpression" && o.properties.some((p: N) => keyName(p) === "where");
	const m = call.method;
	const base = m.startsWith("findFirst")
		? say.rows.first({ table })
		: m.startsWith("findUnique")
			? say.rows.unique({ table })
			: hasWhere || (o && o.type !== "ObjectExpression")
				? say.rows.some({ table })
				: say.rows.every({ table });
	let doc = rowsWithOptions(c, base, call.opts);
	if (m.endsWith("OrThrow")) doc = D(say.rows.orFail({ rows: doc.t }), doc.kids);
	return stmt ? D(say.rows.lookUp({ rows: doc.t }), doc.kids) : doc;
}

/** `count({ where })` / `count({ select: { _all: true, email: true } })`. */
export function countDoc(c: Ctx, call: ModelCall): Doc {
	const { e, say } = c;
	const table = tableOf(e, call.model);
	const o = unwrap(call.opts);
	if (o?.type !== "ObjectExpression")
		return o ? D(say.rows.withOptions({ rows: say.aggregate.countRows({ table }), options: e.text(o) })) : D(say.aggregate.countRows({ table }));
	const sel = unwrap(o.properties.find((p: N) => keyName(p) === "select")?.value);
	const others = optionDocs(c, o, new Set(["select", "where"]));
	const where = o.properties.find((p: N) => keyName(p) === "where")?.value;
	const w = where ? whereDoc(c, where) : null;
	let head: string;
	const kids: Doc[] = [];
	if (sel?.type === "ObjectExpression") {
		const fields = sel.properties
			.filter((p: N) => isTrue(p.value))
			.map((p: N) => (keyName(p) === "_all" ? say.aggregate.rowCount : say.aggregate.setCount({ field: e.prop(keyName(p)!) })));
		head = say.aggregate.counts({ table, fields: e.g.list(fields) });
		if (w) kids.push(D(say.options.where({ condition: w.t }), w.kids));
	} else if (w && !w.kids.length && !others.length) head = say.aggregate.countWhere({ table, condition: w.t });
	else {
		head = say.aggregate.countRows({ table });
		if (w) kids.push(D(say.options.where({ condition: w.t }), w.kids));
	}
	return D(
		head,
		[...kids, ...others.map((x) => x.doc)].flatMap((k) => e.bullet(k)),
	);
}

const AGGREGATES = { _avg: "avg", _sum: "sum", _min: "min", _max: "max", _count: "count" } as const;

/** `_avg: { age: true }` -> "the average of age"; `_count` fields each become a count. */
function aggregateFields(c: Ctx, key: keyof typeof AGGREGATES, v: N): Doc[] {
	const { e, say } = c;
	const o = unwrap(v);
	const name = AGGREGATES[key];
	if (name === "count") {
		if (isTrue(v)) return [D(say.aggregate.rowCount)];
		if (o?.type !== "ObjectExpression") return [e.noun(v)];
		return o.properties
			.filter((p: N) => isTrue(p.value))
			.map((p: N) => D(keyName(p) === "_all" ? say.aggregate.rowCount : say.aggregate.setCount({ field: e.prop(keyName(p)!) })));
	}
	if (o?.type !== "ObjectExpression") return [D(say.aggregate[name]({ fields: e.text(v) }))];
	const fields = o.properties.filter((p: N) => isTrue(p.value)).map((p: N) => e.prop(keyName(p)!));
	return [D(say.aggregate[name]({ fields: e.g.list(fields) }))];
}

/** The column an aggregate filter talks about: "the average of age", "the number of rows with email set". */
const aggregateColumn = (c: Ctx, name: (typeof AGGREGATES)[keyof typeof AGGREGATES], field: string) =>
	D(name === "count" ? c.say.aggregate.setCount({ field: c.e.prop(field) }) : c.say.aggregate[name]({ fields: c.e.prop(field) }));

/** The aggregate keys of an `aggregate` / `groupBy` call, then its other options. */
function aggregateKids(c: Ctx, o: N, skip: string[]): Doc[] {
	const { e, say } = c;
	const kids: Doc[] = [];
	for (const p of o.properties) {
		const k = keyName(p);
		if (k && Object.hasOwn(AGGREGATES, k)) kids.push(...aggregateFields(c, k as keyof typeof AGGREGATES, p.value));
		else if (k === "having") {
			const h = havingDoc(c, p.value);
			kids.push(D(say.aggregate.having({ condition: h.t }), h.kids));
		} else if (k === "orderBy") kids.push(D(say.options.sortedBy({ columns: orderList(c, p.value) })));
		else if (k && skip.includes(k)) continue;
		else if (!k) kids.push(entryDoc(e, p));
		else kids.push(...optionDocs(c, { type: "ObjectExpression", properties: [p] }).map((x) => x.doc));
	}
	return kids;
}

/** `having: { age: { _avg: { gt: 30 } } }`: aggregate filters read as "the average of age is more than 30". */
function havingDoc(c: Ctx, v: N): Doc {
	const { e, say } = c;
	const o = unwrap(v);
	if (o?.type !== "ObjectExpression") return whereDoc(c, v);
	const parts = o.properties.map((p: N): Doc => {
		const k = keyName(p);
		const inner = unwrap(p.value);
		if (!k || inner?.type !== "ObjectExpression") return whereDoc(c, { type: "ObjectExpression", properties: [p] });
		const aggs = inner.properties.filter((x: N) => Object.hasOwn(AGGREGATES, keyName(x) ?? ""));
		if (!aggs.length) return whereDoc(c, { type: "ObjectExpression", properties: [p] });
		const docs = aggs.map((x: N) => {
			const name = AGGREGATES[keyName(x) as keyof typeof AGGREGATES];
			return fieldFilter(c, aggregateColumn(c, name, k), unwrap(x.value), false);
		});
		return combine(c, docs, false);
	});
	return parts.length === 1
		? parts[0]!
		: D(
				say.logic.all,
				parts.flatMap((d: Doc) => e.bullet(d)),
			);
}

export function aggregateDoc(c: Ctx, call: ModelCall): Doc {
	const { e, say } = c;
	const table = tableOf(e, call.model);
	const o = unwrap(call.opts);
	if (o?.type !== "ObjectExpression") return D(say.rows.withOptions({ rows: say.aggregate.summary({ table }), options: e.text(call.opts) }));
	return D(
		say.aggregate.summary({ table }),
		aggregateKids(c, o, []).flatMap((k) => e.bullet(k)),
	);
}

export function groupByDoc(c: Ctx, call: ModelCall): Doc {
	const { e, say } = c;
	const table = tableOf(e, call.model);
	const o = unwrap(call.opts);
	if (o?.type !== "ObjectExpression") return D(say.rows.withOptions({ rows: say.aggregate.groups({ table, fields: "…" }), options: e.text(call.opts) }));
	const by = o.properties.find((p: N) => keyName(p) === "by")?.value;
	const fields = by ? e.g.list(items(by).map((x) => (literalString(x) !== null ? e.prop(literalString(x)!) : e.text(x)))) : "";
	return D(
		say.aggregate.groups({ table, fields }),
		aggregateKids(c, o, ["by"]).flatMap((k) => e.bullet(k)),
	);
}
