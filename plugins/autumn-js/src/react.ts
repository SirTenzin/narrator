import { D } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import * as billing from "./billing";
import type { Hook } from "./facts";
import { catalog, entities, expandItems, referrals } from "./resources";
import { type Ctx, literalString, params, restLines, type Said, said, termOf } from "./shared";
import { check, track } from "./usage";

/** `useCustomer()`, `useEntity(…)` and the other autumn-js hooks, read as what they load. */
export function hookCall(c: Ctx, hook: Hook, args: N[]): Said {
	const { say, e } = c;
	const r = say.react;
	if (hook === "useEntity") {
		// 0.x `useEntity(entityId, params)`, 1.x `useEntity({ entityId })` or `useEntity(params)`.
		const first = unwrap(args[0]);
		const idForm = literalString(first) !== null || (first?.type === "Identifier" && /id$/i.test(first.name));
		const p = params(idForm ? args[1] : args[0]);
		return said(c, r.useEntity, { entity: termOf(c, "entity", idForm ? first : p.take("entityId")) }, restLines(c, p));
	}
	const p = params(args[0]);
	if (hook === "useCustomer") {
		const expand = p.take("expand");
		const items = expand ? expandItems(c, expand) : null;
		return items ? said(c, r.useCustomerExpanded, { items }, restLines(c, p)) : said(c, r.useCustomer, {}, restLines(c, p));
	}
	if (hook === "useReferrals") {
		const program = p.take("programId");
		return said(c, r.useReferrals, { program: say.referrals.program({ id: program ? e.text(program) : "" }) }, restLines(c, p));
	}
	if (hook === "useListEvents" || hook === "useAggregateEvents" || hook === "usePaywall") {
		const feature = termOf(c, "feature", p.take("featureId"));
		const range = literalString(p.has("range") ? p.take("range") : undefined);
		const over = range && range in say.events.range ? D(say.events.over({ range: say.events.range[range as keyof typeof say.events.range] })) : null;
		return said(c, r[hook], { feature }, [over, ...restLines(c, p)]);
	}
	return said(c, r[hook], {}, restLines(c, p));
}

type Action = (c: Ctx, args: N[]) => Said;

/** The functions `useCustomer()` and `useEntity()` hand back, by name. They act on the signed-in customer. */
export const ACTIONS: Record<string, Action> = {
	attach: billing.attach,
	checkout: billing.checkout,
	previewAttach: billing.previewAttach,
	multiAttach: billing.multiAttach,
	previewMultiAttach: billing.previewMultiAttach,
	updateSubscription: billing.update,
	previewUpdateSubscription: billing.previewUpdate,
	cancel: billing.cancel,
	setupPayment: billing.setupPayment,
	openBillingPortal: billing.openPortal,
	openCustomerPortal: billing.openPortal,
	check: (c, args) => check(c, args, true),
	track,
	refetch: (c) => said(c, c.say.react.refetch, {}),
	createEntity: entities.create,
	createReferralCode: referrals.createCode,
	redeemReferralCode: referrals.redeemCode,
	redeemCode: referrals.redeemCode,
	listPlans: catalog.listPlans,
};
