import { D, type Doc, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { amountOf, type Ctx, detailsOf, idList, literalBool, literalString, type Params, params, restLines, type Said, said, termOf, whoOf } from "./shared";

/** The plan a call is about: `planId`, 0.x `product_id`, or several `product_ids`. */
function planOf(c: Ctx, p: Params): string {
	const ids = p.has("productIds") ? idList(c, p.take("productIds")!) : null;
	if (ids) return c.say.terms.plans({ ids });
	return termOf(c, "plan", p.take("planId") ?? p.take("productId"));
}

/** `freeTrial: { durationLength: 14, durationType: "day", cardRequired: true }`, `null`, or 0.x `free_trial: true`. */
function trialLines(c: Ctx, n: N): Doc[] {
	const { say, e } = c;
	const u = unwrap(n);
	if (u?.type === "Literal" && u.value === null) return [D(say.billing.noTrial)];
	const on = literalBool(u);
	if (on !== null) return [D(on ? say.billing.planTrial.on : say.billing.planTrial.off)];
	const t = params(u);
	const length = t.take("durationLength") ?? t.take("length");
	if (!t.node || !length) return [e.noun(n)];
	const unit = literalString(t.take("durationType") ?? t.take("duration")) ?? "day";
	const card = literalBool(t.take("cardRequired"));
	return [
		D(say.billing.trialDays({ length: e.text(length), unit })),
		card === null ? null : D(card ? say.billing.trialCard.required : say.billing.trialCard.notRequired),
		...restLines(c, t),
	].filter((x): x is Doc => !!x);
}

/** `[{ featureId: "seats", quantity: 10 }]`: one line per prepaid quantity. */
function quantityLines(c: Ctx, n: N): Doc[] {
	const u = unwrap(n);
	if (u?.type !== "ArrayExpression") return [c.e.noun(n)];
	return u.elements.map((item: N) => {
		const q = params(item);
		const quantity = q.take("quantity");
		const feature = q.take("featureId");
		const plan = q.take("licensePlanId");
		if (quantity && plan) return D(c.say.billing.licenses({ quantity: amountOf(c, quantity), plan: termOf(c, "plan", plan) }));
		if (quantity && feature) return D(c.say.billing.quantity({ quantity: amountOf(c, quantity), feature: termOf(c, "feature", feature) }));
		return c.e.noun(item);
	});
}

/** `carryOverBalances: { enabled: true, featureIds: [...] }`. */
function carryLine(c: Ctx, n: N, all: string, some: (p: { features: string }) => string): Doc | null {
	const p = params(n);
	if (!p.node) return c.e.noun(n);
	if (literalBool(p.take("enabled")) === false) return null;
	const ids = p.has("featureIds") ? idList(c, p.take("featureIds")!) : null;
	return D(ids ? some({ features: c.say.terms.features({ ids }) }) : all);
}

/** Bullet lines for the options attach, checkout, updates and previews share. */
function planOptions(c: Ctx, p: Params): Doc[] {
	const { say, e } = c;
	const out: (Doc | null)[] = [];
	const take = (k: string, f: (n: N) => Doc | Doc[] | null) => {
		const n = p.take(k);
		if (n !== undefined) out.push(...[f(n)].flat());
	};
	const customize = params(p.has("customize") ? p.take("customize") : undefined);
	take("featureQuantities", (n) => quantityLines(c, n));
	take("options", (n) => quantityLines(c, n));
	take("licenseQuantities", (n) => quantityLines(c, n));
	take("freeTrial", (n) => trialLines(c, n));
	if (customize.has("freeTrial")) out.push(...trialLines(c, customize.take("freeTrial")!));
	if (customize.node && customize.rest().length) out.push(D(say.billing.customize));
	take("version", (n) => D(say.billing.version({ version: e.text(n) })));
	take("prorationBehavior", (n) => {
		const v = literalString(n);
		return v && v in say.billing.proration ? D(say.billing.proration[v as keyof typeof say.billing.proration]) : e.objectProp(p.prop("prorationBehavior"));
	});
	take("prorate", (n) => (literalBool(n) === false ? D(say.billing.prorateOff) : null));
	take("redirectMode", (n) => {
		const v = literalString(n);
		return v && v in say.billing.redirect ? D(say.billing.redirect[v as keyof typeof say.billing.redirect]) : e.objectProp(p.prop("redirectMode"));
	});
	take("successUrl", (n) => D(say.billing.successUrl({ url: e.text(n) })));
	take("returnUrl", (n) => D(say.billing.returnUrl({ url: e.text(n) })));
	take("invoiceMode", (n) => (literalBool(params(n).take("enabled")) === false ? null : D(say.billing.invoice)));
	take("invoice", (n) => (literalBool(n) === true ? D(say.billing.invoice) : null));
	take("forceCheckout", (n) => (literalBool(n) === true ? D(say.billing.forceCheckout) : null));
	take("reward", (n) => D(say.billing.reward({ reward: e.text(n) })));
	take("discounts", (n) => {
		const u = unwrap(n);
		if (u?.type !== "ArrayExpression") return e.noun(n);
		return u.elements.map((d: N) => {
			const q = params(d);
			const reward = q.take("rewardId");
			const code = q.take("promotionCode");
			if (reward) return D(say.billing.reward({ reward: e.text(reward) }));
			if (code) return D(say.billing.promotionCode({ code: e.text(code) }));
			return e.noun(d);
		});
	});
	take("carryOverBalances", (n) => carryLine(c, n, say.billing.carryBalances, say.billing.carryBalancesOf));
	take("carryOverUsages", (n) => carryLine(c, n, say.billing.carryUsage, say.billing.carryUsageOf));
	take("newBillingSubscription", (n) => (literalBool(n) === true ? D(say.billing.newSubscription) : null));
	take("startsAt", (n) => D(say.billing.startsAt({ time: e.text(n) })));
	take("endsAt", (n) => D(say.billing.endsAt({ time: e.text(n) })));
	take("removePlanIds", (n) => {
		const ids = idList(c, n);
		return D(say.billing.removePlans({ plans: ids ? say.terms.plans({ ids }) : e.text(n) }));
	});
	take("openInNewTab", (n) => (literalBool(n) === true ? D(say.billing.openInNewTab) : null));
	take("dialog", (n) => D(say.billing.checkoutDialog({ dialog: e.text(n) })));
	take("checkoutSessionParams", (n) => D(say.billing.checkoutSettings({ value: e.text(n) })));
	take("customerData", (n) => D(say.track.customerData({ value: detailsOf(c, n) })));
	take("entityData", (n) => D(say.track.entityData({ value: detailsOf(c, n) })));
	return [...out.filter((x): x is Doc => !!x), ...restLines(c, p)];
}

const who = (c: Ctx, p: Params) => whoOf(c, p.take("customerId"), p.take("entityId"));

type PlanOp = Ctx["say"]["billing"]["attach"];

/** One plan for one customer, plus the options: attach, checkout, the previews and plain updates. */
const planCall =
	(pick: (say: Ctx["say"]) => PlanOp) =>
	(c: Ctx, args: N[]): Said => {
		const p = params(args[0]);
		const w = who(c, p);
		return said(c, pick(c.say), { plan: planOf(c, p), who: w }, planOptions(c, p));
	};

export const attach = planCall((s) => s.billing.attach);
export const previewAttach = planCall((s) => s.billing.previewAttach);
export const checkout = planCall((s) => s.billing.checkout);
export const previewUpdate = planCall((s) => s.billing.previewUpdate);

/** `billing.update({ planId, cancelAction })`: a cancellation, an undone cancellation, or a change of quantities and options. */
export function update(c: Ctx, args: N[]): Said {
	const { say } = c;
	const p = params(args[0]);
	const w = who(c, p);
	const plan = planOf(c, p);
	const action = literalString(p.has("cancelAction") ? p.take("cancelAction") : undefined);
	const op =
		action === "cancel_end_of_cycle"
			? say.billing.cancelEnd
			: action === "cancel_immediately"
				? say.billing.cancelNow
				: action === "uncancel"
					? say.billing.uncancel
					: say.billing.update;
	return said(c, op, { plan, who: w }, planOptions(c, p));
}

/** 0.x `cancel({ customer_id, product_id, cancel_immediately })`: at the end of the cycle unless told otherwise. */
export function cancel(c: Ctx, args: N[]): Said {
	const p = params(args[0]);
	const w = who(c, p);
	const now = literalBool(p.take("cancelImmediately")) === true;
	return said(c, now ? c.say.billing.cancelNow : c.say.billing.cancelEnd, { plan: planOf(c, p), who: w }, planOptions(c, p));
}

/** `billing.multiAttach({ customerId, plans: [{ planId }, …] })`. */
const plansCall =
	(pick: (say: Ctx["say"]) => Ctx["say"]["billing"]["multiAttach"]) =>
	(c: Ctx, args: N[]): Said => {
		const p = params(args[0]);
		const w = who(c, p);
		const list = unwrap(p.take("plans"));
		const ids = list?.type === "ArrayExpression" ? list.elements.map((x: N) => literalString(params(x).take("planId") ?? params(x).take("productId"))) : [];
		const plans =
			ids.length && ids.every((x: string | null) => x !== null)
				? c.say.terms.plans({ ids: c.e.g.list(ids.map((x: string) => mk("l", x, JSON.stringify(x)))) })
				: list
					? c.e.text(list)
					: c.say.terms.plan.it;
		return said(c, pick(c.say), { plans, who: w }, planOptions(c, p));
	};

export const multiAttach = plansCall((s) => s.billing.multiAttach);
export const previewMultiAttach = plansCall((s) => s.billing.previewMultiAttach);

/** A call about one customer and nothing else in its headline: the portal, payment setup, schedules, verify, import. */
const customerCall =
	(pick: (say: Ctx["say"]) => Ctx["say"]["billing"]["portal"]) =>
	(c: Ctx, args: N[]): Said => {
		const first = unwrap(args[0]);
		// 0.x `customers.billingPortal(id, { return_url })` and the 1.x object form.
		const p = params(first?.type === "ObjectExpression" ? first : args[1]);
		const w = first?.type === "ObjectExpression" ? who(c, p) : whoOf(c, first ?? undefined, undefined);
		const plan = p.take("planId") ?? p.take("productId");
		return said(c, pick(c.say), { who: w }, [plan ? D(c.say.billing.thenAttach({ plan: termOf(c, "plan", plan) })) : null, ...planOptions(c, p)]);
	};

export const portal = customerCall((s) => s.billing.portal);
export const openPortal = customerCall((s) => s.billing.openPortal);
export const setupPayment = customerCall((s) => s.billing.setupPayment);
export const schedule = customerCall((s) => s.billing.schedule);
export const verify = customerCall((s) => s.billing.verify);
export const importCustomer = customerCall((s) => s.billing.import);
export const multiUpdate = customerCall((s) => s.billing.multiUpdate);
