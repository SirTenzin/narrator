import { D, type Doc, mk } from "@usenarrator/core";
import type {
	AlterTableStatement,
	ColumnConstraint,
	CreateColumnDef,
	CreateColumnsLikeTable,
	CreateIndexStatement,
	CreateTableStatement,
	DeleteStatement,
	DropStatement,
	From,
	InsertStatement,
	SelectedColumn,
	SelectFromStatement,
	SelectStatement,
	SetStatement,
	Statement,
	TableConstraint,
	TableReference,
	UpdateStatement,
	WithRecursiveStatement,
	WithStatement,
} from "pgsql-ast-parser";
import { block, type Ctx, columnList, cond, fitsInline, ident, type Narrated, names, orderKeys, qname, scopeOf, sqlType, test, value } from "./expr";
import type { DropKind, JoinKind, LockKind, RefAction } from "./phrases";

const code = (s: string) => mk("c", s);

/** Any statement, narrated as its action, its noun form, and its clauses. */
export function statement(c: Ctx, s: Statement): Narrated {
	switch (s.type) {
		case "select":
		case "union":
		case "union all":
		case "values":
		case "with":
		case "with recursive":
			return query(c, s);
		case "insert":
			return insert(c, s);
		case "update":
			return update(c, s);
		case "delete":
			return remove(c, s);
	}
	return acting(c, schemaStatement(c, s));
}

/** A statement with no noun form of its own reads as "the result of running SQL to ...". */
const acting = (c: Ctx, { action, items }: { action: string; items: Doc[] }): Narrated => ({ action, value: c.say.run.value({ action }), items });
const selecting = (c: Ctx, value: string, items: Doc[]): Narrated => ({ action: c.say.select.action({ what: value }), value, items });
const nested = (c: Ctx, head: (what: string) => string, n: Narrated): Doc => block(c.e, head(n.value), n.items);

function query(c: Ctx, s: SelectStatement | WithStatement | WithRecursiveStatement): Narrated {
	const { say, e } = c;
	switch (s.type) {
		case "select":
			return selectFrom(c, s);
		case "union":
		case "union all": {
			const parts: SelectStatement[] = [];
			const collect = (x: SelectStatement): void => {
				if (x.type !== s.type) parts.push(x);
				else [x.left, x.right].forEach(collect);
			};
			collect(s);
			const items = parts.map((p) => {
				const n = query(c, p as typeof s);
				return block(e, n.value, n.items);
			});
			return selecting(c, s.type === "union" ? say.select.union : say.select.unionAll, items);
		}
		case "values":
			return selecting(
				c,
				say.select.values,
				s.values.map((row) => D(say.select.row({ values: e.g.list(row.map((x) => value(c, x))) }))),
			);
		case "with": {
			const ctes = s.bind.map((b) => nested(c, (what) => say.select.defines({ name: code(b.alias.name), what }), statement(c, b.statement)));
			const main = statement(c, s.in);
			return { ...main, items: [...ctes, ...main.items] };
		}
		case "with recursive": {
			const name = code(s.alias.name);
			const bind = s.bind;
			const steps = [bind.left, bind.right].map((part, i) =>
				nested(c, (what) => (i ? say.select.recursiveStep({ what }) : say.select.recursiveStart({ what })), query(c, part as typeof s)),
			);
			const main = statement(c, s.in);
			return { ...main, items: [block(e, say.select.recursive({ name }), steps), ...main.items] };
		}
	}
}

const JOINS: Record<string, JoinKind> = { "INNER JOIN": "inner", "LEFT JOIN": "left", "RIGHT JOIN": "right", "FULL JOIN": "full", "CROSS JOIN": "cross" };
const LOCKS: Record<string, LockKind> = { update: "update", "no key update": "noKeyUpdate", share: "share", "key share": "keyShare" };

