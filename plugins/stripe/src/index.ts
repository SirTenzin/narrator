import type { Doc } from "@usenarrator/core";
import { type CallRule, definePlugin, type MemberRule, type N, type StmtRule, type TsPlugin } from "@usenarrator/lang-ts";
import { clientDoc } from "./client";
import { en } from "./en";
import { autoPagingEachDoc, autoPagingToArrayDoc, forAwaitStmt } from "./pages";
import type { StripePhrases } from "./phrases";
import { resourceDoc } from "./resources";
import type { Ctx } from "./shared";
import { constructEventDoc, eventDataDoc, eventSwitchStmt, testHeaderDoc } from "./webhooks";

export { en } from "./en";
export type { MethodPhrase, StripePhrases } from "./phrases";

type P = StripePhrases;
type Site = { node: N; args: N[]; obj: N | null; stmt: boolean };

/** Stripe Node SDK (`stripe` on npm): resource calls as billing actions, webhooks, pagination and the client. */
export const stripe = (): TsPlugin<P> => {
	const rule =
		(f: (c: Ctx, site: Site) => Doc | null): CallRule<P> =>
		({ e, say, node, args, obj, stmt }) =>
			f({ e, say }, { node, args, obj, stmt });
	const calls: Record<string, CallRule<P>> = {};
	for (const m of Object.keys(en.methods)) calls[`*.${m}`] = rule(resourceDoc);
	calls["*.constructEvent"] = rule(constructEventDoc);
	calls["*.constructEventAsync"] = rule(constructEventDoc);
	calls["*.generateTestHeaderString"] = rule(testHeaderDoc);
	calls["*.generateTestHeaderStringAsync"] = rule(testHeaderDoc);
	calls["*.autoPagingEach"] = rule(autoPagingEachDoc);
	calls["*.autoPagingToArray"] = rule(autoPagingToArrayDoc);
	calls["new Stripe"] = rule(clientDoc);
	const eventData: MemberRule<P> = ({ e, say, obj, prop }) => eventDataDoc({ e, say }, { obj, prop });
	const statements: StmtRule<P>[] = [({ e, say, node, d }) => eventSwitchStmt({ e, say }, node, d), ({ e, say, node, d }) => forAwaitStmt({ e, say }, node, d)];
	return definePlugin<P>({
		name: "stripe",
		library: { name: "stripe", versions: ">=14 <24" },
		phrases: { en },
		calls,
		members: { "*.data.object": eventData, "*.data.previous_attributes": eventData },
		statements,
	});
};
