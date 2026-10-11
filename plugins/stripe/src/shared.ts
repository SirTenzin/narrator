import type { Doc } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import type { StripePhrases } from "./phrases";

export type Ctx = { e: Engine; say: StripePhrases };

/** First segment of every Stripe resource path, e.g. `checkout` in `stripe.checkout.sessions`. */
const ROOTS = new Set([
	"accounts",
	"accountLinks",
	"accountSessions",
	"applePayDomains",
	"applicationFees",
	"apps",
	"balance",
	"balanceTransactions",
	"billing",
	"billingPortal",
	"charges",
	"checkout",
	"climate",
	"confirmationTokens",
	"countrySpecs",
	"coupons",
	"creditNotes",
	"customers",
	"customerSessions",
	"disputes",
	"entitlements",
	"ephemeralKeys",
	"events",
	"exchangeRates",
	"files",
	"fileLinks",
	"financialConnections",
	"forwarding",
	"identity",
	"invoiceItems",
	"invoiceRenderingTemplates",
	"invoices",
	"issuing",
	"mandates",
	"paymentIntents",
	"paymentLinks",
	"paymentMethodConfigurations",
	"paymentMethodDomains",
	"paymentMethods",
	"payouts",
	"plans",
	"prices",
	"products",
	"promotionCodes",
	"quotes",
	"radar",
	"refunds",
	"reporting",
	"reviews",
	"setupAttempts",
	"setupIntents",
	"shippingRates",
	"sigma",
	"sources",
	"subscriptionItems",
	"subscriptionSchedules",
	"subscriptions",
	"tax",
	"taxCodes",
	"taxIds",
	"taxRates",
	"terminal",
	"testHelpers",
	"tokens",
	"topups",
	"transfers",
	"treasury",
	"v2",
	"webhookEndpoints",
]);

/** `stripe`, `stripeCli`, `masterStripe`, `getStripeClient`; not `stripeCustomer`, which is a Stripe object. */
const STRIPE_NAME = /stripe(cli|client|api|sdk|instance)?$/i;

/** Names this file binds to a Stripe client: `const s = new Stripe(...)` or `client: Stripe`. */
const declaredClients = new WeakMap<object, Set<string>>();

function clientNames(e: Engine): Set<string> {
	const program = e.program;
	if (!program) return new Set();
	const cached = declaredClients.get(program);
	if (cached) return cached;
	const names = new Set<string>();
	const ctor = stripeConstructorName(e);
	const visit = (n: N) => {
		if (!n || typeof n !== "object") return;
		if (Array.isArray(n)) {
			for (const x of n) visit(x);
			return;
		}
		if ((n.type === "VariableDeclarator" || n.type === "Identifier") && n.id?.type === "Identifier" && isNewStripe(n.init, ctor)) names.add(n.id.name);
		const ann = n.type === "Identifier" ? n.typeAnnotation?.typeAnnotation : n.type === "VariableDeclarator" ? n.id?.typeAnnotation?.typeAnnotation : null;
		if (ann?.type === "TSTypeReference" && ann.typeName?.type === "Identifier" && ann.typeName.name === ctor) {
			const name = n.type === "Identifier" ? n.name : n.id?.name;
			if (name) names.add(name);
		}
		for (const k in n) if (k !== "parent" && n[k] && typeof n[k] === "object") visit(n[k]);
	};
	visit(program.body);
	declaredClients.set(program, names);
	return names;
}

/** The local name of the `stripe` default export (usually `Stripe`). */
export function stripeConstructorName(e: Engine): string {
	for (const [local, { from, name }] of e.imports) if (from === "stripe" && (name === "default" || name === "Stripe" || name === "*")) return local;
	return "Stripe";
}

const isNewStripe = (n: N, ctor: string) => {
	const u = unwrap(n);
	return (u?.type === "NewExpression" || u?.type === "CallExpression") && unwrap(u.callee)?.type === "Identifier" && unwrap(u.callee).name === ctor;
};

/** The receiver is a Stripe client: `stripe`, `ctx.stripeCli`, `this.stripe`, `getStripe()`, the `Stripe` class, or a local `new Stripe(...)`. */
export function isClient(e: Engine, n: N): boolean {
	const u = unwrap(n);
	if (!u) return false;
	if (u.type === "Identifier") return STRIPE_NAME.test(u.name) || clientNames(e).has(u.name);
	if (u.type === "MemberExpression" && !u.computed) return STRIPE_NAME.test(u.property.name);
	if (u.type === "CallExpression") {
		const c = unwrap(u.callee);
		const name = c?.type === "Identifier" ? c.name : c?.type === "MemberExpression" && !c.computed ? c.property.name : "";
		return STRIPE_NAME.test(name);
	}
	return u.type === "NewExpression" && isNewStripe(u, stripeConstructorName(e));
}

export const active = (e: Engine) => e.usesLibrary("stripe");

export type StripeCall = { client: N; path: string[]; method: string };

/** `ctx.stripeCli.checkout.sessions.create(...)` -> client `ctx.stripeCli`, path `checkout.sessions`, method `create`. */
export function stripeCall(e: Engine, node: N): StripeCall | null {
	const u = unwrap(node);
	if (u?.type !== "CallExpression" || !active(e)) return null;
	const segs: { name: string; obj: N }[] = [];
	let cur = unwrap(u.callee);
	while (cur?.type === "MemberExpression" && !cur.computed) {
		segs.unshift({ name: cur.property.name, obj: cur.object });
		cur = unwrap(cur.object);
	}
	for (let i = 0; i < segs.length - 1; i++) {
		if (!ROOTS.has(segs[i]!.name) || !isClient(e, segs[i]!.obj)) continue;
		return { client: segs[i]!.obj, path: segs.slice(i, -1).map((s) => s.name), method: segs.at(-1)!.name };
	}
	return null;
}

export const keyName = (p: N): string | null => {
	if (p?.type !== "Property" || p.computed) return null;
	if (p.key.type === "Identifier") return p.key.name;
	if (p.key.type === "Literal") return String(p.key.value);
	return null;
};

export const literalString = (n: N): string | null => {
	const u = unwrap(n);
	if (u?.type === "Literal" && typeof u.value === "string") return u.value;
	if (u?.type === "TemplateLiteral" && !u.expressions.length) return u.quasis[0].value.cooked;
	return null;
};

export const literalValue = (n: N): unknown => {
	const u = unwrap(n);
	return u?.type === "Literal" ? u.value : undefined;
};

export const isObject = (n: N) => unwrap(n)?.type === "ObjectExpression";

export const isFn = (n: N) => ["ArrowFunctionExpression", "FunctionExpression"].includes(unwrap(n)?.type);

/** Joins docs into one phrase, keeping their block lines. */
export const kidsOf = (...docs: (Doc | null | undefined)[]) => docs.flatMap((d) => d?.kids ?? []);
