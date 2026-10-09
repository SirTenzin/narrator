import { D, type Doc, mk, plain } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import type { ColumnType, DrizzlePhrases, ReferentialAction } from "./phrases";
import {
	type Ctx,
	calleeName,
	chainOf,
	condition,
	entryDoc,
	fnResult,
	isFn,
	isSqlTemplate,
	items,
	keyName,
	listDoc,
	literalString,
	type Step,
	val,
} from "./shared";

const COLUMN_TYPES = new Set<string>([
	"integer",
	"int",
	"smallint",
	"tinyint",
	"mediumint",
	"bigint",
	"serial",
	"smallserial",
	"bigserial",
	"boolean",
	"text",
	"tinytext",
	"mediumtext",
	"longtext",
	"varchar",
	"char",
	"numeric",
	"decimal",
	"real",
	"doublePrecision",
	"double",
	"float",
	"json",
	"jsonb",
	"uuid",
	"timestamp",
	"datetime",
	"date",
	"time",
	"year",
	"interval",
	"blob",
	"bytea",
	"binary",
	"varbinary",
	"inet",
	"cidr",
	"macaddr",
	"point",
	"line",
	"vector",
] satisfies ColumnType[]);

/** Modifiers only Drizzle column builders have, so a chain using one is a column even with an unknown base. */
const COLUMN_ONLY = new Set([
	"notNull",
	"primaryKey",
	"defaultNow",
	"defaultRandom",
	"$defaultFn",
	"$default",
	"$onUpdate",
	"$onUpdateFn",
	"references",
	"$type",
	"generatedAlwaysAsIdentity",
	"generatedByDefaultAsIdentity",
	"generatedAlwaysAs",
	"autoincrement",
]);

const TABLES: Record<string, keyof DrizzlePhrases["schema"]["table"]> = {
	pgTable: "pg",
	mysqlTable: "mysql",
	sqliteTable: "sqlite",
	singlestoreTable: "singlestore",
};

const ACTIONS: Record<string, ReferentialAction> = {
	cascade: "cascade",
	"set null": "setNull",
	"set default": "setDefault",
	restrict: "restrict",
	"no action": "noAction",
};

/** The base call of a column chain: `text("x")` or `t.text("x")`, with the type name. */
function columnBase(root: N): { name: string; args: N[] } | null {
	const r = unwrap(root);
	if (r?.type !== "CallExpression") return null;
	const callee = unwrap(r.callee);
	if (callee.type === "Identifier") return { name: callee.name, args: r.arguments };
	if (callee.type === "MemberExpression" && !callee.computed && unwrap(callee.object).type === "Identifier")
		return { name: callee.property.name, args: r.arguments };
	return null;
}

/** `text("org_id").notNull().references(...)` as `{ type, traits }`, or null when it isn't a column builder. */
function columnParts(c: Ctx, node: N, { key, inTable }: { key: string | null; inTable: boolean }): { type: string; traits: string[] } | null {
	const { e, say } = c;
	const s = say.schema;
	const { root, steps } = chainOf(node);
	const base = columnBase(steps.length ? root : node);
	if (!base) return null;
	const known = COLUMN_TYPES.has(base.name);
	const memberBase = unwrap(unwrap(steps.length ? root : node).callee).type === "MemberExpression";
	const drizzleOnly = steps.some((x) => COLUMN_ONLY.has(x.m));
	if (!inTable && !drizzleOnly && !(known && !memberBase && steps.length)) return null;
	const traits: string[] = [];
	let type = known ? s.types[base.name as ColumnType] : e.lex.humanize(base.name);
	for (const a of base.args) {
		const name = literalString(a);
		if (name !== null) {
			if (!key || e.lex.humanize(name) !== e.lex.humanize(key)) traits.push(s.storedAs({ name: mk("l", `"${name}"`) }));
		} else if (unwrap(a)?.type === "ObjectExpression") traits.push(...columnOptions(c, unwrap(a)));
		else traits.push(val(c, a).t);
	}
	for (const st of steps) {
		if (st.m === "array") type = s.listOf({ type });
		else traits.push(...modifier(c, st));
	}
	return { type, traits };
}

function columnOptions(c: Ctx, o: N): string[] {
	const { e, say } = c;
	const s = say.schema;
	const get = (k: string) => o.properties.find((p: N) => keyName(p) === k)?.value;
	const out: string[] = [];
	for (const p of o.properties) {
		const k = keyName(p);
		const v = unwrap(p.value);
		if (k === "mode") out.push(s.mode({ mode: val(c, v).t }));
		else if (k === "withTimezone") v.value === true && out.push(s.withTimezone);
		else if (k === "length") out.push(s.maxLength({ length: val(c, v).t }));
		else if (k === "precision")
			out.push(get("scale") ? s.precisionScale({ precision: val(c, v).t, scale: val(c, get("scale")).t }) : s.precision({ precision: val(c, v).t }));
		else if (k === "scale") continue;
		else if (k === "dimensions") out.push(s.dimensions({ count: val(c, v).t }));
		else if (k === "enum") out.push(s.oneOf({ values: enumValues(c, v) }));
		else if (k) out.push(s.option({ key: e.prop(k), value: val(c, v).t }));
		else out.push(entryDoc(e, p).t);
	}
	return out;
}

