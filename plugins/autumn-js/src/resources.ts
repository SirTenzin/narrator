import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, literalBool, literalString, type Params, params, restLines, type Said, said, termOf, whoOf } from "./shared";

/** 0.x passes the ID first (`customers.get(id, params)`); 1.x passes one object (`customers.get({ customerId })`). */
function split(args: N[], idKey: string): { id: N | undefined; p: Params } {
	if (unwrap(args[0])?.type === "ObjectExpression") {
		const p = params(args[0]);
		return { id: p.take(idKey), p };
	}
	return { id: args[0], p: params(args[1]) };
}

/** `expand: ["invoices", "trials_used"]` -> "their invoices and the free trials they've used". */
export function expandItems(c: Ctx, n: N): string {
	const { say, e } = c;
	const u = unwrap(n);
	const items = u?.type === "ArrayExpression" ? u.elements.map((x: N) => literalString(x)) : [];
	if (!items.length || items.some((x: string | null) => x === null)) return e.text(n);
	return e.g.list(items.map((x: string) => say.customers.expandItems[x] ?? e.lex.humanize(x)));
}

const INTERVALS = ["minute", "hour", "day", "week", "month", "year"] as const;

/** One billing control: overage, spend limit, usage limit, usage alert or auto top-up. */
function controlLine(c: Ctx, kind: string, item: N): Doc {
	const { say, e } = c;
	const q = params(item);
	const feature = termOf(c, "feature", q.take("featureId"));
	const enabled = literalBool(q.take("enabled"));
	const k = say.controls;
	const text = (() => {
		if (kind === "overageAllowed") return enabled === false ? k.overageOff({ feature }) : k.overageOn({ feature });
		if (kind === "spendLimits") {
			if (enabled === false) return k.spendLimitOff({ feature });
			const limit = q.take("overageLimit");
			if (literalBool(q.take("skipOverageBilling")) === true && !limit) return k.spendNoOverageBill({ feature });
			return limit ? k.spendLimit({ feature, limit: e.text(limit) }) : null;
		}
		if (kind === "usageLimits") {
			const limit = q.take("limit");
			const interval = literalString(q.take("interval"));
			if (!limit || !interval || !(INTERVALS as readonly string[]).includes(interval)) return null;
			return k.usageLimit({ feature, limit: e.text(limit), interval: k.perInterval[interval as (typeof INTERVALS)[number]] });
		}
		if (kind === "usageAlerts") {
			const threshold = q.take("threshold");
			if (!threshold) return null;
			const percent = literalString(q.take("thresholdType")) === "usage_percentage";
			const alert = (percent ? k.usageAlertPercent : k.usageAlert)({ feature, threshold: e.text(threshold) });
			const name = q.take("name");
			return name ? k.alertName({ alert, name: e.text(name) }) : alert;
		}
		if (kind === "autoTopups") {
			if (enabled === false) return k.autoTopupOff({ feature });
			const quantity = q.take("quantity");
			const threshold = q.take("threshold");
			return quantity && threshold ? k.autoTopup({ feature, quantity: e.text(quantity), threshold: e.text(threshold) }) : null;
		}
		return null;
	})();
	if (text === null) return e.noun(item);
	return D(
		text,
		restLines(c, q).flatMap((l) => e.bullet(l)),
	);
}

/** `billingControls: { spendLimits: [...], usageAlerts: [...] }` as one bullet per control. */
function controlsLine(c: Ctx, n: N): Doc {
	const p = params(n);
	if (!p.node) return D(c.say.controls.heading, c.e.bullet(c.e.noun(n)));
	const lines = p.rest().flatMap((prop: N): Doc[] => {
		const kind = prop.type === "Property" && !prop.computed ? (prop.key.name ?? String(prop.key.value)) : "";
		const list = unwrap(prop.value);
		if (list?.type !== "ArrayExpression") return [prop.type === "SpreadElement" ? c.e.noun(prop) : c.e.objectProp(prop)];
		return list.elements.map((item: N) => controlLine(c, kind, item));
	});
	return D(
		c.say.controls.heading,
		lines.flatMap((l) => c.e.bullet(l)),
	);
}

