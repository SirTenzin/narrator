import { D, type Doc } from "@usenarrator/core";
import { type CallRule, type CondRule, definePlugin, type N, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { describeSql, fromTemplate } from "@usenarrator/plugin-sql";
import { en } from "./en";
import { operatorCalls, operatorConds, sqlMethod } from "./operators";
import type { DrizzlePhrases } from "./phrases";
import { QUERY_METHODS, queryDoc } from "./query";
import { findDoc } from "./relational";
import { columnDoc, constraintDoc, defineRelationsDoc, enumDoc, relationsDoc, rlsTableDoc, tableDoc } from "./schema";
import { type Ctx, isDb, isDrizzleModule, isDrizzleSql, isSqlTemplate, sqlFragment, sqlStatement } from "./shared";
import { batchDoc, countDoc, rollbackDoc, transactionDoc } from "./transaction";

export type { ColumnType, DrizzlePhrases, ReferentialAction } from "./phrases";
export { en };

type Call = CallRule<DrizzlePhrases>;
type Site = { node: N; args: N[]; obj: N | null; stmt: boolean };

/** Adapts a `(ctx, site)` renderer to the engine's rule signature. */
const rule =
	(f: (c: Ctx, site: Site) => Doc | null): Call =>
	({ node, args, obj, stmt, e, say }) =>
		f({ e, say }, { node, args, obj, stmt });

/** Tries each renderer in turn; for method names several Drizzle constructs share. */
const first =
	(...fs: ((c: Ctx, site: Site) => Doc | null)[]) =>
	(c: Ctx, site: Site) => {
		for (const f of fs) {
			const d = f(c, site);
			if (d) return d;
		}
		return null;
	};

const query = (c: Ctx, { node, stmt }: Site) => queryDoc(c, node, stmt ? "action" : "value");
const sqlMethodOf = (c: Ctx, { node, obj, args }: Site) => sqlMethod(c, node, obj, args);
const constraint = (c: Ctx, { node }: Site) => constraintDoc(c, node);

const COLUMN_MODIFIERS = [
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
	"default",
	"unique",
	"array",
];
const CONSTRAINT_STEPS = ["on", "onOnly", "using", "concurrently", "nullsNotDistinct", "onDelete", "onUpdate"];

const calls: Record<string, Call> = {
	...Object.fromEntries(Object.entries(operatorCalls).map(([k, f]) => [k, rule((c, s) => f(c, s.args, s.node))])),
	...Object.fromEntries(COLUMN_MODIFIERS.map((m) => [`*.${m}`, rule(columnDoc)])),
	...Object.fromEntries(CONSTRAINT_STEPS.map((m) => [`*.${m}`, rule(constraint)])),
	...Object.fromEntries(QUERY_METHODS.map((m) => [`*.${m}`, rule(first(sqlMethodOf, query, constraint))])),
	"*.mapWith": rule(sqlMethodOf),
	"*.findMany": rule(findDoc),
	"*.findFirst": rule(findDoc),
	"*.transaction": rule(transactionDoc),
	"*.rollback": rule(rollbackDoc),
	"*.batch": rule(batchDoc),
	"*.$count": rule(countDoc),
	"*.$with": rule(query),
	pgTable: rule(tableDoc),
	mysqlTable: rule(tableDoc),
	sqliteTable: rule(tableDoc),
	singlestoreTable: rule(tableDoc),
	"*.enableRLS": rule(rlsTableDoc),
	pgEnum: rule(enumDoc),
	relations: rule(relationsDoc),
	defineRelations: rule(defineRelationsDoc),
	primaryKey: rule(constraint),
	foreignKey: rule(constraint),
	check: rule(constraint),
};

/** A `sql` template imported from Drizzle: a full statement reads clause by clause (via plugin-sql), anything else as a fragment. */
const sqlTemplate: CallRule<DrizzlePhrases> = ({ node, e, say, stmt }) =>
	isDrizzleSql(e, node.tag) ? (sqlStatement(e, node, stmt ? "action" : "text") ?? sqlFragment({ e, say }, node)) : null;

/** `db.execute(sql\`select ...\`)` (and SQLite's `db.all` / `get` / `run` / `values`): the statement it runs. */
const runSql =
	(strict: boolean) =>
	({ e }: Ctx, { args: [q], obj, stmt }: Site): Doc | null => {
		if (!q || !obj || !isDb(e, obj) || !isSqlTemplate(q) || (strict && !isDrizzleSql(e, unwrap(q).tag))) return null;
		const mode = stmt ? "action" : "value";
		return sqlStatement(e, q, mode) ?? describeSql({ e, sql: fromTemplate({ e, quasi: unwrap(q).quasi, isSqlTag: isSqlTemplate }), mode });
	};

/** `drizzle(client, { schema })` / `drizzle({ client })` from `drizzle-orm/<driver>`. */
const database: Call = ({ args: [first, second], e, say }) => {
	if (!isDrizzleModule(e.imports.get("drizzle")?.from)) return null;
	const opts = unwrap(first)?.type === "ObjectExpression" ? first : second;
	const prop = (k: string) => (unwrap(opts)?.type === "ObjectExpression" ? unwrap(opts).properties.find((p: N) => p.key?.name === k)?.value : null);
	const source = opts === first ? (prop("client") ?? prop("connection")) : first;
	const schema = prop("schema");
	return D(say.database({ source: source ? e.text(source) : "", schema: schema ? e.text(schema) : "" }));
};

/** Drizzle ORM: query builders, relational queries, SQL operators and `sql` fragments, transactions, and schema definitions. */
export const drizzle = (): TsPlugin<DrizzlePhrases> =>
	definePlugin({
		name: "drizzle",
		library: { name: "drizzle-orm", versions: ">=0.29 <2" },
		phrases: { en },
		calls: {
			...calls,
			"*.execute": rule(first(runSql(false), sqlMethodOf, query, constraint)),
			"*.values": rule(first(runSql(true), sqlMethodOf, query, constraint)),
			...Object.fromEntries(["all", "get", "run"].map((m) => [`*.${m}`, rule(runSql(true))])),
			drizzle: database,
			"sql``": sqlTemplate,
			"*.sql``": sqlTemplate,
		},
		conditions: Object.fromEntries(
			Object.entries(operatorConds).map(([k, op]) => [k, (({ args, e, neg, say }) => op({ e, say }, args, neg)) as CondRule<DrizzlePhrases>]),
		),
	});