const enumValues = (c: Ctx, v: N) =>
	unwrap(v)?.type === "ArrayExpression"
		? listDoc(
				c.e,
				items(v).map((x) => val(c, x)),
				"or",
			).t
		: val(c, v).t;

const fnValue = (c: Ctx, fn: N) => val(c, isFn(fn) ? (fnResult(fn) ?? fn) : fn).t;

function modifier(c: Ctx, st: Step): string[] {
	const { e, say } = c;
	const s = say.schema;
	const arg = st.args[0];
	switch (st.m) {
		case "primaryKey":
			return [s.primaryKey];
		case "notNull":
			return [s.notNull];
		case "unique":
			return [s.unique];
		case "autoincrement":
			return [s.autoIncrement];
		case "generatedAlwaysAsIdentity":
		case "generatedByDefaultAsIdentity":
			return [s.identity];
		case "default":
			return [s.defaultsTo({ value: val(c, arg).t })];
		case "defaultNow":
			return [s.defaultNow];
		case "defaultRandom":
			return [s.defaultRandom];
		case "$defaultFn":
		case "$default":
			return [s.defaultFn({ value: fnValue(c, arg) })];
		case "$onUpdate":
		case "$onUpdateFn":
			return [s.onUpdate({ value: fnValue(c, arg) })];
		case "generatedAlwaysAs":
			return [s.computedAs({ value: fnValue(c, arg) })];
		case "$type":
			return [];
		case "references": {
			const out = [s.references({ target: fnValue(c, arg) })];
			const o = unwrap(st.args[1]);
			if (o?.type === "ObjectExpression") out.push(...referentialActions(c, o));
			return out;
		}
	}
	return [s.otherModifier({ name: e.lex.humanize(st.m), args: st.args.length ? e.g.list(st.args.map((a) => val(c, a).t)) : "" })];
}

function referentialActions(c: Ctx, o: N): string[] {
	const s = c.say.schema;
	return o.properties.flatMap((p: N) => {
		const k = keyName(p);
		const action = ACTIONS[literalString(p.value) ?? ""];
		if (k === "onDelete" && action) return [s.onTargetDelete[action]];
		if (k === "onUpdate" && action) return [s.onTargetUpdate[action]];
		return k ? [s.option({ key: c.e.prop(k), value: val(c, p.value).t })] : [];
	});
}

/** A `$type<T>()` call's type argument, shown as written. */
function typeArgument(c: Ctx, node: N): string | null {
	const { steps } = chainOf(node);
	let cur = unwrap(node);
	for (let i = steps.length - 1; i >= 0; i--) {
		if (steps[i]!.m === "$type") {
			const params = cur.typeArguments ?? cur.typeParameters;
			const t = params?.params?.[0];
			return t ? mk("t", c.e.code(t), c.e.code(t)) : null;
		}
		cur = unwrap(unwrap(cur.callee).object);
	}
	return null;
}

function columnLine(c: Ctx, p: N): Doc {
	const { e, say } = c;
	if (p.type === "SpreadElement") {
		const v = val(c, p.argument);
		return D(say.schema.columnsFrom({ value: v.t }), v.kids);
	}
	const k = keyName(p);
	if (!k) return entryDoc(e, p);
	const parts = columnParts(c, p.value, { key: k, inTable: true });
	if (!parts) {
		const v = val(c, p.value);
		return D(say.schema.column({ column: e.prop(k), type: v.t, traits: [] }), v.kids);
	}
	const typed = typeArgument(c, p.value);
	return D(say.schema.column({ column: e.prop(k), type: parts.type, traits: typed ? [...parts.traits, say.schema.typedAs({ type: typed })] : parts.traits }));
}

/** `pgTable("users", { ...columns }, (t) => [index(...).on(t.x), ...])`. */
export function tableDoc(c: Ctx, { node, args }: { node: N; args: N[] }): Doc | null {
	const { e, say } = c;
	const dialect = TABLES[calleeName(node) ?? ""];
	const nameNode = args[0];
	if (!dialect || literalString(nameNode) === null) return null;
	let cols = unwrap(args[1]);
	if (isFn(cols)) cols = unwrap(fnResult(cols));
	if (cols?.type !== "ObjectExpression") return null;
	const kids: Doc[] = cols.properties.map((p: N) => columnLine(c, p));
	if (args[2]) kids.push(...extrasOf(c, args[2]));
	return D(
		say.schema.table[dialect]({ name: e.noun(nameNode).t }),
		kids.flatMap((k) => e.bullet(k)),
	);
}

