import { D, type Doc, mk, plain } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { queryDoc } from "./query";
import { type Ctx, chainOf, ebMethodName, fnResult, inside, isEb, isFn, items, keyName, listDoc, literalString, refText } from "./shared";

/** A column position: a string is a column name; anything else is an expression. */
export function refDoc(c: Ctx, n: N): Doc {
	const s = literalString(n);
	if (s !== null) return D(refText(c, s));
	return exprDoc(c, n);
}

/** A value position: plain values read as values; expression-builder calls and subqueries are read in full. */
export function valDoc(c: Ctx, n: N): Doc {
	return exprDoc(c, n);
}

const AGGREGATES = new Set(["count", "countDistinct", "sum", "avg", "min", "max"]);

/** An expression: `eb.ref(...)`, `eb.fn.count(...)`, a subquery, `x.as("name")`, or whatever the engine makes of it. */
export function exprDoc(c: Ctx, n: N): Doc {
	const { e, say } = c;
	const u = unwrap(n);
	if (u?.type === "CallExpression") {
		const callee = unwrap(u.callee);
		if (isEb(c, callee)) return condDoc(c, u, false);
		const bound = ebMethodName(c, callee);
		if (bound) return ebMethod(c, bound, u.arguments) ?? fnDoc(c, bound, u.arguments) ?? e.noun(u);
		if (callee?.type === "MemberExpression" && !callee.computed && unwrap(callee.object)?.type === "Identifier" && unwrap(callee.object).name === "sql") {
			const m = callee.property.name;
			if (m === "lit" || m === "val") return e.noun(u.arguments[0]);
			if (m === "ref" || m === "id" || m === "table") return refDoc(c, u.arguments[0]);
		}
		if (callee?.type === "MemberExpression" && !callee.computed) {
			const m = callee.property.name;
			const owner = unwrap(callee.object);
			if (m === "as" && u.arguments.length === 1) {
				const inner = exprDoc(c, owner);
				const name = literalString(u.arguments[0]);
				return D(say.value.named({ value: inner.t, name: name !== null ? mk("v", e.lex.humanize(name), name) : e.text(u.arguments[0]) }), inner.kids);
			}
			const q = queryDoc(c, u);
			if (q) return D(say.value.subquery({ query: q.t }), q.kids);
			if (isEb(c, owner)) return ebMethod(c, m, u.arguments) ?? e.noun(u);
			if (ebMethodName(c, owner) === "fn") return fnDoc(c, m, u.arguments) ?? e.noun(u);
			if (owner?.type === "MemberExpression" && !owner.computed && owner.property.name === "fn" && isEb(c, owner.object))
				return fnDoc(c, m, u.arguments) ?? e.noun(u);
			if (m === "end" || m === "endCase") return caseDoc(c, u) ?? e.noun(u);
		}
		if (callee?.type === "MemberExpression" && !callee.computed && callee.property.name !== "fn") {
			const o = unwrap(callee.object);
			if (o?.type === "MemberExpression" && !o.computed && o.property.name === "fn" && isEb(c, o.object))
				return fnDoc(c, callee.property.name, u.arguments) ?? e.noun(u);
		}
		if (callee?.type === "MemberExpression" && !callee.computed && callee.property.name === "fn" && isEb(c, callee.object)) {
			const name = literalString(u.arguments[0]);
			const args = listDoc(
				e,
				items(u.arguments[1]).map((x) => refDoc(c, x)),
			);
			return D(say.value.fn({ name: name !== null ? mk("c", name) : e.text(u.arguments[0]), args: args.t }), args.kids);
		}
		if (callee?.type === "Identifier" && (callee.name === "jsonArrayFrom" || callee.name === "jsonObjectFrom")) {
			const q = queryDoc(c, u.arguments[0]);
			if (q) return D((callee.name === "jsonArrayFrom" ? say.value.jsonArray : say.value.jsonObject)({ query: q.t }), q.kids);
		}
	}
	if (isFn(u)) {
		const body = fnResult(u);
		if (body) return exprDoc(inside(c, u), body);
	}
	return e.noun(n);
}