/** Customer and entity fields: name, email, fingerprint, Stripe link, expand, billing controls. */
function fieldLines(c: Ctx, p: Params): Doc[] {
	const { say, e } = c;
	const out: (Doc | null)[] = [];
	const take = (k: string, f: (n: N) => Doc | null) => {
		const n = p.take(k);
		if (n !== undefined) out.push(f(n));
	};
	take("name", (n) => D(say.customers.name({ value: e.text(n) })));
	take("email", (n) => D(say.customers.email({ value: e.text(n) })));
	take("fingerprint", (n) => D(say.customers.fingerprint({ value: e.text(n) })));
	take("createInStripe", (n) => (literalBool(n) === true ? D(say.customers.createInStripe) : null));
	take("stripeId", (n) => D(say.customers.stripeId({ value: e.text(n) })));
	take("autoEnablePlanId", (n) => D(say.customers.autoEnable({ plan: termOf(c, "plan", n) })));
	take("expand", (n) => D(say.customers.expand({ items: expandItems(c, n) })));
	take("metadata", (n) => D(say.customers.metadata({ value: e.text(n) })));
	take("billingControls", (n) => controlsLine(c, n));
	take("deleteInStripe", (n) => (literalBool(n) === true ? D(say.customers.deleteInStripe) : null));
	take("limit", (n) => D(say.customers.pageSize({ count: e.text(n) })));
	take("offset", (n) => (n && e.text(n) !== "0" ? D(say.customers.offset({ count: e.text(n) })) : null));
	return [...out.filter((x): x is Doc => !!x), ...restLines(c, p)];
}

const customerOp =
	(pick: (s: Ctx["say"]) => Ctx["say"]["customers"]["get"], idKey = "customerId") =>
	(c: Ctx, args: N[]): Said => {
		const { id, p } = split(args, idKey);
		// 0.x `customers.create({ id })` names the customer `id`.
		const customer = id ?? p.take("id");
		return said(c, pick(c.say), { who: whoOf(c, customer, undefined) }, fieldLines(c, p));
	};

const listOp =
	(pick: (s: Ctx["say"]) => Ctx["say"]["customers"]["list"]) =>
	(c: Ctx, args: N[]): Said =>
		said(c, pick(c.say), {}, fieldLines(c, params(args[0])));

export const customers = {
	getOrCreate: customerOp((s) => s.customers.getOrCreate),
	get: customerOp((s) => s.customers.get),
	update: customerOp((s) => s.customers.update),
	delete: customerOp((s) => s.customers.delete),
	list: listOp((s) => s.customers.list),
	listSubscriptions: listOp((s) => s.customers.listSubscriptions),
	listPurchases: listOp((s) => s.customers.listPurchases),
	advanceTestClock: (c: Ctx, args: N[]): Said => {
		const p = params(args[0]);
		const who = whoOf(c, p.take("customerId"), undefined);
		const time = p.take("advanceTo") ?? p.take("frozenTime");
		return said(c, c.say.customers.advanceTestClock, { who, time: time ? c.e.text(time) : "" }, fieldLines(c, p));
	},
};

/** 1.x `entities.create({ customerId, entityId, featureId, name })`, 0.x `entities.create(customerId, { id, feature_id } | [...])`. */
function createEntity(c: Ctx, args: N[]): Said {
	const { say } = c;
	// The React hooks pass the entity (or a list of them) without a customer.
	const first = unwrap(args[0])?.type;
	const own = first === "ObjectExpression" || first === "ArrayExpression";
	const customer = own ? undefined : args[0];
	const body = own ? args[0] : args[1];
	if (unwrap(body)?.type === "ArrayExpression")
		return said(
			c,
			say.entities.createMany,
			{ who: whoOf(c, customer, undefined) },
			unwrap(body).elements.map((x: N) => c.e.noun(x)),
		);
	const p = params(body);
	const who = whoOf(c, customer ?? p.take("customerId"), undefined);
	const entity = termOf(c, "entity", p.take("entityId") ?? p.take("id"));
	const feature = termOf(c, "feature", p.take("featureId"));
	const name = p.take("name");
	return said(c, say.entities.create, { entity, who, feature }, [name ? D(say.entities.name({ value: c.e.text(name) })) : null, ...fieldLines(c, p)]);
}