/** How a FROM item is named in the narration, plus a clause explaining it when it's a subquery. */
function source(c: Ctx, f: From): { name: string; doc: Doc | null } {
	const { say } = c;
	if (f.type === "table") {
		const t = qname(c, f.name);
		const aliased = f.name.alias && !c.aliases.has(f.name.alias);
		return { name: aliased ? say.select.alias({ value: t, name: code(f.name.alias!) }) : t, doc: null };
	}
	if (f.type === "statement") {
		const name = code(f.alias);
		return { name, doc: nested(c, (what) => say.select.defines({ name, what }), statement(c, f.statement)) };
	}
	const v = value(c, { ...f, type: "call" } as Parameters<typeof value>[1]);
	return { name: f.alias ? say.select.alias({ value: v, name: code(f.alias.name) }) : v, doc: null };
}

function selectFrom(outer: Ctx, s: SelectFromStatement): Narrated {
	const c = scopeOf(outer, s.from ?? []);
	const { say, e } = c;
	const sel = say.select;
	const items: Doc[] = [];
	const from = (s.from ?? []).map((f) => ({ f, ...source(c, f) }));
	for (const { doc } of from) if (doc) items.push(doc);
	for (const { f, name } of from.slice(1)) {
		const kind = f.join ? JOINS[f.join.type]! : "cross";
		const on = f.join?.on ? cond(c, f.join.on) : D(f.join?.using ? sel.joinUsing({ columns: names(c, f.join.using) }) : "");
		items.push(D(sel.join[kind]({ table: name, on: on.t }), on.kids));
	}
	const cols = s.columns ?? [];
	const star = cols.length === 1 && cols[0]!.expr.type === "ref" && cols[0]!.expr.name === "*" && !cols[0]!.expr.table;
	const rendered = star ? [] : columnList(c, cols);
	const src = from[0]?.name;
	let head: string;
	if (!src) head = sel.bare({ columns: e.g.list(rendered) });
	else if (star) head = sel.rows({ source: src });
	else if (fitsInline(rendered) && !cols.some((col) => col.alias)) head = sel.columns({ columns: e.g.list(rendered), source: src });
	else {
		head = sel.rows({ source: src });
		items.unshift(
			block(
				e,
				sel.columnList,
				rendered.map((r) => D(r)),
			),
		);
	}
	if (s.distinct === "distinct") items.push(D(sel.distinct));
	else if (Array.isArray(s.distinct)) items.push(D(sel.distinctOn({ columns: e.g.list(s.distinct.map((x) => value(c, x))) })));
	if (s.where) items.push(clause(cond(c, s.where), (condition) => sel.where({ condition })));
	if (s.groupBy?.length) items.push(D(sel.groupBy({ columns: e.g.list(s.groupBy.map((x) => value(c, x))) })));
	if (s.having) items.push(clause(cond(c, s.having), (condition) => sel.having({ condition })));
	if (s.orderBy?.length) items.push(D(sel.orderBy({ keys: orderKeys(c, s.orderBy) })));
	if (s.limit?.limit) items.push(D(sel.limit({ count: value(c, s.limit.limit) })));
	if (s.limit?.offset) items.push(D(sel.offset({ count: value(c, s.limit.offset) })));
	if (s.for) items.push(D(sel.lock[LOCKS[s.for.type]!]));
	if (s.skip) items.push(D(s.skip.type === "skip locked" ? sel.skipLocked : sel.noWait));
	return selecting(c, head, items);
}

/** A clause wrapping a condition that may be a bulleted block. */
const clause = (d: Doc, wrap: (t: string) => string): Doc => D(wrap(d.t), d.kids);

function returning(c: Ctx, cols: SelectedColumn[] | null | undefined): Doc[] {
	if (!cols?.length) return [];
	return [D(c.say.write.returning({ columns: c.e.g.list(columnList(c, cols)) }))];
}

/** `set a = b, n = n + 1`: plain assignments together, increments as their own clauses. */
function assignments(c: Ctx, sets: SetStatement[]): Doc[] {
	const { say, e } = c;
	const plainSets: string[] = [];
	const steps: Doc[] = [];
	for (const s of sets) {
		const col = ident(c, s.column.name);
		const v = s.value;
		const self = v.type === "binary" && (v.op === "+" || v.op === "-") && v.left.type === "ref" && v.left.name === s.column.name;
		if (self) steps.push(D((v.op === "+" ? say.set.increase : say.set.decrease)({ column: col, by: value(c, v.right) })));
		else plainSets.push(say.set.assign({ column: col, value: value(c, v) }));
	}
	const out: Doc[] = [];
	if (plainSets.length && fitsInline(plainSets)) out.push(D(say.set.list({ assignments: e.g.list(plainSets) })));
	else if (plainSets.length)
		out.push(
			block(
				e,
				say.set.block,
				plainSets.map((p) => D(p)),
			),
		);
	return [...out, ...steps];
}

