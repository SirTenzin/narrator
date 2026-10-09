import { D, type Doc, mk, plain } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import type { DrizzlePhrases } from "./phrases";
import { queryDoc } from "./query";
import { type Ctx, calleeName, condition, isSqlTemplate, listDoc, literalString, sqlCode, sqlFragment, val } from "./shared";

type Op = (c: Ctx, args: N[], neg: boolean) => Doc | null;
type Pair = { left: string; right: string };

const pair = (c: Ctx, args: N[], phrase: (p: Pair) => string, left?: Doc): Doc => {
	const a = left ?? val(c, args[0]);
	const b = val(c, args[1]);
	return D(phrase({ left: a.t, right: b.t }), [...a.kids, ...b.kids]);
};

/** Comparison ops by name; negating `gt` gives `lte` and so on, so each maps to a phrase per polarity. */
const ORDERED: Record<string, [keyof DrizzlePhrases["compare"], keyof DrizzlePhrases["compare"]]> = {
	gt: ["moreThan", "atMost"],
	gte: ["atLeast", "lessThan"],
	lt: ["lessThan", "atLeast"],
	lte: ["atMost", "moreThan"],
};

/** A comparison by Drizzle operator name (also the relational `where` keys); `left` replaces a rendered first argument. */
export function compareOp(c: Ctx, op: string, args: N[], neg: boolean, left?: Doc): Doc | null {
	const cmp = c.say.compare;
	if (op === "eq" || op === "ne") return pair(c, args, (p) => cmp.equal({ ...p, neg: neg !== (op === "ne") }), left);
	if (ORDERED[op]) return pair(c, args, (p) => (cmp[ORDERED[op]![neg ? 1 : 0]] as (p: Pair) => string)(p), left);
	if (op === "inArray" || op === "in" || op === "notInArray" || op === "notIn")
		return pair(c, args, (p) => cmp.in({ ...p, neg: neg !== op.startsWith("not") }), left);
	if (op === "isNull" || op === "isNotNull") return D(cmp.empty({ value: left?.t ?? c.e.text(args[0]), neg: neg !== (op === "isNotNull") }));
	if (op === "between" || op === "notBetween") {
		const [v, lo, hi] = [left ?? val(c, args[0]), val(c, args[1]), val(c, args[2])];
		return D(cmp.between({ value: v.t, low: lo.t, high: hi.t, neg: neg !== (op === "notBetween") }), [...v.kids, ...lo.kids, ...hi.kids]);
	}
	if (/^(not)?[iI]?[lL]ike$/.test(op)) return patternDoc(c, args, neg !== op.startsWith("not"), op === "ilike" || op === "notIlike", left);
	if (op === "arrayContains" || op === "arrayContained" || op === "arrayOverlaps") {
		const kind = ({ arrayContains: "containsAll", arrayContained: "within", arrayOverlaps: "overlaps" } as const)[op];
		const a = left ?? val(c, args[0]);
		const b = val(c, args[1]);
		return D(c.say.array[kind]({ value: a.t, items: b.t, neg }), [...a.kids, ...b.kids]);
	}
	return null;
}

/** `like(col, "%x%")` reads as "contains"; anything that isn't a plain affix pattern stays a pattern. */
function patternDoc(c: Ctx, args: N[], neg: boolean, ignoreCase: boolean, left?: Doc): Doc {
	const value = left ?? val(c, args[0]);
	const p = unwrap(args[1]);
	const shape = patternShape(c, p);
	if (shape) return D(c.say.pattern[shape.kind]({ value: value.t, text: shape.text, neg, ignoreCase }), value.kids);
	const pattern = val(c, p);
	return D(c.say.pattern.matches({ value: value.t, pattern: pattern.t, neg, ignoreCase }), [...value.kids, ...pattern.kids]);
}

const WILD = /[%_\\]/;

function patternShape(c: Ctx, p: N): { kind: "contains" | "startsWith" | "endsWith"; text: string } | null {
	const kindOf = (lead: boolean, trail: boolean) => (lead && trail ? "contains" : trail ? "startsWith" : lead ? "endsWith" : null);
	const s = literalString(p);
	if (s !== null) {
		const kind = kindOf(s.startsWith("%"), s.endsWith("%") && s.length > 1);
		const inner = s.replace(/^%/, "").replace(/%$/, "");
		if (!kind || !inner || WILD.test(inner)) return null;
		return { kind, text: mk("l", `"${inner}"`) };
	}
	if (p?.type !== "TemplateLiteral" || p.expressions.length !== 1) return null;
	const [head, tail] = p.quasis.map((q: N) => q.value.cooked as string);
	const kind = kindOf(head === "%", tail === "%");
	if (!kind || (head !== "" && head !== "%") || (tail !== "" && tail !== "%")) return null;
	return { kind, text: c.e.text(p.expressions[0]) };
}

function logic(isAnd: boolean): Op {
	return (c, args, neg) => {
		const items: Doc[] = args.filter(Boolean).map((a: N) => {
			if (a.type !== "SpreadElement") return condition(c, a, neg);
			const list = c.e.noun(a.argument);
			return D(c.say.logic[isAnd ? "allIn" : "anyIn"]({ list: list.t, neg }), list.kids);
		});
		const and = isAnd !== neg;
		if (items.length === 1) return items[0]!;
		return D(
			and ? c.say.logic.all : c.say.logic.any,
			items.flatMap((i) => c.e.bullet(i)),
		);
	};
}

