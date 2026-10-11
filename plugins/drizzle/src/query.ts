import { D, type Doc, vlen } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, chainOf, condition, isDb, isOne, isSqlTemplate, items, keyName, listDoc, type Step, val } from "./shared";

/** Outermost methods the plugin always claimed; their chains keep the original receiver check and trailing colon. */
const LEGACY_OUTER = new Set([
	"select",
	"from",
	"where",
	"limit",
	"orderBy",
	"returning",
	"values",
	"onConflictDoNothing",
	"onConflictDoUpdate",
	"innerJoin",
	"leftJoin",
	"groupBy",
	"for",
]);
const LEGACY_HEADS = new Set(["select", "selectDistinct", "insert", "update", "delete"]);
const HEADS = new Set([...LEGACY_HEADS, "selectDistinctOn"]);

export const QUERY_METHODS = [
	...LEGACY_OUTER,
	"selectDistinct",
	"selectDistinctOn",
	"insert",
	"update",
	"delete",
	"set",
	"offset",
	"rightJoin",
	"fullJoin",
	"crossJoin",
	"innerJoinLateral",
	"leftJoinLateral",
	"crossJoinLateral",
	"having",
	"as",
	"$dynamic",
	"$returningId",
	"prepare",
	"toSQL",
	"execute",
	"onDuplicateKeyUpdate",
];

/** Steps after which a select no longer reads as "every row". */
const NARROWING = new Set(["where", "limit", "offset", "having", "groupBy", "innerJoin", "innerJoinLateral", "selectDistinctOn", "selectDistinct"]);
const JOINS = new Set(["innerJoin", "leftJoin", "rightJoin", "fullJoin", "innerJoinLateral", "leftJoinLateral"]);

/** How a query sits in the code: run as a step (`await db.delete(t)`) or used as a value (`return db.select()...`). */
export type QueryMode = "action" | "value";

/** A Drizzle builder chain (`db.select().from(t).where(c)`, `db.$with("x").as(...)`) as a bulleted action or value, or null. */
export function queryDoc(c: Ctx, node: N, mode: QueryMode = "action"): Doc | null {
	const { e, say } = c;
	const { root, steps: all } = chainOf(node);
	if (!all.length) return null;
	if (all[0]!.m === "$with") {
		if (all[1]?.m !== "as" || !isDb(e, root)) return null;
		const inner = queryDoc(c, all[1].args[0]) ?? val(c, all[1].args[0]);
		return D(say.query.cte({ name: val(c, all[0]!.args[0]).t }), e.bullet(inner));
	}
	const ctes = all[0]!.m === "with" ? all[0]! : null;
	const steps = ctes ? all.slice(1) : all;
	const head = steps[0]?.m;
	if (!head || !HEADS.has(head)) return null;
	const legacy = !ctes && LEGACY_HEADS.has(head) && LEGACY_OUTER.has(all.at(-1)!.m);
	if (legacy ? !e.isAmbient(root) && !/db|tx/i.test(e.code(root)) : !isDb(e, root)) return null;
	let title = "";
	const kids: Doc[] = [];
	if (ctes)
		kids.push(
			D(
				say.query.usingCtes({
					names: listDoc(
						e,
						ctes.args.map((a) => val(c, a)),
					).t,
				}),
			),
		);
	const filtered = steps.some((s) => NARROWING.has(s.m));
	const returning = mode === "value" && steps.some((s) => s.m === "returning" || s.m === "$returningId");
	for (const s of steps) {
		const r = stepDoc({ c, s, first: steps[0]!, mode, returning, filtered });
		if (r.title !== undefined) title = r.title;
		if (r.kid) kids.push(r.kid);
	}
	const lines = kids.flatMap((k) => e.bullet(k));
	return lines.length ? D(`${title}:`, lines) : D(title);
}

type StepSite = { c: Ctx; s: Step; first: Step; mode: QueryMode; returning: boolean; filtered: boolean };