function insert(outer: Ctx, s: InsertStatement): Narrated {
	const c = scopeOf(outer, [{ name: s.into }]);
	const { say, e } = c;
	const table = qname(c, s.into);
	const cols = s.columns ?? [];
	const items: Doc[] = [];
	const src = s.insert as SelectStatement | undefined;
	let n: number | null = null;
	if (!src) items.push(D(say.insert.defaults));
	else if (src.type === "values") {
		n = src.values.length;
		const row = (r: (typeof src.values)[number]) =>
			cols.length ? r.map((x, i) => say.set.assign({ column: cols[i] ? ident(c, cols[i]!.name) : code("?"), value: value(c, x) })) : r.map((x) => value(c, x));
		if (n === 1)
			items.push(
				...assignments(
					c,
					cols.map((col, i) => ({ column: col, value: src.values[0]![i]! })).filter((x) => x.value),
				),
			);
		else
			items.push(
				block(
					e,
					say.insert.rows({ columns: names(c, cols) }),
					src.values.map((r) => D(say.select.row({ values: e.g.list(row(r)) }))),
				),
			);
		if (n === 1 && !cols.length) items.push(D(say.select.row({ values: e.g.list(row(src.values[0]!)) })));
	} else {
		const q = statement(c, src);
		items.push(block(e, say.insert.copy({ what: q.value }), q.items));
	}
	if (s.onConflict) items.push(conflict(c, s.onConflict));
	items.push(...returning(c, s.returning));
	return acting(c, { action: say.insert.action({ table, count: e.g.formatNumber(n ?? 0), n }), items });
}

function conflict(c: Ctx, oc: NonNullable<InsertStatement["onConflict"]>): Doc {
	const { say, e } = c;
	const target = !oc.on
		? ""
		: oc.on.type === "on expr"
			? e.g.list(oc.on.exprs.map((x) => value(c, x)))
			: say.insert.constraintTarget({ name: qname(c, oc.on.constraint) });
	if (oc.do === "do nothing") return D(target ? say.insert.conflictNothing({ target }) : say.insert.anyConflictNothing);
	const inner = { ...c, excluded: true };
	const kids = assignments(inner, oc.do.sets);
	if (oc.where) kids.push(clause(cond(inner, oc.where), (condition) => say.insert.conflictWhere({ condition })));
	return block(e, say.insert.conflictUpdate({ target }), kids);
}

function update(outer: Ctx, s: UpdateStatement): Narrated {
	const c = scopeOf(outer, [{ name: s.table }, ...(s.from ? [s.from] : [])]);
	const { say } = c;
	const items = assignments(c, s.sets);
	if (s.from) items.push(D(say.update.using({ tables: source(c, s.from).name })));
	items.push(s.where ? clause(cond(c, s.where), (condition) => say.select.where({ condition })) : D(say.write.everyRow));
	items.push(...returning(c, s.returning));
	return acting(c, { action: say.update.action({ table: qname(c, s.table) }), items });
}

function remove(outer: Ctx, s: DeleteStatement): Narrated {
	const c = scopeOf(outer, [{ name: s.from }]);
	const { say } = c;
	const items = [s.where ? clause(cond(c, s.where), (condition) => say.select.where({ condition })) : D(say.write.everyRow), ...returning(c, s.returning)];
	return acting(c, { action: say.delete.action({ table: qname(c, s.from) }), items });
}

// ---------- schema and transactions ----------

const REF_ACTIONS: Record<string, RefAction> = { cascade: "cascade", "set null": "setNull", "set default": "setDefault", restrict: "restrict" };
const DROPS: Record<string, DropKind> = {
	"drop table": "table",
	"drop index": "index",
	"drop type": "type",
	"drop sequence": "sequence",
	"drop trigger": "trigger",
};

