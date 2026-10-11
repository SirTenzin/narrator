import { D, type Doc, vlen } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { combine, compareDoc, condDoc, exprDoc, orderDocs, refDoc, valDoc, whereArgs } from "./expr";
import { active, type Ctx, chainOf, fnResult, inside, isFn, items, keyName, listDoc, literalString, refText, type Step } from "./shared";

export const HEADS = new Set(["selectFrom", "insertInto", "replaceInto", "updateTable", "deleteFrom", "mergeInto"]);
const TERMINALS = new Set(["execute", "executeTakeFirst", "executeTakeFirstOrThrow", "stream", "compile", "explain"]);
/** Builder steps `stepDocs` reads; a variable's chain made only of these is a Kysely query. */
const KNOWN_STEPS = new Set([
	"select",
	"selectAll",
	"where",
	"whereRef",
	"having",
	"havingRef",
	"innerJoin",
	"leftJoin",
	"rightJoin",
	"fullJoin",
	"crossJoin",
	"orderBy",
	"groupBy",
	"limit",
	"offset",
	"distinct",
	"distinctOn",
	"values",
	"set",
	"returning",
	"returningAll",
	"onConflict",
	"$if",
	"$call",
	"clearSelect",
	"clearWhere",
	"clearOrderBy",
	"clearLimit",
	"clearOffset",
	"clearGroupBy",
]);
const SILENT = new Set(["$narrowType", "$castTo", "$assertType", "$notNull", "$asTuple", "$asScalar"]);

/** A Kysely builder chain as a bulleted action, or null when the chain doesn't start at a Kysely query head. */
export function queryDoc(c: Ctx, node: N, stmt = false): Doc | null {
	const { e, say } = c;
	if (!active(e)) return null;
	const { root, steps: all } = chainOf(node);
	const headAt = all.findIndex((s) => HEADS.has(s.m));
	if (headAt < 0) return partialDoc(c, root, all, stmt);
	if (!all.slice(0, headAt).every((s) => s.m === "with" || s.m === "withRecursive")) return null;
	const kids: Doc[] = all.slice(0, headAt).map((s) => cteDoc(c, s));
	let steps = all.slice(headAt);
	const alias = steps.at(-1)!.m === "as" && steps.length > 1 ? steps.pop()! : null;
	const terminal = TERMINALS.has(steps.at(-1)!.m) ? steps.at(-1)!.m : null;
	if (terminal) steps = steps.slice(0, -1);
	const head = steps[0]!;
	const title = titleOf(c, head, steps.slice(1), kids);
	const orders = steps.filter((s) => s.m === "orderBy");
	for (const s of steps.slice(1)) {
		if (s.m === "orderBy" && s !== orders[0]) continue;
		if (s.m === "orderBy") kids.push(D(say.query.sortedBy({ columns: e.g.list(orders.flatMap((o) => orderDocs(c, o.args))) })));
		else kids.push(...stepDocs(c, s, head.m));
	}
	const doc = finish(
		c,
		D(
			title,
			kids.flatMap((k) => e.bullet(k)),
		),
		terminal,
		head.m,
		stmt,
	);
	if (!alias) return doc;
	const name = literalString(alias.args[0]);
	return D(say.value.named({ value: doc.t, name: name !== null ? refText(c, name) : e.text(alias.args[0]) }), doc.kids);
}

const SQL_OPS = /^(=|==|!=|<>|>|>=|<|<=|in|not in|is|is not|i?like|not i?like|@>|<@|&&|~\*?|!~\*?)$/i;
const WHERE_STEPS = new Set(["where", "whereRef", "having", "havingRef"]);

/** `qb.where("a", "=", 1).orderBy("b")` on a builder held in a variable: the clauses it adds. */
function partialDoc(c: Ctx, root: N, steps: Step[], stmt: boolean): Doc | null {
	const { e, say } = c;
	const r = unwrap(root);
	if (!steps.length || !["Identifier", "MemberExpression"].includes(r?.type)) return null;
	const body = TERMINALS.has(steps.at(-1)!.m) ? steps.slice(0, -1) : steps;
	if (!body.length || !body.every((s) => KNOWN_STEPS.has(s.m))) return null;
	const name = r.type === "Identifier" ? r.name : r.property.name;
	const typed = /QueryBuilder$/.test(e.varTypes.get(name) ?? "") || /^(qb|query|builder|baseQuery)$/i.test(name);
	const opStep = body.some((s) => WHERE_STEPS.has(s.m) && s.args.length >= 3 && SQL_OPS.test(literalString(s.args[1]) ?? ""));
	if (!typed && !opStep) return null;
	const q = e.noun(root);
	const kids = body.flatMap((s) => stepDocs(c, s, "selectFrom"));
	const doc = D(say.query.refined({ query: q.t }), [...q.kids, ...kids.flatMap((k) => e.bullet(k))]);
	return finish(c, doc, body.length < steps.length ? steps.at(-1)!.m : null, "selectFrom", stmt);
}