/** `eb.ref(...)`, `eb.val(...)`, `eb.and([...])`, `eb.selectFrom(...)`... */
export function ebMethod(c: Ctx, m: string, args: N[]): Doc | null {
	const { e, say } = c;
	if (m === "ref") return refDoc(c, args[0]);
	if (m === "val" || m === "lit") return e.noun(args[0]);
	if (m === "cast") {
		const v = refDoc(c, args[0]);
		return D(say.value.cast({ value: v.t, type: e.text(args[1]) }), v.kids);
	}
	if (m === "parens") return args.length >= 3 ? compareDoc(c, refDoc(c, args[0]), args[1], args[2], false, false) : exprDoc(c, args[0]);
	if (["and", "or", "not", "exists", "between", "betweenSymmetric"].includes(m)) return ebCondition(c, m, args, false);
	return null;
}

/** `eb.fn.count("id")`, `eb.fn.countAll()`, `eb.fn.coalesce(a, b)`. */
function fnDoc(c: Ctx, m: string, args: N[]): Doc | null {
	const { e, say } = c;
	if (m === "countAll") return D(say.aggregate.countRows);
	if (m === "coalesce") {
		const v = listDoc(
			e,
			args.map((x) => refDoc(c, x)),
			"or",
		);
		return D(say.aggregate.coalesce({ values: v.t }), v.kids);
	}
	if (!AGGREGATES.has(m) || !args[0]) return null;
	const col = refDoc(c, args[0]);
	return D(say.aggregate[m as "count"]({ column: col.t }), col.kids);
}

/** `eb.case().when(...).then(...).else(...).end()`. */
function caseDoc(c: Ctx, n: N): Doc | null {
	const { e, say } = c;
	const { root, steps } = chainOf(n);
	if (steps[0]?.m !== "case" || !isEb(c, root)) return null;
	const lines: Doc[] = [];
	let pending: Doc | null = null;
	for (const s of steps) {
		if (s.m === "when") pending = whereArgs(c, s.args);
		else if (s.m === "then" && pending) {
			const v = valDoc(c, s.args[0]);
			lines.push(D(say.value.when({ condition: pending.t, value: v.t }), [...pending.kids, ...v.kids]));
			pending = null;
		} else if (s.m === "else") lines.push(D(say.value.otherwise({ value: valDoc(c, s.args[0]).t })));
	}
	return D(
		say.value.caseOf,
		lines.flatMap((l) => e.bullet(l)),
	);
}

/** A condition: `eb("a", "=", 1)`, `eb.and([...])`, `eb.exists(...)`, a callback returning one, or the engine's reading. */
export function condDoc(c: Ctx, n: N, neg: boolean): Doc {
	const u = unwrap(n);
	if (u?.type === "CallExpression") {
		const callee = unwrap(u.callee);
		if (isEb(c, callee)) return compareDoc(c, refDoc(c, u.arguments[0]), u.arguments[1], u.arguments[2], neg, false);
		const bound = ebMethodName(c, callee);
		if (bound) {
			const r = ebCondition(c, bound, u.arguments, neg);
			if (r) return r;
		}
		if (callee?.type === "MemberExpression" && !callee.computed && isEb(c, callee.object)) {
			const r = ebCondition(c, callee.property.name, u.arguments, neg);
			if (r) return r;
		}
	}
	if (isFn(u)) {
		const body = fnResult(u);
		if (body) return condDoc(inside(c, u), body, neg);
	}
	return c.e.cond(n, neg);
}