function reference(c: Ctx, r: TableReference): string[] {
	const sc = c.say.schema;
	const t = qname(c, r.foreignTable);
	const target = r.foreignColumns.length ? c.say.expr.column({ table: t, owner: c.e.g.possessive(t), column: names(c, r.foreignColumns) }) : t;
	const out = [sc.references({ target })];
	const del = r.onDelete && REF_ACTIONS[r.onDelete];
	const upd = r.onUpdate && REF_ACTIONS[r.onUpdate];
	if (del) out.push(sc.onDelete[del]);
	if (upd) out.push(sc.onUpdate[upd]);
	return out;
}

function constraintPhrase(c: Ctx, k: ColumnConstraint): string[] {
	const sc = c.say.schema;
	const named = (s: string) => (k.constraintName ? sc.named({ rule: s, name: code(k.constraintName.name) }) : s);
	switch (k.type) {
		case "primary key":
			return [named(sc.primaryKey)];
		case "unique":
			return [named(sc.unique)];
		case "not null":
			return [sc.required];
		case "null":
			return [sc.optional];
		case "default":
			return [sc.defaultsTo({ value: value(c, k.default) })];
		case "reference":
			return reference(c, k).map(named);
		case "check":
			return [named(sc.check({ condition: test(c, k.expr) }))];
		case "add generated":
			return [k.expression ? sc.generated({ value: value(c, k.expression) }) : sc.identity];
	}
}

function columnDef(c: Ctx, col: CreateColumnDef | CreateColumnsLikeTable): string {
	const sc = c.say.schema;
	if (col.kind === "like table") return sc.likeTable({ table: qname(c, col.like) });
	const details = (col.constraints ?? []).flatMap((k) => constraintPhrase(c, k));
	return sc.column({ name: ident(c, col.name.name), type: sqlType(col.dataType), details: details.join(", ") });
}

function tableConstraint(c: Ctx, k: TableConstraint): string {
	const sc = c.say.schema;
	const rule =
		k.type === "primary key"
			? sc.tablePrimaryKey({ columns: names(c, k.columns) })
			: k.type === "unique"
				? sc.tableUnique({ columns: names(c, k.columns) })
				: k.type === "foreign key"
					? sc.tableForeignKey({ columns: names(c, k.localColumns), target: reference(c, k).join(", ") })
					: k.type === "check"
						? sc.check({ condition: test(c, k.expr) })
						: sc.tableUnique({ columns: names(c, k.columns) });
	return k.constraintName ? sc.named({ rule, name: code(k.constraintName.name) }) : rule;
}

function createTable(c: Ctx, s: CreateTableStatement) {
	const sc = c.say.schema;
	const items = [...s.columns.map((col) => D(columnDef(c, col))), ...(s.constraints ?? []).map((k) => D(tableConstraint(c, k)))];
	return { action: sc.createTable({ table: qname(c, s.name), ifNotExists: !!s.ifNotExists, temporary: !!s.temporary }), items };
}

function createIndex(c: Ctx, s: CreateIndexStatement) {
	const sc = c.say.schema;
	const keys = c.e.g.list(
		s.expressions.map((x) => {
			const v = value(c, x.expression);
			return x.order === "desc" ? c.say.select.desc({ value: v, time: false }) : v;
		}),
	);
	const items: Doc[] = [];
	if (s.concurrently) items.push(D(sc.concurrently));
	if (s.using) items.push(D(sc.indexMethod({ method: code(s.using.name) })));
	if (s.where) items.push(D(sc.partial({ condition: test(c, s.where) })));
	const name = s.indexName ? ident(c, s.indexName.name) : "";
	return { action: sc.createIndex({ name, table: qname(c, s.table), keys, unique: !!s.unique, ifNotExists: !!s.ifNotExists }), items };
}

