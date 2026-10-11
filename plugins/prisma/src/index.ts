import { D, type Doc } from "@usenarrator/core";
import { type CallRule, definePlugin, type N, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { clientDoc, extendsDoc } from "./client";
import { en } from "./en";
import type { PrismaPhrases } from "./phrases";
import { aggregateDoc, countDoc, findDoc, groupByDoc } from "./queries";
import { active, type Ctx, entryDoc, isHandle, MODEL_METHODS, type ModelCall, modelCall } from "./shared";
import { transactionDoc } from "./transaction";
import { createDoc, deleteDoc, updateDoc, upsertDoc } from "./writes";

export { en } from "./en";
export type { PrismaPhrases } from "./phrases";

type P = PrismaPhrases;
type Site = { node: N; args: N[]; obj: N | null; stmt: boolean };

function modelDoc(c: Ctx, call: ModelCall, stmt: boolean): Doc {
	const m = call.method;
	if (m.startsWith("find")) return findDoc(c, call, stmt);
	if (m === "count") return countDoc(c, call);
	if (m === "aggregate") return aggregateDoc(c, call);
	if (m === "groupBy") return groupByDoc(c, call);
	if (m.startsWith("create")) return createDoc(c, call, stmt);
	if (m === "upsert") return upsertDoc(c, call, stmt);
	if (m.startsWith("update")) return updateDoc(c, call, stmt);
	return deleteDoc(c, call, stmt);
}

/** Prisma Client (prisma.io), v6 and v7: model queries and writes, filters, transactions, extensions and the client. Raw SQL is left to the sql plugin. */
export const prisma = (): TsPlugin<P> => {
	const rule =
		(f: (c: Ctx, site: Site) => Doc | null): CallRule<P> =>
		({ e, say, node, args, obj, stmt }) =>
			f({ e, say }, { node, args, obj, stmt });
	const onHandle = (f: (c: Ctx, site: Site) => Doc | null) => rule((c, site) => (site.obj && isHandle(site.obj) && active(c.e) ? f(c, site) : null));
	const calls: Record<string, CallRule<P>> = {};
	for (const m of MODEL_METHODS)
		calls[`*.${m}`] = rule((c, { node, obj, stmt }) => {
			const call = modelCall(c.e, node, obj);
			return call ? modelDoc(c, call, stmt) : null;
		});
	calls["*.$transaction"] = onHandle(transactionDoc);
	calls["*.$extends"] = onHandle(extendsDoc);
	calls["*.$connect"] = onHandle((c) => D(c.say.client.connect));
	calls["*.$disconnect"] = onHandle((c) => D(c.say.client.disconnect));
	calls["new PrismaClient"] = rule((c, site) => (active(c.e) ? clientDoc(c, site) : null));
	calls.defineConfig = rule((c, { args }) => {
		if (c.e.imports.get("defineConfig")?.from !== "prisma/config") return null;
		const o = unwrap(args[0]);
		const kids = o?.type === "ObjectExpression" ? o.properties.map((p: N) => entryDoc(c.e, p)) : [c.e.noun(args[0])];
		return D(
			c.say.client.config,
			kids.flatMap((k: Doc) => c.e.bullet(k)),
		);
	});
	return definePlugin<P>({
		name: "prisma",
		library: { name: "@prisma/client", versions: ">=6 <8" },
		phrases: { en },
		calls,
	});
};