function existsOp(negated: boolean): Op {
	return (c, args, neg) => {
		const q = queryDoc(c, args[0]);
		if (q) return D(c.say.exists.lookup({ query: q.t.replace(/:$/, ""), neg: neg !== negated }), q.kids);
		if (!["Identifier", "MemberExpression"].includes(unwrap(args[0])?.type)) return null;
		const v = val(c, args[0]);
		return D(c.say.exists.rows({ query: v.t, neg: neg !== negated }), v.kids);
	};
}

const COMPARE_OPS = [
	"eq",
	"ne",
	"gt",
	"gte",
	"lt",
	"lte",
	"inArray",
	"notInArray",
	"isNull",
	"isNotNull",
	"between",
	"notBetween",
	"like",
	"notLike",
	"ilike",
	"notIlike",
	"arrayContains",
	"arrayContained",
	"arrayOverlaps",
];

const OPS: Record<string, Op> = {
	...Object.fromEntries(COMPARE_OPS.map((op) => [op, ((c, args, neg) => compareOp(c, op, args, neg)) as Op])),
	and: logic(true),
	or: logic(false),
	not: (c, args, neg) => condition(c, args[0], !neg),
	exists: existsOp(false),
	notExists: existsOp(true),
};

const asc = (ascending: boolean) => (c: Ctx, args: N[]) => {
	if (args.length !== 1) return null;
	const col = val(c, args[0]);
	const time = c.e.g.isTimeLike(plain(col.t));
	return D(c.say.order[ascending ? "ascending" : "descending"]({ column: col.t, time }), col.kids);
};

/** `count()`, `sum(col)`, ...: only claimed with a column-like argument, since the names are common. */
const aggregate = (name: keyof DrizzlePhrases["aggregate"]) => (c: Ctx, args: N[], node: N) => {
	if (c.e.localFns.has(calleeName(node) ?? "")) return null;
	if (name === "count" && !args.length) return D(c.say.aggregate.countRows);
	const arg = unwrap(args[0]);
	if (args.length !== 1 || (arg.type !== "MemberExpression" && !isSqlTemplate(arg))) return null;
	const col = val(c, arg);
	return D((c.say.aggregate[name] as (p: { column: string }) => string)({ column: col.t }), col.kids);
};

type CallFn = (c: Ctx, args: N[], node: N) => Doc | null;

const sqlCalls: Record<string, CallFn> = {
	"sql.raw": (c, args) => {
		const t = unwrap(args[0]);
		if (t?.type === "TemplateLiteral") return D(c.say.sql.fragment({ sql: mk("c", c.e.code(t).slice(1, -1).replace(/\s+/g, " ").trim()) }));
		const s = literalString(args[0]);
		if (s !== null) return D(s.trim() ? c.say.sql.fragment({ sql: mk("c", s.replace(/\s+/g, " ").trim()) }) : c.say.sql.empty);
		const v = val(c, args[0]);
		return D(c.say.sql.rawFrom({ value: v.t }), v.kids);
	},
	"sql.join": (c, args) => {
		const parts = val(c, args[0]);
		if (!args[1]) return D(c.say.sql.joined({ parts: parts.t }), parts.kids);
		const sep = isSqlTemplate(args[1]) ? mk("l", `"${c.e.code(unwrap(args[1]).quasi).slice(1, -1)}"`) : val(c, args[1]).t;
		return D(c.say.sql.joinedWith({ parts: parts.t, separator: sep }), parts.kids);
	},
	"sql.placeholder": (c, args) => D(c.say.sql.placeholder({ name: val(c, args[0]).t })),
	"sql.identifier": (c, args) => D(c.say.sql.identifier({ name: val(c, args[0]).t })),
	"sql.empty": (c) => D(c.say.sql.empty),
	getTableColumns: (c, args) => D(c.say.table.allColumns({ table: c.e.text(args[0]) })),
	getTableName: (c, args) => D(c.say.table.name({ table: c.e.text(args[0]) })),
	asc: asc(true),
	desc: asc(false),
	count: aggregate("count"),
	countDistinct: aggregate("countDistinct"),
	sum: aggregate("sum"),
	sumDistinct: aggregate("sumDistinct"),
	avg: aggregate("avg"),
	avgDistinct: aggregate("avgDistinct"),
	min: aggregate("min"),
	max: aggregate("max"),
};

/** `sql\`...\`.as("x")` / `.mapWith(Number)`: decorations on a SQL fragment. */
export function sqlMethod(c: Ctx, node: N, obj: N | null, args: N[]): Doc | null {
	if (!obj || !isSqlTemplate(obj)) return null;
	const frag = sqlFragment(c, obj);
	const m = calleeName(node);
	if (m === "as") return D(c.say.sql.named({ value: frag.t, name: val(c, args[0]).t }));
	if (m === "mapWith") return D(c.say.sql.mappedWith({ value: frag.t, mapper: val(c, args[0]).t }));
	return null;
}

export const operatorCalls = Object.fromEntries([
	...Object.entries(OPS).map(([k, op]) => [k, (c: Ctx, args: N[]) => op(c, args, false)] as const),
	...["exists", "notExists"].map(
		(k) =>
			[
				k,
				(c: Ctx, args: N[]) => {
					const d = OPS[k]!(c, args, false);
					return d && D(c.say.exists.whether({ condition: d.t }), d.kids);
				},
			] as const,
	),
	...Object.entries(sqlCalls),
]) as Record<string, CallFn>;

export const operatorConds = OPS;