export function ebCondition(c: Ctx, m: string, args: N[], neg: boolean): Doc | null {
	const { e, say } = c;
	if (m === "and" || m === "or") {
		const arg = unwrap(args[0]);
		if (arg?.type === "ObjectExpression")
			return combine(
				c,
				arg.properties.map((p: N) => propCondition(c, p, neg)),
				neg,
				m === "and",
			);
		if (arg?.type !== "ArrayExpression") {
			const list = e.noun(arg);
			return D((m === "and" ? say.logic.allIn : say.logic.anyIn)({ list: list.t, neg }), list.kids);
		}
		return combine(
			c,
			arg.elements.filter(Boolean).map((x: N) => condDoc(c, x, neg)),
			neg,
			m === "and",
		);
	}
	if (m === "not") return condDoc(c, args[0], !neg);
	if (m === "exists") {
		const q = queryDoc(c, args[0]);
		if (q) return D(say.exists.lookup({ query: q.t, neg }), q.kids);
		return null;
	}
	if (m === "between" || m === "betweenSymmetric") {
		const [v, lo, hi] = [refDoc(c, args[0]), valDoc(c, args[1]), valDoc(c, args[2])];
		return D(say.compare.between({ value: v.t, low: lo.t, high: hi.t, neg }), [...v.kids, ...lo.kids, ...hi.kids]);
	}
	return null;
}

/** `eb.and({ first_name: "Jennifer", last_name: ref })`: each key equals its value. */
function propCondition(c: Ctx, p: N, neg: boolean): Doc {
	const k = keyName(p);
	if (!k) return c.e.noun(p);
	return compareDoc(c, D(refText(c, k)), { type: "Literal", value: "=" }, p.value, neg, false);
}

export function combine(c: Ctx, docs: Doc[], neg: boolean, isAnd = true): Doc {
	if (docs.length === 1) return docs[0]!;
	return D(
		isAnd !== neg ? c.say.logic.all : c.say.logic.any,
		docs.flatMap((d) => c.e.bullet(d)),
	);
}

/** `where(...)` arguments: `(ref, op, value)`, a callback, or one expression. */
export function whereArgs(c: Ctx, args: N[], neg = false, refs = false): Doc {
	if (args.length >= 3) return compareDoc(c, refDoc(c, args[0]), args[1], args[2], neg, refs);
	return condDoc(c, args[0], neg);
}

const ORDERED: Record<string, ["moreThan" | "atLeast" | "lessThan" | "atMost", "moreThan" | "atLeast" | "lessThan" | "atMost"]> = {
	">": ["moreThan", "atMost"],
	">=": ["atLeast", "lessThan"],
	"<": ["lessThan", "atLeast"],
	"<=": ["atMost", "moreThan"],
};

/** `(left, op, right)` by SQL operator; `refs` reads the right side as a column too (`whereRef`, `onRef`). */
export function compareDoc(c: Ctx, left: Doc, opNode: N, rightNode: N, neg: boolean, refs: boolean): Doc {
	const { e, say } = c;
	const op = (literalString(opNode) ?? "").toLowerCase();
	const right = () => (refs ? refDoc(c, rightNode) : valDoc(c, rightNode));
	const pair = (f: (p: { left: string; right: string }) => string) => {
		const r = right();
		return D(f({ left: left.t, right: r.t }), [...left.kids, ...r.kids]);
	};
	const isNull = unwrap(rightNode)?.type === "Literal" && unwrap(rightNode).value === null;
	if ((op === "=" || op === "is") && isNull) return D(say.compare.empty({ value: left.t, neg }), left.kids);
	if ((op === "!=" || op === "<>" || op === "is not") && isNull) return D(say.compare.empty({ value: left.t, neg: !neg }), left.kids);
	if (op === "=" || op === "==" || op === "is") return pair((p) => say.compare.equal({ ...p, neg }));
	if (op === "!=" || op === "<>" || op === "is not") return pair((p) => say.compare.equal({ ...p, neg: !neg }));
	if (ORDERED[op]) return pair((p) => say.compare[ORDERED[op]![neg ? 1 : 0]](p));
	if (op === "in" || op === "not in") return pair((p) => say.compare.in({ ...p, neg: neg !== (op === "not in") }));
	if (/^(not )?i?like$/.test(op)) return patternDoc(c, left, rightNode, neg !== op.startsWith("not"), op.includes("ilike"));
	if (["~", "~*", "!~", "!~*", "regexp"].includes(op)) {
		const r = right();
		return D(say.pattern.regex({ value: left.t, pattern: r.t, neg: neg !== op.startsWith("!"), ignoreCase: op.endsWith("*") }), [...left.kids, ...r.kids]);
	}
	if (op === "@>" || op === "<@" || op === "&&") {
		const kind = ({ "@>": "containsAll", "<@": "within", "&&": "overlaps" } as const)[op];
		const r = right();
		return D(say.array[kind]({ value: left.t, items: r.t, neg }), [...left.kids, ...r.kids]);
	}
	const r = right();
	return D(say.compare.other({ left: left.t, op: mk("c", literalString(opNode) ?? e.code(opNode)), right: r.t, neg }), [...left.kids, ...r.kids]);
}

