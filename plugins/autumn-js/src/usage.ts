import { D, type Doc, mk } from "@usenarrator/core";
import type { N } from "@usenarrator/lang-ts";
import {
	amountOf,
	type Ctx,
	detailsOf,
	idList,
	literalBool,
	literalNumber,
	literalString,
	params,
	restLines,
	type Said,
	said,
	termOf,
	usesOf,
	whoOf,
} from "./shared";

/** The yes/no question a check asks: can the customer use the feature (with at least this balance), or do they have the plan. */
export function checkCondition(c: Ctx, call: N, neg = false): string {
	const { say } = c;
	const p = params(call.arguments[0]);
	const who = whoOf(c, p.take("customerId"), p.take("entityId"));
	const plan = p.take("productId");
	if (plan && !p.has("featureId")) return (neg ? say.check.lacksPlan : say.check.hasPlan)({ who, plan: termOf(c, "plan", plan) });
	const feature = termOf(c, "feature", p.take("featureId"));
	const required = p.take("requiredBalance");
	if (required && literalNumber(required) !== 1) {
		const amount = amountOf(c, required);
		return (neg ? say.check.lessThan : say.check.atLeast)({ who, feature, amount });
	}
	return (neg ? say.check.cannot : say.check.can)({ who, feature });
}

/** `autumn.check({ customerId, featureId, requiredBalance, sendEvent, lock })`, and the React hook's local check. */
export function check(c: Ctx, args: N[], local = false): Said {
	const { e, say } = c;
	const call = { arguments: args };
	const condition = checkCondition(c, call);
	const p = params(args[0]);
	const required = p.take("requiredBalance");
	const uses = usesOf(c, required).text;
	for (const k of ["customerId", "entityId", "productId", "featureId"]) p.take(k);
	const sendEvent = literalBool(p.take("sendEvent")) === true;
	const lock = params(p.take("lock"));
	const lockId = lock.take("lockId");
	lock.take("enabled");
	const expires = lock.take("expiresAt");
	let text = say.check.do({ condition });
	if (sendEvent && lockId) text = say.check.andHold({ check: text, amount: required ? amountOf(c, required) : mk("l", "1"), lock: termOf(c, "lock", lockId) });
	else if (sendEvent) text = say.check.andRecord({ check: text, uses });
	if (local) text = say.check.local({ check: text });
	const lines: (Doc | null)[] = [
		expires ? D(say.check.lockExpires({ time: e.text(expires) })) : null,
		p.has("properties") ? D(say.track.properties({ value: e.text(p.take("properties")) })) : null,
		literalBool(p.take("withPreview")) === true ? D(say.check.withPreview) : null,
		p.has("dialog") ? D(say.check.dialog({ dialog: e.text(p.take("dialog")) })) : null,
		...dataLines(c, p),
		...restLines(c, p),
	];
	return { do: text, done: say.check.done({ condition }), kids: lines.flatMap((l) => (l ? e.bullet(l) : [])) };
}

/** 0.x `customer_data` / `entity_data`: create the customer or entity on the fly. */
function dataLines(c: Ctx, p: ReturnType<typeof params>): Doc[] {
	const out: Doc[] = [];
	if (p.has("customerData")) out.push(D(c.say.track.customerData({ value: detailsOf(c, p.take("customerData")) })));
	if (p.has("entityData")) out.push(D(c.say.track.entityData({ value: detailsOf(c, p.take("entityData")) })));
	return out;
}

