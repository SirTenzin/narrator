import { D, type Doc, mk, plain, vlen } from "@usenarrator/core";
import type { Engine } from "@usenarrator/lang-ts";
import type { Expr, ExprBinary, ExprCall, From, Name, OrderByStatement, QName, SelectStatement, Statement } from "pgsql-ast-parser";
import type { SqlPhrases } from "./phrases";
import type { Param } from "./source";

/** A narrated statement: its imperative form, its noun form, and the clauses under it. */
export type Narrated = { action: string; value: string; items: Doc[] };

export type Ctx = {
	e: Engine;
	say: SqlPhrases;
	params: Map<string, Param>;
	labels: Map<string, string>;
	/** Table alias -> table name, for the query being narrated and those around it. */
	aliases: Map<string, string>;
	/** Inside ON CONFLICT DO UPDATE, where `excluded.x` is the row being inserted. */
	excluded?: boolean;
	/** Renders a nested query (set by the statement module to avoid a circular import). */
	query: (c: Ctx, s: Statement) => Narrated;
};

const code = (s: string) => mk("c", s);
const lit = (s: string) => mk("l", s);
const isSelect = (x: { type: string }) => ["select", "union", "union all", "values", "with", "with recursive"].includes(x.type);

/** Block lines under a heading, one bullet per item. */
export const block = (e: Engine, head: string, items: Doc[]): Doc =>
	D(
		head,
		items.flatMap((i) => e.bullet(i)),
	);

/** A doc squeezed onto one line, for queries nested inside an expression. */
export const flat = (d: Doc): string => [d.t.replace(/:$/, ""), ...d.kids.map((k) => k.text.replace(/^•\s*/, "").replace(/:$/, ""))].join(", ");

/** A nested query's noun phrase followed by its clauses, all on one line. */
export const inlineQuery = (c: Ctx, s: Statement): string => {
	const n = c.query(c, s);
	return [n.value, ...n.items.map(flat)].join(", ");
};

/** A name from the SQL (table, column, alias); interpolated names map back to their JS value. */
export function ident(c: Ctx, name: string): string {
	const p = c.params.get(name);
	return p ? p() : code(name);
}

export const qname = (c: Ctx, q: QName): string => (q.schema ? code(`${q.schema}.${q.name}`) : ident(c, q.name));
export const names = (c: Ctx, ns: Name[]): string => c.e.g.list(ns.map((n) => ident(c, n.name)));

function param(c: Ctx, name: string): string {
	const p = c.params.get(name);
	return p ? p() : c.say.run.unbound({ name: code(c.labels.get(name) ?? name) });
}

function column(c: Ctx, table: QName | undefined, name: string): string {
	if (!table) return name === "*" ? c.say.select.all : ident(c, name);
	if (table.name === "excluded" && c.excluded) return c.say.insert.incoming({ column: ident(c, name) });
	const t = c.aliases.has(table.name) ? code(c.aliases.get(table.name)!) : qname(c, table);
	if (name === "*") return c.say.select.allOf({ table: t });
	return c.say.expr.column({ table: t, owner: c.e.g.possessive(t), column: ident(c, name) });
}

const typeName = (t: { kind?: string; name?: string; schema?: string; config?: number[]; arrayOf?: unknown }): string => {
	if (t.kind === "array") return `${typeName(t.arrayOf as typeof t)}[]`;
	const base = t.schema ? `${t.schema}.${t.name}` : (t.name ?? "");
	return t.config?.length ? `${base}(${t.config.join(", ")})` : base;
};
export const sqlType = (t: Parameters<typeof typeName>[0]) => code(typeName(t));

