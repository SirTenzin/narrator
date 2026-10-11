import { D, type Doc, mk } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import type { KyselyPhrases } from "./phrases";

/** `ebs` maps names bound to Kysely's expression builder in the callbacks being read to "" (`eb`, `join`), or to the builder method a destructured name stands for (`({ or }) => or([...])`). */
export type Ctx = { e: Engine; say: KyselyPhrases; ebs: Map<string, string> };
export type Step = { m: string; args: N[] };

/** `a.b(x).c(y)` -> root `a`, steps `[b(x), c(y)]`. */
export function chainOf(node: N): { root: N; steps: Step[] } {
	const steps: Step[] = [];
	let cur = unwrap(node);
	while (cur?.type === "CallExpression" && unwrap(cur.callee).type === "MemberExpression" && !unwrap(cur.callee).computed) {
		const c = unwrap(cur.callee);
		steps.unshift({ m: c.property.name, args: cur.arguments });
		cur = unwrap(c.object);
	}
	return { root: cur, steps };
}

export const active = (e: Engine) => e.usesLibrary("kysely");

export const keyName = (p: N): string | null => {
	if (p?.type !== "Property" || p.computed) return null;
	if (p.key.type === "Identifier") return p.key.name;
	if (p.key.type === "Literal") return String(p.key.value);
	return null;
};

export const literalString = (n: N): string | null => {
	const u = unwrap(n);
	if (u?.type === "Literal" && typeof u.value === "string") return u.value;
	if (u?.type === "TemplateLiteral" && !u.expressions.length) return u.quasis[0].value.cooked;
	return null;
};

export const isFn = (n: N) => ["ArrowFunctionExpression", "FunctionExpression"].includes(unwrap(n)?.type);

/** A lambda's single returned expression, or null when it has a statement body. */
export function fnResult(fn: N): N | null {
	const f = unwrap(fn);
	if (f.body.type !== "BlockStatement") return f.body;
	const only = f.body.body.length === 1 ? f.body.body[0] : null;
	return only?.type === "ReturnStatement" ? only.argument : null;
}

/** The context for reading a callback's body: its first parameter (or the names destructured from it) become expression builder names. */
export function inside(c: Ctx, fn: N): Ctx {
	let p = unwrap(fn).params?.[0];
	if (p?.type === "AssignmentPattern") p = p.left;
	const ebs = new Map(c.ebs);
	if (p?.type === "Identifier") ebs.set(p.name, "");
	else if (p?.type === "ObjectPattern")
		for (const x of p.properties) {
			const local = x.value?.type === "AssignmentPattern" ? x.value.left : x.value;
			if (x.type === "Property" && local?.type === "Identifier") ebs.set(local.name, x.key?.name === "eb" ? "" : (x.key?.name ?? ""));
		}
	else return c;
	return { ...c, ebs };
}

/** Items of an array literal, or the node itself. */
export const items = (n: N): N[] => {
	const u = unwrap(n);
	return u?.type === "ArrayExpression" ? u.elements.filter(Boolean) : [n];
};

/** An expression builder: a callback parameter we're reading, a name typed as one (`eb: ExpressionBuilder<DB, "x">`), or `eb` itself. */
export const isEb = (c: Ctx, n: N) => {
	const u = unwrap(n);
	if (u?.type !== "Identifier") return false;
	if (c.ebs.has(u.name)) return c.ebs.get(u.name) === "";
	return u.name === "eb" || /ExpressionBuilder$/.test(c.e.varTypes.get(u.name) ?? "");
};

/** A builder method bound by destructuring, like `or` in `({ or, eb }) => or([...])`. */
export const ebMethodName = (c: Ctx, n: N): string | null => {
	const u = unwrap(n);
	return u?.type === "Identifier" && c.ebs.get(u.name) ? c.ebs.get(u.name)! : null;
};

/** Joins docs into one list phrase, keeping their block lines. */
export const listDoc = (e: Engine, docs: Doc[], conj: "and" | "or" = "and"): Doc =>
	D(
		e.g.list(
			docs.map((d) => d.t),
			conj,
		),
		docs.flatMap((d) => d.kids),
	);

/** A SQL name in a string: `"person.first_name as fn"` -> "person's first name, named fn". */
export function refText(c: Ctx, s: string): string {
	const { e, say } = c;
	const alias = s.match(/^(.*?)\s+as\s+(\w+)$/i);
	if (alias) return say.value.named({ value: refText(c, alias[1]!), name: mk("v", e.lex.humanize(alias[2]!), alias[2]!) });
	const parts = s.trim().split(".");
	if (parts.length === 2 && parts[1] === "*") return say.value.allColumnsOf({ table: e.prop(parts[0]!) });
	if (parts.length === 2 && parts[0] === "excluded") return say.value.excluded({ column: e.prop(parts[1]!) });
	if (parts.length >= 2) return say.value.column({ table: e.prop(parts.at(-2)!), column: e.prop(parts.at(-1)!) });
	return e.prop(s.trim());
}
