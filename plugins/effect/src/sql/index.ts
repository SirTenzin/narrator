import { D, type Doc, mk } from "@usenarrator/core";
import { type CallRule, definePlugin, type Engine, type N, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { type FileImports, isObj, objProp, readImports, schemaPhrase } from "../context";

type P<K extends string> = (p: { [k in K]: string }) => string;

/** Every English fragment of the Effect SQL companion plugin (`@usenarrator/plugin-effect/sql`). */
export type EffectSqlPhrases = {
	constants: Record<string, string>;
	query: P<"sql">;
	rawQuery: P<"sql">;
	transaction: { noun: P<"effect">; act: P<"effect"> };
	queryFn: P<"request" | "query" | "result">;
	results: { findOne: P<"type">; findAll: P<"type">; findNonEmpty: P<"type">; single: P<"type">; void: string };
	resolver: P<"name" | "query">;
};
/** @deprecated Use `EffectSqlPhrases`. */
export type SqlPhrases = EffectSqlPhrases;

export const en: EffectSqlPhrases = {
	constants: { "SqlClient.SqlClient": "the SQL client service" },
	query: ({ sql }) => `the SQL query ${sql}`,
	rawQuery: ({ sql }) => `the raw SQL query ${sql}`,
	transaction: { noun: ({ effect }) => `${effect}, run inside a database transaction`, act: ({ effect }) => `run ${effect} inside a database transaction` },
	queryFn: ({ request, query, result }) => `a query function that takes ${request}, runs ${query}, and gives back ${result}`,
	results: {
		findOne: ({ type }) => `the first row as ${type}, if there is one`,
		findAll: ({ type }) => `every row as ${type}`,
		findNonEmpty: ({ type }) => `every row as ${type}, failing if there are none`,
		single: ({ type }) => `exactly one row as ${type}`,
		void: "nothing",
	},
	resolver: ({ name, query }) => `a batched lookup named ${name} that runs ${query}`,
};

type Ctx = { e: Engine; say: EffectSqlPhrases; imp: FileImports; clients: Set<string> };
const SQL_MODULE = /^(@effect\/sql(-[\w-]+)?|effect\/(unstable\/)?sql)(\/|$)/;
const CLIENT = /\b(\w+)\s*=\s*\(?\s*yield\*\s+(\w+Client)\.\2\b/g;

/** The query text with each `${…}` kept as written, so nothing is lost or reordered. */
function sqlText(e: Engine, quasi: N): string {
	const parts: string[] = [];
	quasi.quasis.forEach((q: N, i: number) => {
		parts.push(q.value.cooked ?? q.value.raw);
		if (quasi.expressions[i]) parts.push(`\${${e.code(quasi.expressions[i])}}`);
	});
	return mk("c", parts.join("").replace(/\s+/g, " ").trim());
}

const typeOf = (e: Engine, n: N | null) => (n ? schemaPhrase(e, n) : null);

/** `SqlSchema.findAll({ Request, Result, execute: (req) => sql`…` })`. */
const sqlSchema =
	(kind: keyof EffectSqlPhrases["results"]) =>
	(c: Ctx, [opts]: N[]): Doc | null => {
		if (!opts || !isObj(opts)) return null;
		const req = typeOf(c.e, objProp(opts, "Request"));
		const exec = objProp(opts, "execute");
		const body = exec ? unwrap(exec) : null;
		const ex = body && (body.type === "ArrowFunctionExpression" || body.type === "FunctionExpression") ? c.e.lambdaExpr(body) : body;
		if (!req || !ex) return null;
		const res = typeOf(c.e, objProp(opts, "Result"));
		const r = c.say.results;
		const result = kind === "void" ? r.void : r[kind]({ type: res ?? r.void });
		return D(c.say.queryFn({ request: req, query: c.e.noun(ex).t, result }));
	};

/** Effect SQL (`@effect/sql` in v3, `effect/sql` in v4): `sql` tagged queries, transactions, `SqlSchema` and `SqlResolver`. */
export const effectSql = (): TsPlugin<EffectSqlPhrases> => {
	let src = "\0";
	let ctxCache: Omit<Ctx, "e" | "say"> = { imp: readImports(""), clients: new Set() };
	const ctx = (e: Engine, say: EffectSqlPhrases): Ctx | null => {
		if (e.src !== src) {
			src = e.src;
			ctxCache = { imp: readImports(src), clients: new Set([...src.matchAll(CLIENT)].map((m) => m[1]!)) };
		}
		const usesSql = [...ctxCache.imp.modules].some((m) => SQL_MODULE.test(m));
		return usesSql ? { e, say, ...ctxCache } : null;
	};
	const rule =
		(f: (c: Ctx, args: N[], x: { obj: N | null; stmt: boolean; node: N }) => Doc | string | null): CallRule<EffectSqlPhrases> =>
		({ node, args, obj, e, stmt, say }) => {
			const c = ctx(e, say);
			return c ? f(c, args, { obj, stmt, node }) : null;
		};
	const onClient = (c: Ctx, obj: N | null) => unwrap(obj)?.type === "Identifier" && c.clients.has(unwrap(obj).name);
	const calls: Record<string, CallRule<EffectSqlPhrases>> = {
		"sql``": rule((c, [quasi]) => (quasi ? D(c.say.query({ sql: sqlText(c.e, quasi) })) : null)),
		"*.withTransaction": rule((c, [eff], { obj, stmt }) =>
			onClient(c, obj) && eff ? D(c.say.transaction[stmt ? "act" : "noun"]({ effect: c.e.noun(eff).t })) : null,
		),
		"*.unsafe": rule((c, [q], { obj }) => (onClient(c, obj) && q ? D(c.say.rawQuery({ sql: c.e.noun(q).t })) : null)),
		"SqlSchema.findOne": rule((c, a) => sqlSchema("findOne")(c, a)),
		"SqlSchema.findOneOption": rule((c, a) => sqlSchema("findOne")(c, a)),
		"SqlSchema.findAll": rule((c, a) => sqlSchema("findAll")(c, a)),
		"SqlSchema.findNonEmpty": rule((c, a) => sqlSchema("findNonEmpty")(c, a)),
		"SqlSchema.single": rule((c, a) => sqlSchema("single")(c, a)),
		"SqlSchema.void": rule((c, a) => sqlSchema("void")(c, a)),
	};
	for (const m of ["findById", "ordered", "grouped", "void"])
		calls[`SqlResolver.${m}`] = rule((c, [name, opts]) => {
			const exec = opts && isObj(opts) ? objProp(opts, "execute") : null;
			if (!name || !exec) return null;
			const ex = c.e.lambdaExpr(unwrap(exec)) ?? exec;
			return D(c.say.resolver({ name: c.e.noun(name).t, query: c.e.noun(ex).t }));
		});
	return definePlugin<EffectSqlPhrases>({ name: "effect-sql", library: { name: "effect", versions: ">=3.10 <5" }, phrases: { en }, calls });
};

declare module "@usenarrator/core" {
	interface PluginPhrases {
		"effect-sql": EffectSqlPhrases;
	}
}