/** A SQL expression as a noun phrase. */
export function value(c: Ctx, x: Expr): string {
	const { say, e } = c;
	switch (x.type) {
		case "ref":
			return column(c, x.table, x.name);
		case "parameter":
			return param(c, x.name);
		case "string":
			return lit(JSON.stringify(x.value));
		case "integer":
		case "numeric":
		case "boolean":
			return lit(String(x.value));
		case "constant":
			return lit(String(x.value));
		case "null":
			return say.expr.null;
		case "default":
			return say.expr.default;
		case "keyword":
			if (["current_timestamp", "localtimestamp", "current_time", "localtime"].includes(x.keyword)) return say.fn.now;
			if (x.keyword === "current_date") return say.fn.today;
			if (["current_user", "session_user", "user", "current_role"].includes(x.keyword)) return say.fn.currentUser;
			return code(x.keyword);
		case "list":
			return say.expr.list({ items: e.g.list(x.expressions.map((i) => value(c, i))) });
		case "array":
			return say.array.literal({ items: e.g.list(x.expressions.map((i) => value(c, i))) });
		case "array select":
			return say.array.fromQuery({ query: inlineQuery(c, x.select) });
		case "member": {
			const text = x.op === "->>";
			const of = value(c, x.operand);
			if (typeof x.member === "number") return say.json.item({ value: of, position: e.g.formatNumber(x.member + 1), text });
			return say.json.field({ value: of, key: lit(x.member), text });
		}
		case "arrayIndex":
			return say.json.item({ value: value(c, x.array), position: value(c, x.index), text: false });
		case "cast":
			if (x.operand.type === "parameter") return value(c, x.operand);
			if (x.operand.type === "string" && x.to.kind !== "array" && x.to.name === "interval") return say.fn.interval({ value: lit(x.operand.value) });
			return say.expr.cast({ value: value(c, x.operand), type: sqlType(x.to) });
		case "case": {
			const subject = x.value;
			const branches = x.whens.map((w) =>
				say.expr.when({
					value: value(c, w.value),
					condition: subject ? say.compare.equal({ left: value(c, subject), right: value(c, w.when), neg: false }) : test(c, w.when),
				}),
			);
			return say.expr.case({ branches: branches.join(", "), otherwise: x.else ? value(c, x.else) : say.expr.null });
		}
		case "unary":
			if (x.op === "-") return say.expr.negative({ value: value(c, x.operand) });
			if (x.op === "+") return value(c, x.operand);
			return test(c, x);
		case "binary":
			return binaryValue(c, x);
		case "ternary":
			return test(c, x);
		case "call":
			return callValue(c, x);
		case "extract":
			return say.fn.part({ value: value(c, x.from), unit: code(x.field.name) });
		case "substring":
		case "overlay":
			return say.expr.call({
				name: code(x.type),
				args: [x.value, x.type === "overlay" ? x.placing : null, x.from, x.for].flatMap((a) => (a ? [value(c, a)] : [])).join(", "),
			});
		default:
			return isSelect(x) ? say.expr.subquery({ query: inlineQuery(c, x as SelectStatement) }) : code(x.type);
	}
}

const ARITHMETIC: Partial<Record<string, keyof SqlPhrases["expr"]>> = {
	"+": "plus",
	"-": "minus",
	"*": "times",
	"/": "dividedBy",
	"%": "remainder",
	"||": "concat",
};

function binaryValue(c: Ctx, x: ExprBinary): string {
	const { say } = c;
	const arith = ARITHMETIC[x.op];
	if (arith) return (say.expr[arith] as (p: { left: string; right: string }) => string)({ left: value(c, x.left), right: value(c, x.right) });
	if (x.op === "#>>" || (x.op as string) === "#>") return say.json.path({ value: value(c, x.left), path: value(c, x.right), text: x.op === "#>>" });
	if (x.op === "#-") return say.json.withoutPath({ value: value(c, x.left), path: value(c, x.right) });
	if (x.op === "AT TIME ZONE") return say.expr.atTimeZone({ value: value(c, x.left), zone: value(c, x.right) });
	return test(c, x);
}

const fnName = (x: ExprCall) => x.function.name.toLowerCase();

