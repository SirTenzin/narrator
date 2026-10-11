import { D, type Doc, mk } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import { fromTemplate, looksLikeSql, type SqlMode, tryDescribeSql } from "@usenarrator/plugin-sql";
import type { DrizzlePhrases } from "./phrases";

export type Ctx = { e: Engine; say: DrizzlePhrases };
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

export const calleeName = (n: N): string | null => {
	const c = unwrap(unwrap(n)?.callee);
	if (c?.type === "Identifier") return c.name;
	if (c?.type === "MemberExpression" && !c.computed) return c.property.name;
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

export const keyName = (p: N): string | null => {
	if (p.type !== "Property" || p.computed) return null;
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

const lastSegment = (e: Engine, n: N) =>
	e
		.code(n)
		.replace(/\(\)$/, "")
		.split(/[.?!]+/)
		.at(-1) ?? "";

/** The receiver looks like a Drizzle database handle: `db`, `ctx.db`, `this.db`, `readDb`. */
export const isDb = (e: Engine, n: N) => {
	const s = lastSegment(e, n);
	return /^(db|tx|trx|database)$/i.test(s) || /(Db|DB|Tx)$/.test(s);
};

/** The receiver looks like a transaction handle: `tx`, `trx`, `dbTx`. */
export const isTx = (e: Engine, n: N) => {
	const s = lastSegment(e, n);
	return /^(tx|trx|transaction)$/i.test(s) || /Tx$/.test(s);
};

export function isSqlTemplate(n: N): boolean {
	const u = unwrap(n);
	if (u?.type !== "TaggedTemplateExpression") return false;
	const tag = unwrap(u.tag);
	return (tag.type === "Identifier" && tag.name === "sql") || (tag.type === "MemberExpression" && !tag.computed && tag.property.name === "sql");
}

/** The full SQL text of a `sql` template, interpolations included as written. */
export const sqlCode = (e: Engine, n: N) => mk("c", e.code(unwrap(n).quasi).slice(1, -1).replace(/\s+/g, " ").trim());

export const isDrizzleModule = (m: string | undefined) => !!m && (m === "drizzle-orm" || m.startsWith("drizzle-orm/"));

/** A template tag that is Drizzle's `sql`: imported from `drizzle-orm` by name or through a namespace (`orm.sql`). */
export function isDrizzleSql(e: Engine, tag: N): boolean {
	const t = unwrap(tag);
	if (t?.type === "Identifier") return t.name !== "raw" && isDrizzleModule(e.imports.get(t.name)?.from);
	const obj = t?.type === "MemberExpression" && !t.computed && t.property.name === "sql" ? unwrap(t.object) : null;
	return obj?.type === "Identifier" && isDrizzleModule(e.imports.get(obj.name)?.from);
}

/** A `sql` template holding a whole statement, in plugin-sql's clause-by-clause English; null for fragments and SQL it can't read. */
export function sqlStatement(e: Engine, n: N, mode: SqlMode): Doc | null {
	const text = fromTemplate({ e, quasi: unwrap(n).quasi, isSqlTag: isSqlTemplate });
	return looksLikeSql(text.display) ? tryDescribeSql({ e, sql: text, mode }) : null;
}

export function sqlFragment({ e, say }: Ctx, n: N): Doc {
	const code = e.code(unwrap(n).quasi).slice(1, -1).trim();
	return D(code ? say.sql.fragment({ sql: sqlCode(e, n) }) : say.sql.empty);
}

/** An object literal whose values include `sql` templates, rendered so the SQL shows in full. */
export const hasSqlValues = (n: N) => {
	const u = unwrap(n);
	if (u?.type !== "ObjectExpression" || u.properties.some((p: N) => p.type !== "Property")) return false;
	return u.properties.some((p: N) => isSqlTemplate(p.value));
};

function objectWithSql(c: Ctx, n: N): Doc | null {
	const { e, say } = c;
	if (!hasSqlValues(n)) return null;
	const items = n.properties.map((p: N) => {
		const k = keyName(p);
		if (!k || !isSqlTemplate(p.value)) return e.objectProp(p);
		return D(say.sql.field({ key: e.prop(k), value: sqlFragment(c, p.value).t }));
	});
	return e.objectFromItems(items);
}

/** A value inside a Drizzle construct: `sql` templates show their full SQL; everything else is the engine's noun. */
export function val(c: Ctx, node: N): Doc {
	const u = unwrap(node);
	if (isSqlTemplate(u)) return sqlFragment(c, u);
	if (u?.type === "ObjectExpression") return objectWithSql(c, u) ?? c.e.noun(node);
	return c.e.noun(node);
}

/** A condition inside a Drizzle construct; `sql` templates read as raw SQL conditions. */
export function condition(c: Ctx, node: N, neg = false): Doc {
	const u = unwrap(node);
	if (isSqlTemplate(u)) return D(c.say.sql.condition({ sql: sqlCode(c.e, u), neg }));
	return c.e.cond(node, neg);
}

/** Several docs as one list phrase, with any block lines kept. */
export const listDoc = (e: Engine, docs: Doc[], conj: "and" | "or" = "and"): Doc =>
	D(
		e.g.list(
			docs.map((d) => d.t),
			conj,
		),
		docs.flatMap((d) => d.kids),
	);

/** Items of an array literal, or the node itself. */
export const items = (n: N): N[] => {
	const u = unwrap(n);
	return u?.type === "ArrayExpression" ? u.elements.filter(Boolean) : [n];
};

/** An object entry the plugin doesn't interpret, rendered by the engine (spreads included). */
export const entryDoc = (e: Engine, p: N): Doc => (p.type === "SpreadElement" ? e.noun(p) : e.objectProp(p));

/** The literal `1`, for singular counts. */
export const isOne = (n: N) => unwrap(n)?.type === "Literal" && unwrap(n).value === 1;