/** The terminal call decides what the value is: all rows, the first row, a stream or just the SQL. */
function finish(c: Ctx, doc: Doc, terminal: string | null, head: string, stmt: boolean): Doc {
	const r = c.say.run;
	if (!terminal || ((terminal === "execute" || terminal === "executeTakeFirst") && stmt)) return doc;
	if (terminal === "execute") return head === "selectFrom" ? doc : D(r.results({ query: doc.t }), doc.kids);
	if (terminal === "executeTakeFirst") return D(r.first({ query: doc.t }), doc.kids);
	if (terminal === "executeTakeFirstOrThrow") return D(r.firstOrFail({ query: doc.t }), doc.kids);
	if (terminal === "stream") return D(r.stream({ query: doc.t }), doc.kids);
	if (terminal === "compile") return D(r.compile({ query: doc.t }), doc.kids);
	return D(r.explain({ query: doc.t }), doc.kids);
}

/** `selectFrom("person")`, `selectFrom(["person", "pet"])`, `selectFrom("person as p")`, or a subquery. */
function tableDoc(c: Ctx, n: N): Doc {
	const list = items(n).map((x) => {
		const s = literalString(x);
		if (s !== null) return D(refText(c, s));
		if (isFn(x)) {
			const body = fnResult(x);
			if (body) return exprDoc(inside(c, x), body);
		}
		return exprDoc(c, x);
	});
	return listDoc(c.e, list);
}

/** The fields of `select(...)` / `returning(...)`: strings, arrays, or a callback returning expressions. */
function fieldsOf(c: Ctx, args: N[]): Doc[] {
	const a = unwrap(args[0]);
	if (!a) return [];
	if (isFn(a)) {
		const body = fnResult(a);
		if (!body) return [c.e.noun(a)];
		const ic = inside(c, a);
		return items(body).map((x) => refDoc(ic, x));
	}
	return items(a).map((x) => refDoc(c, x));
}

function titleOf(c: Ctx, head: Step, rest: Step[], kids: Doc[]): string {
	const { e, say } = c;
	const q = say.query;
	const table = tableDoc(c, head.args[0]);
	if (table.kids.length) kids.push(D(q.tableDefinedAs, table.kids));
	if (head.m === "insertInto") return q.insertInto({ table: table.t });
	if (head.m === "replaceInto") return q.replaceInto({ table: table.t });
	if (head.m === "updateTable") return q.update({ table: table.t });
	if (head.m === "deleteFrom") return q.deleteFrom({ table: table.t });
	if (head.m === "mergeInto") return q.mergeInto({ table: table.t });
	const selects = rest.filter((s) => s.m === "select" || s.m === "selectAll");
	const fields = selects.flatMap((s) =>
		s.m === "selectAll"
			? s.args.length
				? items(s.args[0]).map((t) => D(say.value.allColumnsOf({ table: refText(c, literalString(t) ?? e.code(t)) })))
				: []
			: fieldsOf(c, s.args),
	);
	if (!fields.length) return q.fromRows({ table: table.t });
	const list = listDoc(e, fields);
	if (fields.length <= 4 && !list.kids.length && vlen(list.t) <= 70) return q.select({ fields: list.t, table: table.t });
	const short = fields.length <= 6 && !list.kids.length;
	kids.push(
		short
			? D(q.picking({ fields: list.t }))
			: D(
					q.pickingBlock,
					fields.flatMap((f) => e.bullet(f)),
				),
	);
	return q.fromFields({ table: table.t });
}

function cteDoc(c: Ctx, s: Step): Doc {
	const { e, say } = c;
	const name = literalString(s.args[0]);
	const fn = unwrap(s.args[1]);
	const body = fn && isFn(fn) ? fnResult(fn) : fn;
	const inner = body ? (queryDoc(inside(c, fn), body) ?? exprDoc(c, body)) : D("");
	return D(say.query.cte({ name: name !== null ? refText(c, name) : e.text(s.args[0]) }), e.bullet(inner));
}