function callValue(c: Ctx, x: ExprCall): string {
	const v = baseCall(c, x);
	const { say, e } = c;
	let out = v;
	if (x.orderBy?.length) out = say.fn.sorted({ value: out, order: orderKeys(c, x.orderBy) });
	if (x.filter) out = say.fn.filtered({ value: out, condition: test(c, x.filter) });
	if (x.over) {
		const partition = x.over.partitionBy?.length ? e.g.list(x.over.partitionBy.map((p) => value(c, p))) : "";
		const order = x.over.orderBy?.length ? orderKeys(c, x.over.orderBy) : "";
		out = say.fn.window({ value: out, partition, order });
	}
	return out;
}

function baseCall(c: Ctx, x: ExprCall): string {
	const { say, e } = c;
	const f = say.fn;
	const a = x.args;
	const arg = (i: number) => value(c, a[i]!);
	const all = () => e.g.list(a.map((y) => value(c, y)));
	const distinct = x.distinct === "distinct";
	switch (fnName(x)) {
		case "count":
			if (!a.length || (a[0]!.type === "ref" && a[0]!.name === "*" && !a[0]!.table)) return f.countRows;
			return (distinct ? f.countDistinct : f.count)({ value: arg(0) });
		case "sum":
			return f.sum({ value: arg(0) });
		case "avg":
			return f.average({ value: arg(0) });
		case "min":
			return f.min({ value: arg(0) });
		case "max":
			return f.max({ value: arg(0) });
		case "array_agg":
			return (distinct ? f.listOfDistinct : f.listOf)({ value: arg(0) });
		case "string_agg":
		case "group_concat":
			return a.length > 1 ? f.joinedWith({ value: arg(0), separator: arg(1) }) : f.listOf({ value: arg(0) });
		case "json_agg":
		case "jsonb_agg":
			return say.json.list({ value: arg(0) });
		case "json_build_object":
		case "jsonb_build_object":
		case "json_object": {
			const entries: string[] = [];
			for (let i = 0; i + 1 < a.length; i += 2) {
				const k = a[i]!;
				entries.push(say.expr.labeled({ key: k.type === "string" ? code(k.value) : value(c, k), value: arg(i + 1) }));
			}
			return say.json.object({ entries: e.g.list(entries) });
		}
		case "json_build_array":
		case "jsonb_build_array":
			return say.json.array({ items: all() });
		case "coalesce":
		case "ifnull":
			return a.length === 2 ? f.coalesce({ value: arg(0), fallback: arg(1) }) : f.firstSet({ values: all() });
		case "nullif":
			return f.nullIf({ value: arg(0), other: arg(1) });
		case "greatest":
			return f.greatest({ values: all() });
		case "least":
			return f.least({ values: all() });
		case "now":
		case "current_timestamp":
		case "transaction_timestamp":
		case "statement_timestamp":
		case "clock_timestamp":
		case "localtimestamp":
			return f.now;
		case "gen_random_uuid":
		case "uuid_generate_v4":
		case "uuidv4":
		case "uuidv7":
			return f.randomId;
		case "random":
			return f.random;
		case "lower":
			return f.lower({ value: arg(0) });
		case "upper":
			return f.upper({ value: arg(0) });
		case "trim":
		case "btrim":
			return f.trim({ value: arg(0) });
		case "length":
		case "char_length":
			return f.length({ value: arg(0) });
		case "abs":
			return f.abs({ value: arg(0) });
		case "round":
			return a.length > 1 ? f.roundTo({ value: arg(0), digits: arg(1) }) : f.round({ value: arg(0) });
		case "ceil":
		case "ceiling":
			return f.ceil({ value: arg(0) });
		case "floor":
			return f.floor({ value: arg(0) });
		case "concat":
			return f.concat({ values: all() });
		case "date_trunc":
			return f.dateTrunc({ value: arg(1), unit: unitOf(c, a[0]!) });
		case "date_part":
			return f.part({ value: arg(1), unit: unitOf(c, a[0]!) });
		case "unnest":
			return say.array.items({ value: arg(0) });
		case "array_length":
		case "cardinality":
			return say.array.length({ value: arg(0) });
		case "generate_series":
			return f.series({ from: arg(0), to: arg(1) });
		case "row_number":
			return f.rowNumber;
		case "rank":
			return f.rank;
		case "dense_rank":
			return f.denseRank;
		case "lag":
			return f.previous({ value: arg(0) });
		case "lead":
			return f.next({ value: arg(0) });
		case "first_value":
			return f.firstValue({ value: arg(0) });
		case "last_value":
			return f.lastValue({ value: arg(0) });
		case "exists":
			return say.expr.whether({ condition: test(c, x) });
		case "any":
			return say.array.items({ value: arg(0) });
	}
	const name = x.function.schema ? `${x.function.schema}.${x.function.name}` : x.function.name;
	return say.expr.call({ name: code(name), args: a.map((y) => value(c, y)).join(", ") });
}