function stepDoc({ c, s, first, mode, returning, filtered }: StepSite): { title?: string; kid?: Doc } {
	const { e, say } = c;
	const q = say.query;
	const noun = mode === "value" ? q.noun : null;
	const arg = () => val(c, s.args[0]);
	const list = (nodes: N[]) => e.g.list(nodes.map((x) => val(c, x).t));
	switch (s.m) {
		case "select":
		case "selectDistinct":
			return { title: s.args.length ? (noun ?? q).select({ selection: selection(c, s.args[0]) }) : (noun ?? q).selectAll };
		case "selectDistinctOn":
			return {
				title: s.args[1] ? (noun ?? q).select({ selection: selection(c, s.args[1]) }) : (noun ?? q).selectAll,
				kid: D(q.distinctOn({ columns: list(items(s.args[0])) })),
			};
		case "from": {
			const fields = first.m === "selectDistinctOn" ? first.args[1] : first.args[0];
			const title = noun
				? (filtered ? noun.rows : noun.everyRow)({ table: arg().t })
				: (first.m === "select" && !first.args.length ? q.fromRows : q.fromFields)({ table: arg().t });
			return fields ? { title, kid: picking(c, fields) } : { title };
		}
		case "insert":
			return { title: (noun ?? q).insertInto({ table: arg().t, returning }) };
		case "update":
			return { title: (noun ?? q).update({ table: arg().t, returning }) };
		case "delete":
			return { title: (noun ?? q).deleteFrom({ table: arg().t, returning }) };
		case "values": {
			const v = arg();
			return { kid: D(q.values({ values: v.t }), v.kids) };
		}
		case "set": {
			const v = arg();
			return { kid: D(q.setting({ changes: v.t }), v.kids) };
		}
		case "where": {
			const w = condition(c, s.args[0]);
			return { kid: D(q.where({ condition: w.t }), w.kids) };
		}
		case "having": {
			const w = condition(c, s.args[0]);
			return { kid: D(q.having({ condition: w.t }), w.kids) };
		}
		case "crossJoin":
		case "crossJoinLateral":
			return { kid: D(q.crossJoined({ table: arg().t })) };
		case "orderBy":
			return { kid: D(q.sortedBy({ columns: list(s.args) })) };
		case "groupBy":
			return { kid: D(q.groupedBy({ columns: list(s.args) })) };
		case "limit":
			return { kid: D(q.atMost({ count: arg().t, one: isOne(s.args[0]) })) };
		case "offset":
			return { kid: D(q.skipping({ count: arg().t, one: isOne(s.args[0]) })) };
		case "returning":
			if (s.args.length) return { kid: picking(c, s.args[0], returning ? "picking" : "returning") };
			return returning ? {} : { kid: D(q.returning) };
		case "$returningId":
			return returning ? {} : { kid: D(q.returningIds) };
		case "onConflictDoNothing":
			return { kid: D(q.ignoreConflicts) };
		case "onConflictDoUpdate":
		case "onDuplicateKeyUpdate":
			return { kid: conflictUpdate(c, s.args[0]) };
		case "for":
			return { kid: D(q.locking({ mode: arg().t })) };
		case "as":
			return { kid: D(q.subquery({ name: arg().t })) };
		case "$dynamic":
			return { kid: D(q.dynamic) };
		case "prepare":
			return { kid: D(q.prepared({ name: arg().t })) };
		case "toSQL":
			return { kid: D(q.toSql) };
		case "execute":
			return {};
	}
	if (JOINS.has(s.m)) {
		const on = condition(c, s.args[1]);
		return { kid: D(q.joined({ table: arg().t, condition: on.t }), on.kids) };
	}
	return { kid: D(q.otherStep({ method: s.m, args: s.args.length ? list(s.args) : "" })) };
}

/** `{ id: users.id, n: count() }` as "users' ID and n: the number of rows"; a field named like its column is just the column. */
function picking(c: Ctx, fields: N, how: "picking" | "returning" = "picking"): Doc {
	const { e, say } = c;
	const phrase = how === "picking" ? say.query.picking : say.query.returningFields;
	const o = unwrap(fields);
	const props = o?.type === "ObjectExpression" ? o.properties : [];
	if (!props.length || props.some((p: N) => p.type !== "Property" || p.computed)) {
		const f = val(c, fields);
		return D(phrase({ fields: f.t }), f.kids);
	}
	const docs: Doc[] = props.map((p: N) => {
		const v = unwrap(p.value);
		const sameName = v?.type === "MemberExpression" && !v.computed && v.property.name === keyName(p);
		if (sameName) return e.noun(v);
		if (isSqlTemplate(v)) return D(say.sql.field({ key: e.prop(keyName(p) ?? ""), value: val(c, v).t }));
		return e.objectProp(p);
	});
	const joined = e.g.list(docs.map((d) => d.t));
	if (docs.length <= 3 && vlen(joined) < 70 && docs.every((d) => !d.kids.length)) return D(phrase({ fields: joined }));
	return D(
		phrase({ fields: say.query.theseFields }),
		docs.flatMap((d) => e.bullet(d)),
	);
}

/** The selection of `db.select(fields)` used as the title when there's no `.from(...)`. */
function selection(c: Ctx, arg: N): string {
	const { e, say } = c;
	const o = unwrap(arg);
	const props = o?.type === "ObjectExpression" ? o.properties : [];
	if (!props.length || props.some((p: N) => p.type !== "Property")) return e.noun(arg).t;
	const fields = props.map((p: N) => e.objectProp(p));
	const joined = e.g.list(fields.map((f: Doc) => f.t));
	const inline = fields.length <= 3 && vlen(joined) < 70 && fields.every((f: Doc) => !f.kids.length);
	return say.query.fields({ list: inline ? joined : "" });
}

function conflictUpdate(c: Ctx, arg: N): Doc {
	const { e, say } = c;
	const o = unwrap(arg);
	if (o?.type !== "ObjectExpression") return D(say.query.updateConflicts);
	const get = (k: string) => o.properties.find((p: N) => keyName(p) === k)?.value;
	const kids: Doc[] = [];
	const set = get("set");
	if (set) {
		const v = val(c, set);
		kids.push(D(say.query.setting({ changes: v.t }), v.kids));
	}
	const where = get("setWhere") ?? get("where");
	if (where) {
		const w = condition(c, where);
		kids.push(D(say.query.where({ condition: w.t }), w.kids));
	}
	const targetWhere = get("targetWhere");
	if (targetWhere) {
		const w = condition(c, targetWhere);
		kids.push(D(say.query.conflictWhere({ condition: w.t }), w.kids));
	}
	const target = get("target");
	const lines = kids.flatMap((k) => e.bullet(k));
	if (!target) return D(say.query.updateConflicts, lines);
	const t = listDoc(
		e,
		items(target).map((x) => val(c, x)),
	);
	return D(say.query.updateConflictsOn({ target: t.t }), [...t.kids, ...lines]);
}
