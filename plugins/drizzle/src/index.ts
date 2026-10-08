import type { Doc } from "@narrate/core";
import { type CallRule, type CondRule, definePlugin, type N, type TsPlugin } from "@narrate/lang-ts";
import { en } from "./en";
import { operatorCalls, operatorConds, sqlMethod } from "./operators";
import type { DrizzlePhrases } from "./phrases";
import { QUERY_METHODS, queryDoc } from "./query";
import { findDoc } from "./relational";
import { columnDoc, constraintDoc, defineRelationsDoc, enumDoc, relationsDoc, rlsTableDoc, tableDoc } from "./schema";
import type { Ctx } from "./shared";
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

const query = (c: Ctx, { node }: Site) => queryDoc(c, node);
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

/** Drizzle ORM: query builders, relational queries, SQL operators and `sql` fragments, transactions, and schema definitions. */
export const drizzle = (): TsPlugin<DrizzlePhrases> =>
	definePlugin({
		name: "drizzle",
		phrases: { en },
		calls,
		conditions: Object.fromEntries(
			Object.entries(operatorConds).map(([k, op]) => [k, (({ args, e, neg, say }) => op({ e, say }, args, neg)) as CondRule<DrizzlePhrases>]),
		),
	});
