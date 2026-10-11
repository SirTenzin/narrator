import { capFirst, D, type Doc } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import { active, type Ctx, isClient, literalString } from "./shared";

/** `stripe.webhooks.constructEvent(...)`: the call's receiver is a client's `webhooks`. */
const onWebhooks = (e: Engine, obj: N | null) => {
	const o = unwrap(obj);
	return active(e) && o?.type === "MemberExpression" && !o.computed && o.property.name === "webhooks" && isClient(e, o.object);
};

/** `constructEvent(payload, signature, secret)`: parse a webhook body after checking its signature. */
export function constructEventDoc(c: Ctx, { obj, args, stmt }: { obj: N | null; args: N[]; stmt: boolean }): Doc | null {
	const { e, say } = c;
	if (!onWebhooks(e, obj) || args.length < 3) return null;
	const [payload, signature, secret] = args.slice(0, 3).map((a) => e.text(a)) as [string, string, string];
	return D((stmt ? say.webhooks.verify : say.webhooks.event)({ payload, signature, secret }));
}

export function testHeaderDoc(c: Ctx, { obj, args }: { obj: N | null; args: N[] }): Doc | null {
	const { e, say } = c;
	const o = unwrap(args[0]);
	if (!onWebhooks(e, obj) || o?.type !== "ObjectExpression") return null;
	const get = (k: string) => o.properties.find((p: N) => p.key?.name === k)?.value;
	if (!get("payload") || !get("secret")) return null;
	return D(say.webhooks.testHeader({ payload: e.text(get("payload")), secret: e.text(get("secret")) }));
}

const EVENT_NAME = /^[a-z_]+(\.[a-z_]+)+$/;
const EVENT_OBJECTS = new Set([
	"account",
	"application_fee",
	"balance",
	"billing",
	"billing_portal",
	"charge",
	"checkout",
	"coupon",
	"credit_note",
	"customer",
	"customer_cash_balance_transaction",
	"entitlements",
	"file",
	"invoice",
	"invoiceitem",
	"payment_intent",
	"payment_link",
	"payment_method",
	"payout",
	"plan",
	"price",
	"product",
	"promotion_code",
	"quote",
	"radar",
	"refund",
	"setup_intent",
	"subscription_schedule",
	"tax_rate",
	"test_helpers",
	"transfer",
]);

/** `switch (event.type)` over Stripe event names. */
function eventSwitch(e: Engine, n: N): N | null {
	if (n.type !== "SwitchStatement" || !active(e)) return null;
	const d = unwrap(n.discriminant);
	if (d?.type !== "MemberExpression" || d.computed || d.property.name !== "type") return null;
	const tests = n.cases.filter((x: N) => x.test).map((x: N) => literalString(x.test));
	if (!tests.length || tests.some((t: string | null) => !t || !EVENT_NAME.test(t))) return null;
	if (!tests.some((t: string) => EVENT_OBJECTS.has(t.split(".")[0]!))) return null;
	return d.object;
}

/** `"customer.subscription.trial_will_end"` -> "a free trial ends in three days", or worded from its parts. */
export function eventMeaning(c: Ctx, name: string): string {
	const known = c.say.events[name];
	if (known && Object.hasOwn(c.say.events, name)) return known;
	const parts = name.split(".");
	const object = parts.slice(0, -1).filter((p, i, all) => !(p === "test_helpers" || (p === "customer" && i < all.length - 1)));
	const words = (s: string) => s.replace(/_/g, " ");
	return c.say.eventParts({ object: words(object.at(-1) ?? parts[0]!), happening: words(parts.at(-1)!) });
}

/** Webhook handlers: each case names the event and what happened, so the reader doesn't need Stripe's catalogue. */
export function eventSwitchStmt(c: Ctx, n: N, d: number): boolean {
	const { e, say } = c;
	const event = eventSwitch(e, n);
	if (!event) return false;
	const ev = e.noun(event);
	e.emitDoc(d, D(`${say.webhooks.switch({ event: ev.t })}:`, ev.kids), n);
	let pending: string[] = [];
	for (const k of n.cases) {
		if (k.test) {
			const name = literalString(k.test)!;
			pending.push(say.webhooks.eventName({ name: e.text(k.test), meaning: eventMeaning(c, name) }));
		}
		if (!k.consequent.length) continue;
		const names = e.g.list(pending, "or");
		const label = k.test ? say.webhooks.case({ names }) : pending.length ? say.webhooks.casesOrOtherwise({ names }) : say.webhooks.otherwise;
		pending = [];
		e.emit(d + 1, `• ${capFirst(label)}:`, k, "bullet");
		const stmts = k.consequent.length === 1 && k.consequent[0].type === "BlockStatement" ? k.consequent[0].body : k.consequent;
		for (const st of stmts) if (!(st.type === "BreakStatement" && !st.label)) e.stmt(st, d + 2);
	}
	return true;
}

const EVENT_VAR = /event|evt/i;

/** `event.data.object` / `event.data.previous_attributes` on something named like an event. */
export function eventDataDoc(c: Ctx, { obj, prop }: { obj: N; prop: string }): Doc | null {
	const { e, say } = c;
	const data = unwrap(obj);
	if (!active(e) || data?.type !== "MemberExpression" || data.computed || data.property.name !== "data") return null;
	const owner = unwrap(data.object);
	const name = owner?.type === "Identifier" ? owner.name : owner?.type === "MemberExpression" && !owner.computed ? owner.property.name : "";
	if (!EVENT_VAR.test(name)) return null;
	const ev = e.noun(owner);
	const phrase = prop === "object" ? say.webhooks.eventObject : say.webhooks.previousAttributes;
	return D(phrase({ event: ev.t }), ev.kids);
}
