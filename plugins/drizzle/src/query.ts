import { D, type Doc, vlen } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, chainOf, condition, hasSqlValues, isDb, items, keyName, listDoc, type Step, val } from "./shared";

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

const JOINS = new Set(["innerJoin", "leftJoin", "rightJoin", "fullJoin", "innerJoinLateral", "leftJoinLateral"]);

/** A Drizzle builder chain (`db.select().from(t).where(c)`, `db.$with("x").as(...)`) as a bulleted action, or null. */
export function queryDoc(c: Ctx, node: N): Doc | null {
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
	for (const s of steps) {
		const r = stepDoc(c, s, steps[0]!);
		if (r.title !== undefined) title = r.title;
		if (r.kid) kids.push(r.kid);
	}
	const lines = kids.flatMap((k) => e.bullet(k));
	return legacy || lines.length ? D(`${title}:`, lines) : D(title);
}

function stepDoc(c: Ctx, s: Step, first: Step): { title?: string; kid?: Doc } {
	const { e, say } = c;
	const q = say.query;
	const arg = () => val(c, s.args[0]);
	const list = (nodes: N[]) => e.g.list(nodes.map((x) => val(c, x).t));
	switch (s.m) {
		case "select":
		case "selectDistinct":
			return { title: s.args.length ? q.select({ selection: selection(c, s.args[0]) }) : q.selectAll };
		case "selectDistinctOn":
			return {
				title: s.args[1] ? q.select({ selection: selection(c, s.args[1]) }) : q.selectAll,
				kid: D(q.distinctOn({ columns: list(items(s.args[0])) })),
			};
		case "from": {
			const fields = first.m === "selectDistinctOn" ? first.args[1] : first.args[0];
			const title = (first.m === "select" && !first.args.length ? q.fromRows : q.fromFields)({ table: arg().t });
			if (!fields) return { title };
			if (hasSqlValues(fields)) {
				const f = val(c, fields);
				return { title, kid: D(q.picking({ fields: f.t }), f.kids) };
			}
			return { title, kid: D(q.picking({ fields: e.text(fields) }), e.noun(fields).kids) };
		}
		case "insert":
			return { title: q.insertInto({ table: arg().t }) };
		case "update":
			return { title: q.update({ table: arg().t }) };
		case "delete":
			return { title: q.deleteFrom({ table: arg().t }) };
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
			return { kid: D(q.atMost({ count: arg().t })) };
		case "offset":
			return { kid: D(q.skipping({ count: arg().t })) };
		case "returning":
			return { kid: D(q.returning) };
		case "$returningId":
			return { kid: D(q.returningIds) };
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