/** `pgTable(...).enableRLS()`. */
export function rlsTableDoc(c: Ctx, { obj }: { obj: N | null }): Doc | null {
	const t = unwrap(obj);
	const table = t?.type === "CallExpression" ? tableDoc(c, { node: t, args: t.arguments }) : null;
	return table && D(table.t, [...table.kids, ...c.e.bullet(D(c.say.schema.rowLevelSecurity))]);
}

function extrasOf(c: Ctx, extras: N): Doc[] {
	const body = isFn(extras) ? unwrap(fnResult(extras)) : unwrap(extras);
	if (!body) return [c.e.noun(extras)];
	const nodes = body.type === "ObjectExpression" ? body.properties.map((p: N) => (p.type === "Property" ? p.value : p)) : items(body);
	return nodes.map((n: N) => constraintDoc(c, n) ?? val(c, n));
}

/** A column inside an index: `t.x`, `t.x.desc()`, `t.x.asc().nullsFirst()`. */
function indexColumn(c: Ctx, n: N): string {
	const { e, say } = c;
	const { root, steps } = chainOf(n);
	const dirs = steps.filter((s) => /^(asc|desc|nullsFirst|nullsLast|op)$/.test(s.m));
	if (!steps.length || dirs.length !== steps.length) return val(c, n).t;
	const column = val(c, root).t;
	const time = e.g.isTimeLike(plain(column));
	return steps.some((s) => s.m === "desc") ? say.order.descending({ column, time }) : say.order.ascending({ column, time });
}

const columnList = (c: Ctx, nodes: N[]) =>
	c.e.g.list(nodes.flatMap((n) => (unwrap(n)?.type === "ArrayExpression" ? items(n) : [n])).map((n) => indexColumn(c, n)));

const nameOf = (c: Ctx, n: N | undefined) => (n && literalString(n) !== null ? c.e.noun(n).t : "");

/** `index("x").on(t.a)`, `unique().on(...)`, `primaryKey({ columns })`, `foreignKey({...}).onDelete(...)`, `check("x", sql)`. */
export function constraintDoc(c: Ctx, node: N): Doc | null {
	const { e, say } = c;
	const s = say.schema;
	const { root, steps } = chainOf(node);
	const base = unwrap(steps.length ? root : node);
	const kind = base?.type === "CallExpression" && unwrap(base.callee).type === "Identifier" ? unwrap(base.callee).name : null;
	if (!kind) return null;
	const baseArgs: N[] = base.arguments;
	const traits: string[] = [];
	let columns = "";
	if (kind === "index" || kind === "uniqueIndex" || kind === "unique") {
		if (!steps.some((x) => x.m === "on" || x.m === "onOnly" || x.m === "using")) return null;
		for (const st of steps) {
			if (st.m === "on" || st.m === "onOnly") columns = columnList(c, st.args);
			else if (st.m === "using") {
				traits.push(s.indexUsing({ method: val(c, st.args[0]).t }));
				if (st.args.length > 1) columns = columnList(c, st.args.slice(1));
			} else if (st.m === "where") traits.push(s.indexWhere({ condition: condition(c, st.args[0]).t }));
			else if (st.m === "concurrently") traits.push(s.concurrently);
			else if (st.m === "nullsNotDistinct") traits.push(s.nullsNotDistinct);
			else traits.push(...modifier(c, st));
		}
		const name = nameOf(c, baseArgs[0]);
		const phrase = kind === "index" ? s.index : kind === "uniqueIndex" ? s.uniqueIndex : s.uniqueConstraint;
		return D(phrase({ name, columns, traits }));
	}
	const o = unwrap(baseArgs[0]);
	const get = (k: string) => (o?.type === "ObjectExpression" ? o.properties.find((p: N) => keyName(p) === k)?.value : undefined);
	if (kind === "primaryKey") {
		if (get("columns")) return D(s.compositeKey({ columns: columnList(c, [get("columns")]), name: nameOf(c, get("name")) }));
		if (!baseArgs.length || o?.type === "ObjectExpression") return null;
		return D(s.compositeKey({ columns: columnList(c, baseArgs), name: "" }));
	}
	if (kind === "foreignKey") {
		if (!get("columns") || !get("foreignColumns")) return null;
		for (const st of steps) {
			const action = ACTIONS[literalString(st.args[0]) ?? ""];
			if (st.m === "onDelete" && action) traits.push(s.onTargetDelete[action]);
			else if (st.m === "onUpdate" && action) traits.push(s.onTargetUpdate[action]);
			else traits.push(...modifier(c, st));
		}
		return D(s.foreignKey({ columns: columnList(c, [get("columns")]), target: columnList(c, [get("foreignColumns")]), name: nameOf(c, get("name")), traits }));
	}
	if (kind === "check" && baseArgs.length === 2 && isSqlTemplate(baseArgs[1])) {
		const w = condition(c, baseArgs[1]);
		return D(s.check({ name: nameOf(c, baseArgs[0]), condition: w.t }), w.kids);
	}
	return null;
}