/** `entities.get|update|delete`: `({ customerId, entityId })` or 0.x `(customerId, entityId, params)`. */
const entityOp =
	(pick: (s: Ctx["say"]) => Ctx["say"]["entities"]["get"]) =>
	(c: Ctx, args: N[]): Said => {
		const objectForm = unwrap(args[0])?.type === "ObjectExpression";
		const p = params(objectForm ? args[0] : args[2]);
		const customer = objectForm ? p.take("customerId") : args[0];
		const entityNode = objectForm ? p.take("entityId") : args[1];
		const entity = customer
			? c.say.terms.entityOf({ entity: termOf(c, "entity", entityNode), customer: whoOf(c, customer, undefined) })
			: termOf(c, "entity", entityNode);
		return said(c, pick(c.say), { entity }, fieldLines(c, p));
	};

export const entities = {
	create: createEntity,
	get: entityOp((s) => s.entities.get),
	update: entityOp((s) => s.entities.update),
	delete: entityOp((s) => s.entities.delete),
	list: listOp((s) => s.entities.list),
	transfer: (c: Ctx, args: N[]): Said => said(c, c.say.entities.transfer, { who: whoOf(c, args[0], undefined) }, restLines(c, params(args[1]))),
};

/** Plan fields: name, price, add-on, auto-enable, items. Amounts are in major units, as Autumn stores them. */
function planLines(c: Ctx, p: Params): Doc[] {
	const { say, e } = c;
	const out: (Doc | null)[] = [];
	const name = p.take("name");
	if (name) out.push(D(say.catalog.name({ value: e.text(name) })));
	const price = p.take("price");
	if (price) {
		const q = params(price);
		const amount = q.take("amount");
		const interval = q.take("interval");
		const once = literalString(interval) === "one_off";
		out.push(
			!amount
				? e.noun(price)
				: once || !interval
					? D(say.catalog.oneOffPrice({ amount: e.text(amount) }))
					: D(say.catalog.price({ amount: e.text(amount), interval: literalString(interval) ?? e.text(interval) })),
		);
	}
	if (literalBool(p.take("addOn") ?? p.take("isAddOn")) === true) out.push(D(say.catalog.addOn));
	if (literalBool(p.take("autoEnable") ?? p.take("isDefault")) === true) out.push(D(say.catalog.autoEnable));
	const items = unwrap(p.take("items"));
	if (items?.type === "ArrayExpression") out.push(D(say.catalog.items({ count: String(items.elements.length) })));
	return [...out.filter((x): x is Doc => !!x), ...restLines(c, p)];
}

/** Feature fields: name, type, consumable. */
function featureLines(c: Ctx, p: Params): Doc[] {
	const { say, e } = c;
	const out: Doc[] = [];
	const name = p.take("name");
	if (name) out.push(D(say.catalog.name({ value: e.text(name) })));
	const type = literalString(p.take("type"));
	if (type && type in say.catalog.featureType) out.push(D(say.catalog.featureType[type as keyof typeof say.catalog.featureType]));
	const consumable = literalBool(p.take("consumable"));
	if (consumable !== null) out.push(D(consumable ? say.catalog.consumable.on : say.catalog.consumable.off));
	return [...out, ...restLines(c, p)];
}

const planOp =
	(pick: (s: Ctx["say"]) => Ctx["say"]["catalog"]["getPlan"]) =>
	(c: Ctx, args: N[]): Said => {
		const { id, p } = split(args, "planId");
		return said(c, pick(c.say), { plan: termOf(c, "plan", id ?? p.take("productId") ?? p.take("id")) }, planLines(c, p));
	};