/** `autumn.track({ customerId, featureId | eventName, value })`: negative values give balance back. */
export function track(c: Ctx, args: N[]): Said {
	const { e, say } = c;
	const p = params(args[0]);
	const who = whoOf(c, p.take("customerId"), p.take("entityId"));
	const uses = usesOf(c, p.take("value"));
	const event = p.take("eventName");
	const op = event ? say.track.event : uses.negative ? say.track.giveBack : say.track.record;
	const phrase = event
		? { uses: uses.text, event: termOf(c, "event", event), who }
		: { uses: uses.text, feature: termOf(c, "feature", p.take("featureId")), who };
	const options = params(args[1]);
	const headers = params(options.take("headers"));
	const key = p.take("idempotencyKey") ?? headers.take("Idempotency-Key");
	const overage = literalString(p.take("overageBehavior"));
	const wait = literalBool(p.take("async"));
	return said(c, op, phrase, [
		p.has("properties") ? D(say.track.properties({ value: e.text(p.take("properties")) })) : null,
		p.has("timestamp") ? D(say.track.timestamp({ value: e.text(p.take("timestamp")) })) : null,
		overage === "overflow" || overage === "cap" ? D(say.track.overage[overage]) : null,
		wait === false ? D(say.track.wait) : wait === true ? D(say.track.queue) : null,
		key ? D(say.track.idempotencyKey({ key: e.text(key) })) : null,
		...dataLines(c, p),
		...restLines(c, p),
	]);
}

const TOKEN_FIELDS = ["cacheReadTokens", "cacheWriteTokens", "audioInputTokens", "audioOutputTokens", "reasoningTokens"] as const;

/** `autumn.trackTokens({ customerId, modelId, inputTokens, outputTokens })`: token counts priced into AI credits. */
export function trackTokens(c: Ctx, args: N[]): Said {
	const { e, say } = c;
	const p = params(args[0]);
	const who = whoOf(c, p.take("customerId"), p.take("entityId"));
	const input = p.take("inputTokens");
	const output = p.take("outputTokens");
	const literal = (n: N | undefined) => !n || literalNumber(n) !== null;
	const count = (n: N | undefined) => (n ? amountOf(c, n) : mk("l", "0"));
	const counted = literal(input) && literal(output);
	const tokens = counted ? say.track.tokenCounts({ input: count(input), output: count(output) }) : say.track.tokenUsage;
	const model = termOf(c, "model", p.take("modelId"));
	const feature = p.take("featureId");
	return said(c, say.track.tokens, { tokens, model, who }, [
		counted ? null : D(say.track.tokenField.inputTokens({ count: count(input) })),
		counted ? null : D(say.track.tokenField.outputTokens({ count: count(output) })),
		...TOKEN_FIELDS.map((k) => (p.has(k) ? D(say.track.tokenField[k]({ count: e.text(p.take(k)) })) : null)),
		feature ? D(say.track.creditFeature({ feature: termOf(c, "feature", feature) })) : null,
		p.has("properties") ? D(say.track.properties({ value: e.text(p.take("properties")) })) : null,
		...restLines(c, p),
	]);
}

export const batchTrack = (c: Ctx, args: N[]): Said => said(c, c.say.track.batch, { events: args[0] ? c.e.text(args[0]) : "" });

/** 0.x `autumn.usage({ customer_id, feature_id, value })` and `balances.update({ usage | remaining | balance })`: set, don't add. */
export function setBalance(c: Ctx, args: N[]): Said {
	const { say } = c;
	const p = params(args[0]);
	const who = whoOf(c, p.take("customerId"), p.take("entityId"));
	const feature = termOf(c, "feature", p.take("featureId"));
	const usage = p.take("usage") ?? p.take("value");
	const remaining = p.take("remaining") ?? p.take("currentBalance");
	const balance = p.take("balance");
	const lines = restLines(c, p);
	if (usage) return said(c, say.balances.setUsage, { feature, who, value: c.e.text(usage) }, lines);
	if (remaining) return said(c, say.balances.setRemaining, { feature, who, value: c.e.text(remaining) }, lines);
	if (balance) return said(c, say.balances.setBalance, { feature, who, value: c.e.text(balance) }, lines);
	return said(c, say.balances.update, { feature, who }, lines);
}