const JOINS: Record<string, "joined" | "leftJoined" | "rightJoined" | "fullJoined"> = {
	innerJoin: "joined",
	leftJoin: "leftJoined",
	rightJoin: "rightJoined",
	fullJoin: "fullJoined",
	innerJoinLateral: "joined",
	leftJoinLateral: "leftJoined",
};

/** A join's condition: `(table, "a.id", "b.a_id")` or `(table, (join) => join.onRef(...).on(...))`. */
function joinDoc(c: Ctx, s: Step): Doc {
	const { e, say } = c;
	const table = tableDoc(c, s.args[0]);
	const phrase = say.query[JOINS[s.m]!];
	if (s.args.length >= 3) {
		const cond = compareDoc(c, refDoc(c, s.args[1]), { type: "Literal", value: "=" }, s.args[2], false, true);
		return D(phrase({ table: table.t, condition: cond.t }), cond.kids);
	}
	const fn = unwrap(s.args[1]);
	if (!fn || !isFn(fn)) return D(phrase({ table: table.t, condition: fn ? e.text(fn) : "" }));
	const ic = inside(c, fn);
	const { steps } = chainOf(fnResult(fn));
	const conds = steps.filter((x) => x.m !== "onTrue").map((x) => (x.m === "onRef" ? whereArgs(ic, x.args, false, true) : whereArgs(ic, x.args)));
	if (conds.length === 1) return D(phrase({ table: table.t, condition: conds[0]!.t }), conds[0]!.kids);
	if (!conds.length) return D(say.query.crossJoined({ table: table.t }));
	return D(
		say.query.joinedOn({ table: table.t }),
		conds.flatMap((x) => e.bullet(x)),
	);
}

/** An object of column values (`values`, `set`, `doUpdateSet`), one bullet per column. */
function columnsDoc(c: Ctx, n: N): Doc[] {
	const { e } = c;
	const o = unwrap(n);
	if (isFn(o)) {
		const body = fnResult(o);
		if (body) return columnsDoc(inside(c, o), body);
	}
	if (o?.type !== "ObjectExpression") return [valDoc(c, n)];
	return o.properties.map((p: N) => {
		const k = keyName(p);
		if (!k || p.shorthand) return e.objectProp(p);
		const v = valDoc(c, p.value);
		return D(e.say.expressions.labeled({ key: e.prop(k), value: v.t }), v.kids);
	});
}

