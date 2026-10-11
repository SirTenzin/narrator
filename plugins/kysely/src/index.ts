import type { Doc } from "@usenarrator/core";
import { type CallRule, definePlugin, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { en } from "./en";
import { condDoc, ebMethod } from "./expr";
import type { KyselyPhrases } from "./phrases";
import { HEADS, queryDoc } from "./query";
import { active, type Ctx, isEb } from "./shared";
import { transactionDoc } from "./transaction";

export { en } from "./en";
export type { KyselyPhrases } from "./phrases";

type P = KyselyPhrases;

/** Every method that can end a Kysely chain the engine hands to a rule. */
const CHAIN_METHODS = [
	...HEADS,
	"select",
	"selectAll",
	"where",
	"whereRef",
	"having",
	"havingRef",
	"innerJoin",
	"leftJoin",
	"rightJoin",
	"fullJoin",
	"innerJoinLateral",
	"leftJoinLateral",
	"crossJoin",
	"crossJoinLateral",
	"orderBy",
	"groupBy",
	"limit",
	"offset",
	"top",
	"distinct",
	"distinctOn",
	"values",
	"set",
	"returning",
	"returningAll",
	"onConflict",
	"onDuplicateKeyUpdate",
	"ignore",
	"forUpdate",
	"forShare",
	"skipLocked",
	"noWait",
	"$if",
	"$call",
	"$narrowType",
	"$castTo",
	"$assertType",
	"$notNull",
	"using",
	"whenMatched",
	"whenNotMatched",
	"thenUpdateSet",
	"thenInsertValues",
	"thenDelete",
	"thenDoNothing",
	"as",
	"executeTakeFirst",
	"executeTakeFirstOrThrow",
	"stream",
	"compile",
	"explain",
];

/** Kysely (kysely.dev), 0.27 and 0.28: query builder chains, the expression builder and transactions. `sql` templates are left to the sql plugin. */
export const kysely = (): TsPlugin<P> => {
	const ctx = (e: Ctx["e"], say: P): Ctx => ({ e, say, ebs: new Map() });
	const query: CallRule<P> = ({ e, say, node, stmt }) => queryDoc(ctx(e, say), node, stmt);
	const calls: Record<string, CallRule<P>> = Object.fromEntries(CHAIN_METHODS.map((m) => [`*.${m}`, query]));
	const eb: CallRule<P> = ({ e, say, node, obj, args }) => {
		const c = ctx(e, say);
		if (!active(e) || (obj && !isEb(c, obj))) return null;
		const m = obj ? unwrap(node.callee).property.name : "";
		return m ? ebMethod(c, m, args) : condDoc(c, node, false);
	};
	calls.eb = eb;
	for (const m of ["and", "or", "not", "exists", "between", "ref", "val", "lit"]) calls[`*.${m}`] = eb;
	calls["*.execute"] = ({ e, say, node, stmt }) => queryDoc(ctx(e, say), node, stmt) ?? (transactionDoc(ctx(e, say), { node, stmt }) as Doc | null);
	return definePlugin<P>({
		name: "kysely",
		library: { name: "kysely", versions: ">=0.27 <1" },
		phrases: { en },
		calls,
	});
};