function alterTable(c: Ctx, s: AlterTableStatement) {
	const sc = c.say.schema;
	const items = s.changes.map((ch): Doc => {
		switch (ch.type) {
			case "add column":
				return D(sc.addColumn({ column: columnDef(c, ch.column), ifNotExists: !!ch.ifNotExists }));
			case "drop column":
				return D(sc.dropColumn({ column: ident(c, ch.column.name), ifExists: !!ch.ifExists }));
			case "rename column":
				return D(sc.renameColumn({ column: ident(c, ch.column.name), to: ident(c, ch.to.name) }));
			case "rename":
				return D(sc.renameTable({ to: ident(c, ch.to.name) }));
			case "rename constraint":
				return D(sc.renameRule({ name: code(ch.constraint.name), to: code(ch.to.name) }));
			case "add constraint":
				return D(sc.addConstraint({ constraint: tableConstraint(c, ch.constraint) }));
			case "drop constraint":
				return D(sc.dropConstraint({ name: code(ch.constraint.name), ifExists: !!ch.ifExists }));
			case "owner":
				return D(sc.owner({ to: code(ch.to.name) }));
			case "alter column": {
				const column = ident(c, ch.column.name);
				const a = ch.alter;
				if (a.type === "set type") return D(sc.setType({ column, type: sqlType(a.dataType) }));
				if (a.type === "set default") return D(sc.setDefault({ column, value: value(c, a.default) }));
				if (a.type === "drop default") return D(sc.dropDefault({ column }));
				if (a.type === "set not null") return D(sc.setRequired({ column }));
				if (a.type === "drop not null") return D(sc.setOptional({ column }));
				return D(sc.column({ name: column, type: "", details: sc.identity }));
			}
		}
	});
	return { action: sc.alterTable({ table: qname(c, s.table) }), items };
}

function schemaStatement(c: Ctx, s: Statement): { action: string; items: Doc[] } {
	const { say, e } = c;
	const sc = say.schema;
	const tx = say.transaction;
	switch (s.type) {
		case "create table":
			return createTable(c, s);
		case "create index":
			return createIndex(c, s);
		case "alter table":
			return alterTable(c, s);
		case "drop table":
		case "drop index":
		case "drop type":
		case "drop sequence":
		case "drop trigger": {
			const d = s as DropStatement;
			const items = d.cascade === "cascade" ? [D(sc.cascade)] : [];
			if (d.concurrently) items.push(D(sc.concurrently));
			return {
				action: sc.drop({ kind: DROPS[s.type]!, names: e.g.list(d.names.map((n) => qname(c, n))), many: d.names.length > 1, ifExists: !!d.ifExists }),
				items,
			};
		}
		case "truncate table": {
			const items = s.identity === "restart" ? [D(sc.restartIdentity)] : [];
			if (s.cascade === "cascade") items.push(D(sc.cascade));
			return { action: sc.truncate({ tables: e.g.list(s.tables.map((t) => qname(c, t))) }), items };
		}
		case "create view":
		case "create materialized view": {
			const q = statement(c, s.query);
			const action = sc.createView({
				name: qname(c, s.name),
				materialized: s.type === "create materialized view",
				orReplace: s.type === "create view" && !!s.orReplace,
			});
			return { action, items: [block(e, sc.showing({ what: q.value }), q.items)] };
		}
		case "refresh materialized view":
			return { action: sc.refreshView({ name: qname(c, s.name) }), items: s.concurrently ? [D(sc.concurrently)] : [] };
		case "create extension":
			return { action: sc.createExtension({ name: code(s.extension.name), ifNotExists: !!s.ifNotExists }), items: [] };
		case "create enum":
			return { action: sc.createEnum({ name: qname(c, s.name), values: e.g.list(s.values.map((v) => mk("l", JSON.stringify(v.value)))) }), items: [] };
		case "create schema":
			return { action: sc.createSchema({ name: code(s.name.name), ifNotExists: !!s.ifNotExists }), items: [] };
		case "begin": {
			const items: Doc[] = [];
			if (s.isolationLevel) items.push(D(tx.isolation({ level: code(s.isolationLevel) })));
			if (s.writeable === "read only") items.push(D(tx.readOnly));
			return { action: tx.begin, items };
		}
		case "start transaction":
			return { action: tx.begin, items: [] };
		case "commit":
			return { action: tx.commit, items: [] };
		case "rollback":
			return { action: tx.rollback, items: [] };
	}
	return { action: say.run.other({ kind: code(s.type) }), items: [] };
}
