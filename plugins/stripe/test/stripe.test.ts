import { describe, expect, test } from "bun:test";
import { narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { en, stripe } from "../src";

const IMPORT = `import Stripe from "stripe";\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);\n`;

/** Narrates a snippet (with the Stripe import) and asserts nothing fell back to raw code. */
const say = (code: string, plugins = [stripe()]) => {
	const { text, fallbacks } = narrateWithStats(IMPORT + code, { plugins });
	expect(fallbacks).toBe(0);
	return text.split("\n").slice(1).join("\n").replace(/^\n+/, "");
};

describe("resource calls", () => {
	test("creating a subscription names the customer, price and quantity", () => {
		expect(
			say(`await stripe.subscriptions.create({
  customer: customerId,
  items: [{ price: "price_123", quantity: 2 }],
  trial_period_days: 14,
  payment_behavior: "default_incomplete",
  expand: ["latest_invoice.payment_intent"],
}, { idempotencyKey: key });`),
		).toBe(
			[
				`Create a Stripe subscription for the customer customer ID with the price "price_123" (quantity 2):`,
				"  • with a 14-day free trial",
				`  • payment behavior: "default_incomplete"`,
				"  • also loading latest invoice's payment intent in full",
				"  • idempotency key key, so a retry won't do it twice",
			].join("\n"),
		);
	});

	test("amounts are explained in the currency's smallest unit", () => {
		expect(say(`const pi = await stripe.paymentIntents.create({ amount: 1999, currency: "usd", customer: customerId });`)).toBe(
			"Let pi be a new Stripe payment intent for 1999 (cents) in USD for the customer customer ID.",
		);
		expect(say(`await stripe.paymentIntents.create({ amount: 500, currency: "jpy" });`)).toBe(
			"Create a Stripe payment intent for 500 (yen, which has no smaller unit) in JPY.",
		);
		expect(say(`await stripe.paymentIntents.create({ amount: total, currency });`)).toContain("for total (in the currency's smallest unit, like cents)");
	});

	test("prices read with their billing interval", () => {
		expect(
			say(
				`const price = await stripe.prices.create({ unit_amount: 2000, currency: "gbp", recurring: { interval: "month", interval_count: 3 }, product: "prod_123" });`,
			),
		).toBe(`Let price be a new Stripe price for 2000 (pence) in GBP billed every 3 months for the product "prod_123".`);
		expect(say(`await stripe.prices.create({ unit_amount: 999, currency: "usd", recurring: { interval: "year" }, product: productId });`)).toBe(
			"Create a Stripe price for 999 (cents) in USD billed yearly for the product product ID.",
		);
	});

	test("updates and lifecycle actions name the object they act on", () => {
		expect(say(`await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true, proration_behavior: "none" });`)).toBe(
			["Update the subscription:", "  • set to cancel at the end of the current billing period", "  • without prorating the change"].join("\n"),
		);
		expect(say(`await stripe.subscriptions.cancel(subscriptionId);`)).toBe("Cancel the Stripe subscription with ID subscription ID.");
		expect(say(`await stripe.invoices.pay(invoiceId, { paid_out_of_band: true });`)).toBe(
			["Pay the Stripe invoice with ID invoice ID:", "  • paid out of band"].join("\n"),
		);
		expect(say(`await stripe.customers.del("cus_123");`)).toBe(`Delete the Stripe customer "cus_123".`);
		expect(say(`const voided = await stripe.invoices.voidInvoice(invoice.id);`)).toBe("Let voided be the invoice, voided.");
	});

	test("fetching an object the code already holds reads as its current state", () => {
		expect(say(`const fresh = await stripe.subscriptions.retrieve(subscription.id, { expand: ["discounts.coupon"] });`)).toBe(
			["Let fresh be the current state of the subscription:", "  • also loading discounts' coupon in full"].join("\n"),
		);
		expect(say(`const product = await stripe.products.retrieve(productId);`)).toBe("Let product be the Stripe product with ID product ID.");
	});

	test("checkout sessions, coupons and nested resources", () => {
		const text = say(`const session = await stripe.checkout.sessions.create({
  mode: "subscription",
  customer: customerId,
  line_items: [{ price: priceId, quantity: 1 }],
  success_url: "https://example.com/success",
});`);
		expect(text).toBe(
			[
				"Let session be a new Stripe Checkout session to start a subscription for the customer customer ID with the price price ID (quantity 1):",
				`  • success URL: "https://example.com/success"`,
			].join("\n"),
		);
		expect(say(`await stripe.coupons.create({ percent_off: 25, duration: "repeating", duration_in_months: 3 });`)).toBe(
			["Create a Stripe coupon:", "  • 25 percent off", "  • applied for 3 months"].join("\n"),
		);
		expect(say(`const clock = await stripe.testHelpers.testClocks.create({ frozen_time: start });`)).toBe(
			["Let clock be a new Stripe test clock:", "  • frozen time: start (Unix time in seconds)"].join("\n"),
		);
		expect(say(`const balance = await stripe.balance.retrieve();`)).toBe("Let balance be the Stripe account balance.");
	});

	test("inline prices become a block", () => {
		const text = say(
			`await stripe.subscriptions.create({ customer: c, items: [{ price_data: { currency: "eur", product: p, unit_amount: 500, recurring: { interval: "month" } } }] });`,
		);
		expect(text).toBe(
			[
				"Create a Stripe subscription for the customer c:",
				"  • items:",
				"    • an inline price:",
				`      • currency: EUR`,
				"      • for the product p",
				"      • unit amount: 500 (cents)",
				"      • billed monthly",
			].join("\n"),
		);
	});

	test("request options: connected accounts and the pre-v22 (id, options) form", () => {
		expect(say(`await stripe.customers.retrieve(id, { stripeAccount: account });`)).toBe(
			"Fetch the Stripe customer with ID ID on the connected account account.",
		);
		expect(say(`await stripe.refunds.create({ payment_intent: pi }, { idempotencyKey: \`refund-\${pi}\` });`)).toContain(
			`idempotency key "refund-{pi}", so a retry won't do it twice`,
		);
	});
});

describe("lists and pagination", () => {
	test("one page", () => {
		expect(say(`const invoices = await stripe.invoices.list({ customer: customerId, limit: 10, starting_after: cursor });`)).toBe(
			["Let invoices be a page of Stripe invoices for the customer customer ID:", "  • up to 10 per page", "  • starting after cursor"].join("\n"),
		);
		expect(say(`const found = await stripe.customers.search({ query: "email:'jenny@example.com'" });`)).toBe(
			`Let found be a page of Stripe customers found by search matching the search "email:'jenny@example.com'".`,
		);
	});

	test("for await walks every page", () => {
		expect(say(`for await (const customer of stripe.customers.list({ limit: 100 })) { await sync(customer); }`)).toBe(
			["For each customer in all Stripe customers, fetched page by page (up to 100 per page):", "  Sync (customer)."].join("\n"),
		);
		expect(say(`for await (const line of stripe.invoices.listLineItems(invoiceId)) { total += line.amount; }`)).toContain(
			"For each line in all the line items of the Stripe invoice with ID invoice ID, fetched page by page:",
		);
	});

	test("autoPagingEach and autoPagingToArray", () => {
		expect(say(`await stripe.customers.list().autoPagingEach(async (customer) => { await sync(customer); });`)).toBe(
			["For each customer in all Stripe customers, fetched page by page:", "  Sync (customer)."].join("\n"),
		);
		expect(say(`const all = await stripe.invoices.list({ status: "open" }).autoPagingToArray({ limit: 10000 });`)).toBe(
			`Let all be all Stripe invoices, fetched page by page (status: "open"), collected into a list of at most 10,000.`,
		);
	});
});

describe("webhooks", () => {
	test("constructEvent and the event switch", () => {
		const text = say(`const event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
switch (event.type) {
  case "invoice.paid":
    await markPaid(event.data.object);
    break;
  case "customer.subscription.trial_will_end":
  case "subscription_schedule.aborted":
    notify();
    break;
  default:
    console.log(\`Unhandled event type \${event.type}\`);
}`);
		expect(text).toBe(
			[
				"Let event be the Stripe event in body, after checking it really came from Stripe (signature sig, webhook secret endpoint secret).",
				"",
				"Depending on what kind of Stripe event event is:",
				`  • If it is "invoice.paid" (an invoice was paid):`,
				"    Mark paid (the Stripe object event is about).",
				`  • If it is "customer.subscription.trial_will_end" (a free trial ends in three days) or "subscription_schedule.aborted" (subscription schedule aborted):`,
				"    Notify.",
				"  • For any other event:",
				`    Log "Unhandled event type {event's type}".`,
			].join("\n"),
		);
	});

	test("the async verifier on the Stripe class, and previous attributes", () => {
		expect(say(`await Stripe.webhooks.constructEventAsync(raw, signature, secret);`)).toBe(
			"Check that raw really came from Stripe (signature signature, webhook secret secret).",
		);
		expect(say(`const before = event.data.previous_attributes;`)).toBe("Let before be the old values of the fields event changed.");
	});
});

describe("client", () => {
	test("new Stripe with options", () => {
		const { text } = narrateWithStats(
			`import Stripe from "stripe";\nconst stripe = new Stripe(key, { apiVersion: "2025-09-30.clover", maxNetworkRetries: 2 });`,
			{
				plugins: [stripe()],
			},
		);
		expect(text).toBe(
			["Let stripe be a Stripe client using the API key key:", `  • using API version "2025-09-30.clover"`, "  • retrying failed requests up to 2 times"].join(
				"\n",
			),
		);
	});
});

describe("guards", () => {
	const plain = (code: string) => narrateWithStats(code).text;
	const withPlugin = (code: string) => narrateWithStats(code, { plugins: [stripe()] }).text;

	test("other SDKs with the same resource names are left alone", () => {
		const code = `import Stripe from "stripe";
await autumn.customers.create({ id: "c1" });
await client.subscriptions.update("x", { a: 1 });
const stripeCustomer = await getCustomer();
stripeCustomer.subscriptions.data.find((s) => s.id);
switch (action.type) { case "user.created": go(); break; }`;
		expect(withPlugin(code)).toBe(plain(code));
	});

	test("files that don't use Stripe are untouched", () => {
		const code = `await stripe.customers.create({ email });\nswitch (event.type) { case "invoice.paid": go(); break; }`;
		expect(withPlugin(code)).toBe(plain(code));
	});
});

test("a partial translation reports what it is missing", () => {
	const gaps = phrasebookGaps(en, { target: { named: () => "" } });
	expect(gaps.missing).toContain("methods.create.do");
	expect(gaps.missing).toContain("webhooks.switch");
	expect(gaps.extra).toEqual([]);
});