/** `date_trunc('day', ...)`: the unit as a bare word when it's a literal. */
const unitOf = (c: Ctx, x: Expr) => (x.type === "string" ? code(x.value) : value(c, x));

export function orderKeys(c: Ctx, keys: OrderByStatement[]): string {
	const { say, e } = c;
	return e.g.list(
		keys.map((k) => {
			const v = k.by.type === "integer" ? say.select.position({ position: e.g.formatNumber(k.by.value) }) : value(c, k.by);
			const time = e.g.isTimeLike(plain(v).replace(/_/g, " "));
			const dir = k.order === "DESC" ? say.select.desc({ value: v, time }) : k.order === "ASC" ? say.select.asc({ value: v, time }) : v;
			if (k.nulls === "FIRST") return say.select.nullsFirst({ key: dir });
			if (k.nulls === "LAST") return say.select.nullsLast({ key: dir });
			return dir;
		}),
	);
}

const NEGATED: Record<string, string> = { ">": "<=", ">=": "<", "<": ">=", "<=": ">" };
const RELATION: Record<string, keyof SqlPhrases["compare"]> = { ">": "moreThan", ">=": "atLeast", "<": "lessThan", "<=": "atMost" };

const isLogic = (x: Expr): x is ExprBinary => x.type === "binary" && (x.op === "AND" || x.op === "OR");
const operands = (x: Expr, op: string): Expr[] => (x.type === "binary" && x.op === op ? [...operands(x.left, op), ...operands(x.right, op)] : [x]);

/** A condition: AND/OR of three or more parts (or nested logic) becomes a bulleted block. */
export function cond(c: Ctx, x: Expr, neg = false): Doc {
	if (!isLogic(x)) {
		if (x.type === "unary" && x.op === "NOT" && isLogic(x.operand)) return cond(c, x.operand, !neg);
		return D(test(c, x, neg));
	}
	const parts = operands(x, x.op);
	const and = (x.op === "AND") !== neg;
	if (parts.length < 3 && !parts.some(isLogic) && !parts.some(hasSubquery)) return D(test(c, x, neg));
	const docs = parts.map((p) => cond(c, p, neg));
	return block(c.e, and ? c.say.compare.all : c.say.compare.any, docs);
}

/** A condition on one line; `neg` asks for its opposite. */
export function test(c: Ctx, x: Expr, neg = false): string {
	const { say, e } = c;
	const cmp = say.compare;
	switch (x.type) {
		case "binary":
			return binaryTest(c, x, neg);
		case "unary":
			switch (x.op) {
				case "NOT":
					return test(c, x.operand, !neg);
				case "IS NULL":
				case "IS NOT NULL":
					return cmp.empty({ value: value(c, x.operand), neg: neg !== (x.op === "IS NOT NULL") });
				case "IS TRUE":
				case "IS NOT TRUE":
					return cmp.isTrue({ value: value(c, x.operand), neg: neg !== (x.op === "IS NOT TRUE") });
				case "IS FALSE":
				case "IS NOT FALSE":
					return cmp.isFalse({ value: value(c, x.operand), neg: neg !== (x.op === "IS NOT FALSE") });
			}
			break;
		case "ternary":
			return cmp.between({ value: value(c, x.value), low: value(c, x.lo), high: value(c, x.hi), neg: neg !== (x.op === "NOT BETWEEN") });
		case "call":
			if (fnName(x) === "exists" && x.args[0] && isSelect(x.args[0])) return existsTest(c, x.args[0] as SelectStatement, neg);
			break;
		case "ref":
			return cmp.isTrue({ value: value(c, x), neg });
		case "boolean":
			return lit(String(x.value !== neg));
	}
	const v = value(c, x);
	return neg ? cmp.not({ condition: v }) : v;
}