/** `balances.create({ customerId, featureId, grantedBalance | included, reset })`. */
export function grantBalance(c: Ctx, args: N[]): Said {
	const { say, e } = c;
	const p = params(args[0]);
	const who = whoOf(c, p.take("customerId"), p.take("entityId"));
	const feature = termOf(c, "feature", p.take("featureId"));
	const amount = p.take("grantedBalance") ?? p.take("included") ?? p.take("balance");
	const reset = params(p.take("reset"));
	const interval = reset.take("interval");
	const resetLine = !interval
		? null
		: literalString(interval) === "one_off"
			? D(say.balances.oneOff)
			: D(say.balances.resetsEvery({ interval: e.text(interval) }));
	const lines = [resetLine, ...restLines(c, reset), ...restLines(c, p)];
	return amount ? said(c, say.balances.grant, { amount: e.text(amount), feature, who }, lines) : said(c, say.balances.grantSome, { feature, who }, lines);
}

export function deleteBalance(c: Ctx, args: N[]): Said {
	const p = params(args[0]);
	const who = whoOf(c, p.take("customerId"), p.take("entityId"));
	return said(c, c.say.balances.remove, { feature: termOf(c, "feature", p.take("featureId")), who }, restLines(c, p));
}

export function listBalances(c: Ctx, args: N[]): Said {
	const p = params(args[0]);
	return said(c, c.say.balances.list, { who: whoOf(c, p.take("customerId"), p.take("entityId")) }, restLines(c, p));
}

/** `balances.finalize({ lockId, action: "confirm" | "release", overrideValue })`. */
export function finalize(c: Ctx, args: N[]): Said {
	const { say, e } = c;
	const p = params(args[0]);
	const lock = termOf(c, "lock", p.take("lockId"));
	const actionNode = p.take("action");
	const action = literalString(actionNode);
	const override = p.take("overrideValue");
	const lines = restLines(c, p);
	if (action === "confirm" && override) return said(c, say.balances.confirmAs, { lock, value: e.text(override) }, lines);
	if (action === "confirm") return said(c, say.balances.confirm, { lock }, lines);
	if (action === "release") return said(c, say.balances.release, { lock }, lines);
	return said(c, say.balances.finalize, { lock, action: actionNode ? e.text(actionNode) : "" }, lines);
}

/** 0.x `customers.updateBalances(id, { balances: [{ feature_id, balance }] })`. */
export function updateBalances(c: Ctx, args: N[]): Said {
	const { say, e } = c;
	const p = params(args[1]);
	const list = p.take("balances");
	const items = list?.type === "ArrayExpression" ? list.elements : [];
	const who = whoOf(c, args[0], p.take("entityId"));
	const lines = items.map((item: N) => {
		const b = params(item);
		const feature = termOf(c, "feature", b.take("featureId"));
		const value = b.take("balance");
		return value ? D(say.balances.balanceItem({ feature, value: e.text(value) })) : e.noun(item);
	});
	return said(c, say.balances.setBalances, { who }, [...lines, ...restLines(c, p)]);
}

/** `events.aggregate({ customerId, featureId, range, binSize, groupBy })` and 0.x `query`. */
export function usageQuery(c: Ctx, args: N[], kind: "aggregate" | "list"): Said {
	const { say, e } = c;
	const p = params(args[0]);
	const who = whoOf(c, p.take("customerId"), p.take("entityId"));
	const featureNode = p.take("featureId");
	const ids = featureNode ? idList(c, featureNode) : null;
	const feature = ids ? say.terms.features({ ids }) : termOf(c, "feature", featureNode);
	const rangeNode = p.take("range");
	const range = literalString(rangeNode);
	const custom = params(p.take("customRange"));
	const start = custom.take("start");
	const end = custom.take("end");
	const bin = p.take("binSize");
	const group = p.take("groupBy");
	return said(c, say.events[kind], { feature, who }, [
		rangeNode
			? D(say.events.over({ range: range && range in say.events.range ? say.events.range[range as keyof typeof say.events.range] : e.text(rangeNode) }))
			: null,
		start && end ? D(say.events.between({ start: e.text(start), end: e.text(end) })) : null,
		bin ? D(say.events.perBin({ size: literalString(bin) ?? e.text(bin) })) : null,
		group ? D(say.events.groupBy({ field: e.text(group) })) : null,
		...restLines(c, p),
	]);
}