const featureOp =
	(pick: (s: Ctx["say"]) => Ctx["say"]["catalog"]["getFeature"]) =>
	(c: Ctx, args: N[]): Said => {
		const { id, p } = split(args, "featureId");
		return said(c, pick(c.say), { feature: termOf(c, "feature", id ?? p.take("id")) }, featureLines(c, p));
	};

export const catalog = {
	getPlan: planOp((s) => s.catalog.getPlan),
	createPlan: planOp((s) => s.catalog.createPlan),
	updatePlan: planOp((s) => s.catalog.updatePlan),
	deletePlan: planOp((s) => s.catalog.deletePlan),
	listPlans: (c: Ctx, args: N[]): Said => {
		const p = params(args[0]);
		const customer = p.take("customerId");
		if (customer) return said(c, c.say.catalog.listPlansFor, { who: whoOf(c, customer, p.take("entityId")) }, restLines(c, p));
		return said(c, c.say.catalog.listPlans, {}, restLines(c, p));
	},
	getFeature: featureOp((s) => s.catalog.getFeature),
	createFeature: featureOp((s) => s.catalog.createFeature),
	updateFeature: featureOp((s) => s.catalog.updateFeature),
	deleteFeature: featureOp((s) => s.catalog.deleteFeature),
	listFeatures: (c: Ctx, args: N[]): Said => said(c, c.say.catalog.listFeatures, {}, restLines(c, params(args[0]))),
};

export const referrals = {
	createCode: (c: Ctx, args: N[]): Said => {
		const p = params(args[0]);
		const program = p.take("programId");
		return said(
			c,
			c.say.referrals.createCode,
			{ who: whoOf(c, p.take("customerId"), undefined), program: c.say.referrals.program({ id: program ? c.e.text(program) : "" }) },
			restLines(c, p),
		);
	},
	redeemCode: (c: Ctx, args: N[]): Said => {
		const p = params(args[0]);
		return said(c, c.say.referrals.redeemCode, { code: termOf(c, "code", p.take("code")), who: whoOf(c, p.take("customerId"), undefined) }, restLines(c, p));
	},
	redeemReward: (c: Ctx, args: N[]): Said => {
		const p = params(args[0]);
		return said(
			c,
			c.say.referrals.redeemReward,
			{ code: termOf(c, "code", p.take("code") ?? p.take("promoCode")), who: whoOf(c, p.take("customerId"), undefined) },
			restLines(c, p),
		);
	},
};

/** `licenses.attach|release({ customerId, planId | licensePlanId, … })`. */
export const licenses = {
	attach: (c: Ctx, args: N[]): Said => {
		const p = params(args[0]);
		const who = whoOf(c, p.take("customerId"), undefined);
		return said(c, c.say.licenses.assign, { plan: termOf(c, "plan", p.take("planId") ?? p.take("licensePlanId")), who }, restLines(c, p));
	},
	release: (c: Ctx, args: N[]): Said => {
		const p = params(args[0]);
		const who = whoOf(c, p.take("customerId"), undefined);
		return said(c, c.say.licenses.release, { plan: termOf(c, "plan", p.take("licensePlanId") ?? p.take("planId")), who }, restLines(c, p));
	},
};

const GENERIC = ["create", "get", "list", "update", "delete"] as const;
/** Methods that act on many: "search Autumn request logs", "sync Autumn webhooks". */
const ON_MANY = /^(list|search|sync|previewSync|listPrograms|listTemplates|insert)$/;

/** Resources without their own wording, by method: "create an Autumn webhook", "void an Autumn invoice". */
export function generic(c: Ctx, resource: string, method: string, args: N[]): Said | null {
	const names = c.say.resources[resource];
	if (!names) return null;
	const p = params(args[0]);
	const lines = p.node ? restLines(c, p) : args.map((a) => c.e.noun(a));
	const g = c.say.generic;
	if ((GENERIC as readonly string[]).includes(method)) {
		const op = g[method as (typeof GENERIC)[number]];
		return said(c, op, { resource: names.one, resources: names.many, a: names.a }, lines);
	}
	return said(c, g.other, { action: c.e.lex.humanize(method), resource: ON_MANY.test(method) ? names.many : names.a }, lines);
}