/** `exists (select 1 from users where ...)`: the rows, not the selected columns. */
function existsTest(c: Ctx, s: SelectStatement, neg: boolean): string {
	const simple = s.type === "select" && s.from?.length === 1 && s.from[0]!.type === "table" && !s.groupBy?.length && !s.having;
	if (!simple) return c.say.compare.exists({ source: inlineQuery(c, s), condition: "", neg });
	const inner = scopeOf(c, s.from!);
	const f = s.from![0]! as Extract<From, { type: "table" }>;
	return c.say.compare.exists({ source: qname(inner, f.name), condition: s.where ? test(inner, s.where) : "", neg });
}

/** A condition that holds a subquery reads better on its own bullet. */
const hasSubquery = (x: Expr): boolean =>
	(x.type === "call" && ["exists", "any", "all", "some"].includes(fnName(x)) && !!x.args[0] && isSelect(x.args[0])) ||
	(x.type === "binary" && (isSelect(x.right) || hasSubquery(x.left) || hasSubquery(x.right))) ||
	(x.type === "unary" && hasSubquery(x.operand));

function binaryTest(c: Ctx, x: ExprBinary, neg: boolean): string {
	const { say, e } = c;
	const cmp = say.compare;
	const L = () => value(c, x.left);
	const R = () => value(c, x.right);
	switch (x.op) {
		case "AND":
		case "OR": {
			const and = (x.op === "AND") !== neg;
			return e.g.list(
				operands(x, x.op).map((p) => test(c, p, neg)),
				and ? "and" : "or",
			);
		}
		case "=":
		case "!=": {
			const n = neg !== (x.op === "!=");
			const r = x.right;
			if (r.type === "call" && ["any", "some", "all"].includes(fnName(r)) && r.args[0]) {
				const list = r.args[0];
				const items = isSelect(list) ? null : value(c, list);
				if (items === null) return cmp.among({ value: L(), query: inlineQuery(c, list as SelectStatement), neg: n !== (fnName(r) === "all") });
				return cmp.oneOf({ value: L(), list: items, neg: fnName(r) === "all" ? !n : n });
			}
			if (r.type === "null") return cmp.empty({ value: L(), neg: n });
			return cmp.equal({ left: L(), right: R(), neg: n });
		}
		case ">":
		case ">=":
		case "<":
		case "<=": {
			const op = neg ? NEGATED[x.op]! : x.op;
			return (cmp[RELATION[op]!] as (p: { left: string; right: string }) => string)({ left: L(), right: R() });
		}
		case "IN":
		case "NOT IN": {
			const n = neg !== (x.op === "NOT IN");
			if (isSelect(x.right)) return cmp.among({ value: L(), query: inlineQuery(c, x.right as SelectStatement), neg: n });
			const items = x.right.type === "list" ? x.right.expressions.map((i) => value(c, i)) : [R()];
			return cmp.oneOf({ value: L(), list: e.g.list(items, "or"), neg: n });
		}
		case "LIKE":
		case "NOT LIKE":
		case "ILIKE":
		case "NOT ILIKE":
			return likeTest(c, x, neg !== x.op.startsWith("NOT"), x.op.includes("ILIKE"));
		case "~":
		case "~*":
		case "!~":
		case "!~*":
			return cmp.regex({ value: L(), pattern: R(), neg: neg !== x.op.startsWith("!"), ignoreCase: x.op.endsWith("*") });
		case "@>":
			return say.json.contains({ left: L(), right: R(), neg });
		case "<@":
			return say.json.containedIn({ left: L(), right: R(), neg });
		case "?":
			return say.json.hasKey({ value: L(), key: R(), neg });
		case "&&":
			return say.array.overlaps({ left: L(), right: R(), neg });
	}
	const v = binaryOrOperator(c, x);
	return neg ? cmp.not({ condition: v }) : v;
}