/** A column builder used outside a table, e.g. a shared `createdAt: timestamp().defaultNow()`. */
export function columnDoc(c: Ctx, { node }: { node: N }): Doc | null {
	const parts = columnParts(c, node, { key: null, inTable: false });
	return parts && D(c.say.schema.columnValue(parts));
}

/** `pgEnum("mood", ["sad", "ok"])`. */
export function enumDoc(c: Ctx, { args }: { args: N[] }): Doc | null {
	if (literalString(args[0]) === null || unwrap(args[1])?.type !== "ArrayExpression") return null;
	return D(c.say.schema.enum.pg({ name: c.e.noun(args[0]).t, values: enumValues(c, args[1]) }));
}

/** `relations(users, ({ one, many }) => ({ posts: many(posts), author: one(users, { fields, references }) }))`. */
export function relationsDoc(c: Ctx, { args }: { args: N[] }): Doc | null {
	const { e, say } = c;
	const fn = unwrap(args[1]);
	const body = isFn(fn) ? unwrap(fnResult(fn)) : null;
	if (!args[0] || body?.type !== "ObjectExpression") return null;
	return D(
		say.schema.relationsOf({ table: val(c, args[0]).t }),
		body.properties.flatMap((p: N) => e.bullet(relationLine(c, p))),
	);
}

/** `defineRelations(schema, (r) => ({ users: { posts: r.many.posts() } }))`. */
export function defineRelationsDoc(c: Ctx, { args }: { args: N[] }): Doc | null {
	const { e, say } = c;
	const fn = unwrap(args[1]);
	const body = isFn(fn) ? unwrap(fnResult(fn)) : null;
	if (body?.type !== "ObjectExpression") return null;
	return D(
		say.schema.relationsAll,
		body.properties.flatMap((t: N) => {
			const k = keyName(t);
			const v = unwrap(t.value);
			if (!k || v?.type !== "ObjectExpression") return e.bullet(entryDoc(e, t));
			return e.bullet(
				D(
					say.schema.relationsOf({ table: e.prop(k) }),
					v.properties.flatMap((p: N) => e.bullet(relationLine(c, p))),
				),
			);
		}),
	);
}

/** One relation: `many(posts)`, `one(users, {...})`, `r.one.users({ from, to })`, `r.many.posts()`. */
function relationLine(c: Ctx, p: N): Doc {
	const { e, say } = c;
	const s = say.schema;
	const k = keyName(p);
	const call = unwrap(p.value);
	if (!k || call?.type !== "CallExpression") return entryDoc(e, p);
	const callee = unwrap(call.callee);
	const name = e.prop(k);
	let kind: string | null = null;
	let table: string | null = null;
	let config: N = null;
	if (callee.type === "Identifier" || (callee.type === "MemberExpression" && /^(one|many)$/.test(callee.property?.name))) {
		kind = callee.type === "Identifier" ? callee.name : callee.property.name;
		table = call.arguments[0] ? val(c, call.arguments[0]).t : null;
		config = call.arguments[1];
	} else if (callee.type === "MemberExpression" && unwrap(callee.object).type === "MemberExpression") {
		kind = unwrap(callee.object).property.name;
		table = e.ref(callee.property.name);
		config = call.arguments[0];
	}
	if ((kind !== "one" && kind !== "many") || !table) return entryDoc(e, p);
	const o = unwrap(config);
	const get = (key: string) => (o?.type === "ObjectExpression" ? o.properties.find((x: N) => keyName(x) === key)?.value : undefined);
	const fields = get("fields") ?? get("from");
	const refs = get("references") ?? get("to");
	const extra =
		o?.type === "ObjectExpression"
			? o.properties
					.filter((x: N) => !["fields", "references", "from", "to"].includes(keyName(x) ?? ""))
					.map((x: N) => (keyName(x) ? s.relationOption({ key: e.prop(keyName(x)!), value: val(c, x.value).t }) : entryDoc(e, x).t))
			: [];
	const line =
		kind === "one" && fields && refs
			? s.oneVia({ name, table, fields: columnList(c, [fields]), references: columnList(c, [refs]) })
			: kind === "one"
				? s.one({ name, table })
				: s.many({ name, table });
	return D(
		line,
		extra.flatMap((x: string) => e.bullet(D(x))),
	);
}