function stepDocs(c: Ctx, s: Step, head: string): Doc[] {
	const { e, say } = c;
	const q = say.query;
	const one = (d: Doc) => [d];
	switch (s.m) {
		case "select":
		case "selectAll":
			return [];
		case "where":
		case "whereRef": {
			const w = whereArgs(c, s.args, false, s.m === "whereRef");
			return one(D(q.where({ condition: w.t }), w.kids));
		}
		case "having":
		case "havingRef": {
			const w = whereArgs(c, s.args, false, s.m === "havingRef");
			return one(D(q.having({ condition: w.t }), w.kids));
		}
		case "innerJoin":
		case "leftJoin":
		case "rightJoin":
		case "fullJoin":
		case "innerJoinLateral":
		case "leftJoinLateral":
			return one(joinDoc(c, s));
		case "crossJoin":
		case "crossJoinLateral":
			return one(D(q.crossJoined({ table: tableDoc(c, s.args[0]).t })));
		case "orderBy":
			return one(D(q.sortedBy({ columns: e.g.list(orderDocs(c, s.args)) })));
		case "groupBy":
			return one(D(q.groupedBy({ columns: listDoc(e, fieldsOf(c, s.args)).t })));
		case "limit":
		case "top":
			return one(D(q.atMost({ count: e.text(s.args[0]) })));
		case "offset":
			return one(D(q.skipping({ count: e.text(s.args[0]) })));
		case "distinct":
			return one(D(q.distinct));
		case "distinctOn":
			return one(D(q.distinctOn({ columns: listDoc(e, fieldsOf(c, s.args)).t })));
		case "values":
		case "thenInsertValues":
			return valuesDocs(c, s.args[0]);
		case "set":
		case "thenUpdateSet": {
			if (s.args.length >= 2) {
				const v = valDoc(c, s.args[1]);
				return one(D(q.setting({ changes: e.say.expressions.labeled({ key: refDoc(c, s.args[0]).t, value: v.t }) }), v.kids));
			}
			return columnsDoc(c, s.args[0]).map((d) => D(q.setting({ changes: d.t }), d.kids));
		}
		case "returning":
			return one(D(q.returning({ fields: listDoc(e, fieldsOf(c, s.args)).t })));
		case "returningAll":
			return one(D(q.returningAll));
		case "onConflict":
			return one(conflictDoc(c, s.args[0]));
		case "onDuplicateKeyUpdate":
			return one(
				D(
					q.updateConflicts,
					columnsDoc(c, s.args[0]).flatMap((d) => e.bullet(D(q.setting({ changes: d.t }), d.kids))),
				),
			);
		case "ignore":
			return one(D(q.ignoreConflicts));
		case "forUpdate":
		case "forShare":
		case "forNoKeyUpdate":
		case "forKeyShare":
		case "skipLocked":
		case "noWait":
			return one(D(q.locking({ mode: e.lex.humanize(s.m) })));
		case "$if": {
			const cond = e.cond(s.args[0]);
			const fn = unwrap(s.args[1]);
			const body = fn && isFn(fn) ? fnResult(fn) : null;
			const inner = body ? chainOf(body).steps.flatMap((x) => stepDocs(inside(c, fn), x, head)) : [];
			return one(D(q.onlyIf({ condition: cond.t }), [...cond.kids, ...inner.flatMap((d) => e.bullet(d))]));
		}
		case "$call":
			return one(D(q.passedThrough({ fn: e.text(s.args[0]) })));
		case "using": {
			const cond = s.args.length >= 3 ? compareDoc(c, refDoc(c, s.args[1]), { type: "Literal", value: "=" }, s.args[2], false, true) : D("");
			return one(D(q.using({ table: tableDoc(c, s.args[0]).t, condition: cond.t }), cond.kids));
		}
		case "whenMatched":
		case "whenMatchedAnd":
			return one(D(q.whenMatched));
		case "whenNotMatched":
		case "whenNotMatchedAnd":
			return one(D(q.whenNotMatched));
		case "thenDelete":
			return one(D(q.thenDelete));
		case "thenDoNothing":
			return one(D(q.thenDoNothing));
		default:
			if (SILENT.has(s.m)) return [];
			return one(D(q.otherStep({ method: e.lex.humanize(s.m), args: s.args.map((a) => e.text(a)).join(", ") })));
	}
}

/** `values({...})`, `values([{...}, {...}])`, `values(subquery)`, `values((eb) => ({...}))`. */
function valuesDocs(c: Ctx, n: N): Doc[] {
	const { e, say } = c;
	const u = unwrap(n);
	if (u?.type === "ArrayExpression")
		return [
			D(
				say.query.rows,
				u.elements.flatMap((x: N) =>
					e.bullet(
						D(
							say.query.row,
							columnsDoc(c, x).flatMap((d) => e.bullet(d)),
						),
					),
				),
			),
		];
	const sub = u ? queryDoc(c, u) : null;
	if (sub) return [D(say.query.valuesFrom({ query: sub.t }), sub.kids)];
	return columnsDoc(c, n);
}

/** `onConflict((oc) => oc.column("email").doUpdateSet({...}))`. */
function conflictDoc(c: Ctx, fn: N): Doc {
	const { e, say } = c;
	const q = say.query;
	const f = unwrap(fn);
	const body = f && isFn(f) ? fnResult(f) : null;
	if (!body) return D(q.updateConflicts);
	const ic = inside(c, f);
	const { steps } = chainOf(body);
	let target = "";
	let update: Step | null = null;
	const where: Doc[] = [];
	for (const s of steps) {
		if (s.m === "column" || s.m === "columns")
			target = listDoc(
				e,
				items(s.args[0]).map((x) => refDoc(ic, x)),
			).t;
		else if (s.m === "constraint") target = q.constraint({ name: e.text(s.args[0]) });
		else if (s.m === "expression") target = exprDoc(ic, s.args[0]).t;
		else if (s.m === "doUpdateSet") update = s;
		else if (s.m === "where" || s.m === "whereRef") {
			const w = whereArgs(ic, s.args, false, s.m === "whereRef");
			where.push(D(q.where({ condition: w.t }), w.kids));
		}
	}
	if (!update) return D(target ? q.ignoreConflictsOn({ target }) : q.ignoreConflicts);
	const sets = columnsDoc(ic, update.args[0]).map((d) => D(q.setting({ changes: d.t }), d.kids));
	return D(
		target ? q.updateConflictsOn({ target }) : q.updateConflicts,
		[...sets, ...where].flatMap((d) => e.bullet(d)),
	);
}

export { combine, condDoc };