function binaryOrOperator(c: Ctx, x: ExprBinary): string {
	const { say } = c;
	if (x.op === "?|") return say.json.hasAnyKey({ value: value(c, x.left), keys: value(c, x.right) });
	if (x.op === "?&") return say.json.hasAllKeys({ value: value(c, x.left), keys: value(c, x.right) });
	if (ARITHMETIC[x.op] || ["#>>", "#>", "#-", "AT TIME ZONE"].includes(x.op)) return binaryValue(c, x);
	return say.expr.operator({ left: value(c, x.left), op: code(x.op), right: value(c, x.right) });
}

/** LIKE with `'%x%'`, `'x%'`, or `'%' || $1 || '%'` reads as contains / starts with / ends with. */
function likeTest(c: Ctx, x: ExprBinary, neg: boolean, ignoreCase: boolean): string {
	const cmp = c.say.compare;
	const v = value(c, x.left);
	const parts = operands(x.right, "||");
	const pct = (p: Expr | undefined) => p?.type === "string" && p.value === "%";
	const plainText = (s: string) => !/[%_\\]/.test(s);
	let mode: "contains" | "startsWith" | "endsWith" | null = null;
	let text = "";
	if (parts.length === 1 && x.right.type === "string") {
		const m = /^(%?)(.*?)(%?)$/s.exec(x.right.value)!;
		if (plainText(m[2]!) && m[2]) {
			mode = m[1] && m[3] ? "contains" : m[3] ? "startsWith" : m[1] ? "endsWith" : null;
			text = lit(JSON.stringify(m[2]));
		}
	} else if (parts.length >= 2) {
		const first = pct(parts[0]);
		const last = pct(parts.at(-1));
		const middle = parts.slice(first ? 1 : 0, last ? -1 : undefined);
		if ((first || last) && middle.length === 1 && middle[0]!.type !== "string") {
			mode = first && last ? "contains" : last ? "startsWith" : "endsWith";
			text = value(c, middle[0]!);
		}
	}
	if (mode) return cmp[mode]({ value: v, text, neg, ignoreCase });
	return cmp.like({ value: v, pattern: value(c, x.right), neg, ignoreCase });
}

/** Columns of a select list, each with its alias. */
export function columnList(c: Ctx, cols: { expr: Expr; alias?: Name }[]): string[] {
	return cols.map((col) => {
		const v = value(c, col.expr);
		return col.alias ? c.say.expr.labeled({ key: code(col.alias.name), value: v }) : v;
	});
}

/** Whether a list of rendered columns is short enough to sit in a sentence. */
export const fitsInline = (items: string[]) => items.length <= 3 && vlen(items.join(", ")) <= 70;

/** Alias -> table for a FROM list, skipping tables that appear twice (their aliases tell them apart). */
export function scopeOf(c: Ctx, from: (From | { name: QName & { alias?: string } })[]): Ctx {
	const tables = from.flatMap((f) => ("type" in f && f.type !== "table" ? [] : [(f as { name: QName & { alias?: string } }).name]));
	const counts = new Map<string, number>();
	for (const t of tables) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
	const aliases = new Map(c.aliases);
	for (const t of tables) if (t.alias && counts.get(t.name) === 1 && !c.params.has(t.name)) aliases.set(t.alias, t.name);
	return { ...c, aliases };
}