const WILD = /[%_\\]/;

/** `like "%x%"` reads as "contains"; anything that isn't a plain affix pattern stays a pattern. */
function patternDoc(c: Ctx, left: Doc, p: N, neg: boolean, ignoreCase: boolean): Doc {
	const { e, say } = c;
	const kindOf = (lead: boolean, trail: boolean) => (lead && trail ? "contains" : trail ? "startsWith" : lead ? "endsWith" : null);
	const s = literalString(p);
	if (s !== null) {
		const kind = kindOf(s.startsWith("%"), s.endsWith("%") && s.length > 1);
		const inner = s.replace(/^%/, "").replace(/%$/, "");
		if (kind && inner && !WILD.test(inner)) return D(say.pattern[kind]({ value: left.t, text: mk("l", `"${inner}"`), neg, ignoreCase }), left.kids);
	}
	const u = unwrap(p);
	if (u?.type === "TemplateLiteral" && u.expressions.length === 1) {
		const [head, tail] = u.quasis.map((q: N) => q.value.cooked as string);
		const kind = kindOf(head === "%", tail === "%");
		if (kind && (head === "" || head === "%") && (tail === "" || tail === "%"))
			return D(say.pattern[kind]({ value: left.t, text: e.text(u.expressions[0]), neg, ignoreCase }), left.kids);
	}
	const pattern = valDoc(c, p);
	return D(say.pattern.matches({ value: left.t, pattern: pattern.t, neg, ignoreCase }), [...left.kids, ...pattern.kids]);
}

/** `orderBy` arguments in every form Kysely has accepted: `(expr, "desc")`, `("x desc")`, `([...])`, `(expr, ob => ob.desc().nullsLast())`. */
export function orderDocs(c: Ctx, args: N[]): string[] {
	const { e, say } = c;
	const dirOf = (column: string, dir: string | null, nulls: "first" | "last" | null) => {
		const time = e.g.isTimeLike(plain(column));
		let t = dir === "desc" ? say.order.descending({ column, time }) : dir === "asc" ? say.order.ascending({ column, time }) : column;
		if (nulls) t = say.order.nulls({ order: t, first: nulls === "first" });
		return t;
	};
	if (args.length === 1 && unwrap(args[0])?.type === "ArrayExpression") return items(args[0]).flatMap((x) => orderDocs(c, [x]));
	const s = literalString(args[0]);
	const spaced = s?.match(/^(.*?)\s+(asc|desc)$/i);
	if (spaced) return [dirOf(refText(c, spaced[1]!), spaced[2]!.toLowerCase(), null)];
	const column = refDoc(c, args[0]).t;
	const mod = unwrap(args[1]);
	if (!mod) return [column];
	const dir = literalString(mod);
	if (dir !== null) return [dirOf(column, dir.toLowerCase(), null)];
	if (isFn(mod)) {
		const { steps } = chainOf(fnResult(mod));
		const d = steps.find((x) => x.m === "asc" || x.m === "desc")?.m ?? null;
		const n = steps.find((x) => x.m === "nullsFirst" || x.m === "nullsLast")?.m;
		return [dirOf(column, d, n === "nullsFirst" ? "first" : n === "nullsLast" ? "last" : null)];
	}
	return [`${column} ${e.text(mod)}`];
}
