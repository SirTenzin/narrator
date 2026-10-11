import { describe, expect, test } from "bun:test";
import { narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { react } from "../../react/src";
import { stripe } from "../../stripe/src";
import { autumnJs, en } from "../src";

const IMPORT = `import { Autumn } from "autumn-js";\nconst autumn = new Autumn();\n`;
const REACT = `import { useCustomer, useEntity, usePricingTable, useListPlans, useReferrals, CheckoutDialog, PaywallDialog } from "autumn-js/react";\n`;

/** Narrates a snippet after the client set-up, asserting nothing fell back to raw code. */
const say = (code: string) => {
	const { text, fallbacks } = narrateWithStats(IMPORT + code, { plugins: [autumnJs()] });
	expect(fallbacks).toBe(0);
	return text.split("\n").slice(1).join("\n").replace(/^\n+/, "");
};

/** The same for a React component file. */
const ui = (code: string) => {
	const { text, fallbacks } = narrateWithStats(REACT + code, { plugins: [react(), autumnJs()], path: "billing.tsx" });
	expect(fallbacks).toBe(0);
	return text;
};

const lines = (...xs: string[]) => xs.join("\n");

describe("client", () => {
	test("the secret key, or the environment variable the SDK falls back to", () => {
		const read = (code: string) => narrateWithStats(`import { Autumn } from "autumn-js";\n${code}`, { plugins: [autumnJs()] }).text;
		expect(read(`const autumn = new Autumn({ secretKey: process.env.AUTUMN_SECRET_KEY });`)).toBe(
			"Let autumn be an Autumn client authenticated with the AUTUMN_SECRET_KEY environment variable.",
		);
		expect(read(`const autumn = new Autumn();`)).toBe("Let autumn be an Autumn client authenticated with the AUTUMN_SECRET_KEY environment variable.");
		expect(read(`const autumn = new Autumn({ secretKey: "am_sk_test_1234", serverURL: "http://localhost:8080", failOpen: false });`)).toBe(
			lines(
				`Let autumn be an Autumn client authenticated with "am_sk_test_1234":`,
				`  • talking to Autumn at "http://localhost:8080"`,
				"  • failing closed: if Autumn can't be reached, every call throws",
			),
		);
	});
});

describe("check", () => {
	test("whether the customer can use a feature, and the answer as a condition", () => {
		expect(say(`const { allowed } = await autumn.check({ customerId: "user_123", featureId: "messages" });\nif (!allowed) return;`)).toBe(
			lines(
				`Check whether the customer "user_123" can use the messages feature, and call the answer allowed.`,
				`If the customer "user_123" can't use the messages feature, stop here.`,
			),
		);
	});

	test("a required balance, and the whole response", () => {
		expect(say(`const response = await autumn.check({ customerId, featureId: "messages", requiredBalance: 3 });\nif (response.allowed) send();`)).toBe(
			lines(
				"Check whether the customer has at least 3 of the messages feature left, and call the answer response.",
				"If the customer has at least 3 of the messages feature left, send.",
			),
		);
	});

	test("sendEvent records the usage in the same request; a lock holds it instead", () => {
		expect(say(`await autumn.check({ customerId, featureId: "api_calls", requiredBalance: 3, sendEvent: true });`)).toBe(
			"Check whether the customer has at least 3 of the api_calls feature left, and if so record 3 uses of it.",
		);
		expect(
			say(
				`await autumn.check({ customerId: "user_123", featureId: "ai-tokens", requiredBalance: 1000, sendEvent: true, lock: { enabled: true, lockId: "completion_abc123", expiresAt } });`,
			),
		).toBe(
			lines(
				`Check whether the customer "user_123" has at least 1,000 of the ai-tokens feature left, and if so hold 1,000 of it under the lock "completion_abc123":`,
				"  • the hold expires at expires at",
			),
		);
	});

	test("entities, previews and event properties", () => {
		expect(say(`await autumn.check({ customerId: "org_123", featureId: "ai-messages", entityId: "user_abc", withPreview: true });`)).toBe(
			lines(
				`Check whether entity "user_abc" of the customer "org_123" can use the ai-messages feature:`,
				"  • including upgrade options to show if access is denied",
			),
		);
		expect(say(`await autumn.check({ customerId, featureId: "compute_minutes", requiredBalance: 10, properties: { size: "large" } });`)).toBe(
			lines("Check whether the customer has at least 10 of the compute_minutes feature left:", `  • event properties: an object with size: "large"`),
		);
	});

	test("as a value, and the balance on its result", () => {
		expect(say(`return autumn.check({ customerId, featureId: "messages" });`)).toBe("Give back whether the customer can use the messages feature.");
		expect(say(`const result = await autumn.check({ customerId, featureId: "credits" });\nshow(result.balance);`)).toBe(
			lines("Check whether the customer can use the credits feature, and keep the answer.", "Show (the balance of the credits feature)."),
		);
	});

	test("0.x: snake_case params, { data, error } results and product access", () => {
		expect(
			say(
				`const { data, error } = await autumn.check({ customer_id: "user_123", feature_id: "messages" });\nif (error) throw error;\nif (!data.allowed) stop();`,
			),
		).toBe(
			lines(
				`Check whether the customer "user_123" can use the messages feature, and take its data and error.`,
				"If Autumn returned an error, fail with error.",
				`If the customer "user_123" can't use the messages feature, stop.`,
			),
		);
		expect(say(`await autumn.check({ customer_id: "user_123", product_id: "pro" });`)).toBe(
			`Check whether the customer "user_123" has access to the pro plan.`,
		);
	});

	test("the static methods 0.x put on the class", () => {
		const { text } = narrateWithStats(`import { Autumn } from "autumn-js";\nawait Autumn.check({ customer_id: "user_123", feature_id: "messages" });`, {
			plugins: [autumnJs()],
		});
		expect(text).toBe(`Check whether the customer "user_123" can use the messages feature.`);
	});

	test("an answer in another scope, or shadowed, is left alone", () => {
		expect(say(`const { allowed } = await autumn.check({ customerId, featureId: "messages" });\nfunction other(allowed) { if (allowed) go(); }`)).toBe(
			lines(
				"Check whether the customer can use the messages feature, and call the answer allowed.",
				"",
				"To other, given allowed:",
				"  If allowed is set, run go.",
			),
		);
	});
});

describe("track and balances", () => {
	test("uses of a feature, giving balance back, and events", () => {
		expect(say(`await autumn.track({ customerId: "user_123", featureId: "messages", value: 1 });`)).toBe(
			`Record 1 use of the messages feature for the customer "user_123".`,
		);
		expect(say(`await autumn.track({ customerId, featureId: "seats", value: -1 });`)).toBe("Give back 1 use of the seats feature to the customer.");
		expect(say(`await autumn.track({ customerId, eventName: "ai_chat_request" });`)).toBe("Record 1 use through the ai_chat_request event for the customer.");
		expect(say(`await autumn.track({ customerId, featureId: "messages", value: count });`)).toBe(
			"Record count units of the messages feature for the customer.",
		);
	});

	test("options: properties, waiting for the balance, idempotency", () => {
		expect(say(`const { balance } = await autumn.track({ customerId, featureId: "messages", value: 1, async: false });`)).toBe(
			lines("Record 1 use of the messages feature for the customer, and take its balance:", "  • waiting for the updated balance instead of queueing it"),
		);
		expect(say(`await autumn.track({ customer_id: userId, feature_id: "messages", idempotency_key: requestId });`)).toBe(
			lines("Record 1 use of the messages feature for the customer with ID user ID:", "  • idempotency key request ID, so a retry won't record it twice"),
		);
		expect(say(`await autumn.track({ customerId, featureId: "api_calls" }, { headers: { "Idempotency-Key": "request_abc123" } });`)).toBe(
			lines("Record 1 use of the api_calls feature for the customer:", `  • idempotency key "request_abc123", so a retry won't record it twice`),
		);
	});

	test("AI tokens", () => {
		expect(say(`await autumn.balances.trackTokens({ customerId, modelId: "anthropic/claude-opus-4-6", inputTokens: 1000, outputTokens: 500 });`)).toBe(
			"Record 1,000 input and 500 output tokens on the anthropic/claude-opus-4-6 model for the customer, charged as AI credits.",
		);
	});

	test("setting usage directly, granting, and finishing a lock", () => {
		expect(say(`await autumn.balances.update({ customerId: "user_123", featureId: "seats", usage: 3 });`)).toBe(
			`Set the usage of the seats feature for the customer "user_123" to 3.`,
		);
		expect(say(`await autumn.usage({ customer_id: "user_123", feature_id: "seats", value: 3 });`)).toBe(
			`Set the usage of the seats feature for the customer "user_123" to 3.`,
		);
		expect(say(`await autumn.balances.create({ customerId, featureId: "credits", grantedBalance: 500, reset: { interval: "one_off" } });`)).toBe(
			lines("Grant the customer 500 of the credits feature:", "  • granted once, without resetting"),
		);
		expect(say(`await autumn.balances.finalize({ lockId, action: "confirm", overrideValue: used });`)).toBe(
			"Confirm the usage held under the lock, counting used instead.",
		);
		expect(say(`await autumn.balances.finalize({ lockId, action: "release" });`)).toBe("Release the usage held under the lock, returning it to the balance.");
	});

	test("usage totals", () => {
		expect(say(`const { list, total } = await autumn.events.aggregate({ customerId, featureId: "messages", range: "30d" });`)).toBe(
			lines("Fetch the usage totals of the messages feature for the customer, and take its list and total:", "  • over the last 30 days"),
		);
		expect(say(`await autumn.query({ customer_id: userId, feature_id: ["messages", "credits"], range: "7d", bin_size: "day" });`)).toBe(
			lines(
				"Fetch the usage totals of the features messages and credits for the customer with ID user ID:",
				"  • over the last 7 days",
				"  • totalled per day",
			),
		);
	});
});

describe("attach, checkout and subscriptions", () => {
	test("attach, and the payment URL on its result", () => {
		expect(
			say(`const response = await autumn.billing.attach({ customerId: "user_123", planId: "pro", redirectMode: "always" });\nredirect(response.paymentUrl);`),
		).toBe(
			lines(
				`Attach the pro plan to the customer "user_123", and call the result response:`,
				"  • always sending the customer to a payment page",
				"",
				"Redirect (the payment page URL).",
			),
		);
	});

	test("trials, quantities, entities and carried-over balances", () => {
		expect(
			say(
				`await autumn.billing.attach({ customerId, planId: "pro", customize: { freeTrial: { durationLength: 14, durationType: "day", cardRequired: true } }, successUrl: url });`,
			),
		).toBe(
			lines(
				"Attach the pro plan to the customer:",
				"  • with a 14-day free trial",
				"  • card required for the trial",
				"  • when they finish, send them to URL",
			),
		);
		expect(
			say(
				`await autumn.billing.attach({ customerId: "org_123", planId: "team", entityId: "workspace_a", featureQuantities: [{ featureId: "seats", quantity: 10 }] });`,
			),
		).toBe(lines(`Attach the team plan to entity "workspace_a" of the customer "org_123":`, "  • 10 of the seats feature"));
		expect(say(`await autumn.billing.attach({ customerId, planId: "enterprise", carryOverBalances: { enabled: true, featureIds: ["credits"] } });`)).toBe(
			lines("Attach the enterprise plan to the customer:", "  • carrying over the remaining balances of the features credits"),
		);
	});

	test("several plans and previews", () => {
		expect(say(`await autumn.billing.multiAttach({ customerId, plans: [{ planId: "pro" }, { planId: "storage" }] });`)).toBe(
			"Attach the plans pro and storage to the customer together.",
		);
		expect(say(`const preview = await autumn.billing.previewAttach({ customerId, planId: "pro" });`)).toBe(
			"Preview what attaching the pro plan to the customer would charge, without changing anything, and call the result preview.",
		);
	});

	test("cancelling, undoing a cancellation and changing quantities", () => {
		expect(say(`await autumn.billing.update({ customerId, planId: "pro", cancelAction: "cancel_end_of_cycle" });`)).toBe(
			"Cancel the pro plan for the customer at the end of the billing cycle.",
		);
		expect(say(`await autumn.billing.update({ customerId, planId: "pro", cancelAction: "cancel_immediately" });`)).toBe(
			"Cancel the pro plan for the customer immediately.",
		);
		expect(say(`await autumn.billing.update({ customerId, planId: sub.planId, cancelAction: "uncancel" });`)).toBe(
			"Undo the scheduled cancellation of the plan with ID sub's plan ID for the customer.",
		);
		expect(
			say(`await autumn.billing.update({ customerId, planId: "team", featureQuantities: [{ featureId: "seats", quantity: 10 }], prorationBehavior: "none" });`),
		).toBe(lines("Update the team plan for the customer:", "  • 10 of the seats feature", "  • without prorating the change"));
		expect(say(`await autumn.cancel({ customer_id: "user_123", product_id: "add_on", cancel_immediately: true });`)).toBe(
			`Cancel the add_on plan for the customer "user_123" immediately.`,
		);
	});

	test("0.x attach and checkout", () => {
		expect(say(`const { data } = await autumn.attach({ customer_id: userId, product_id: "pro" });\nif (data?.checkout_url) redirect(data.checkout_url);`)).toBe(
			lines(
				"Attach the pro plan to the customer with ID user ID, and take its data.",
				"If Autumn returned a checkout page URL, redirect (the checkout page URL).",
			),
		);
		expect(say(`await autumn.checkout({ customer_id: "user_123", product_id: "credit_top_up", options: [{ feature_id: "credits", quantity: 1000 }] });`)).toBe(
			lines(`Start checkout for the credit_top_up plan for the customer "user_123":`, "  • 1,000 of the credits feature"),
		);
	});

	test("the billing portal and payment setup", () => {
		expect(say(`const { url } = await autumn.billing.openCustomerPortal({ customerId, returnUrl: "https://app.com/billing" });`)).toBe(
			lines("Create a billing portal link for the customer, and take its URL:", `  • coming back to "https://app.com/billing" afterwards`),
		);
		expect(say(`await autumn.customers.billingPortal("user_123", { return_url: returnUrl });`)).toBe(
			lines(`Create a billing portal link for the customer "user_123":`, "  • coming back to return URL afterwards"),
		);
		expect(say(`await autumn.billing.setupPayment({ customerId, planId: "pro" });`)).toBe(
			lines("Start a payment method setup for the customer:", "  • then attaching the pro plan"),
		);
	});
});

describe("customers, entities and the catalog", () => {
	test("get or create at sign-up, in both majors", () => {
		expect(say(`const customer = await autumn.customers.getOrCreate({ customerId: user.id, name: user.name, email: user.email });`)).toBe(
			lines(
				"Create the customer with ID user's ID in Autumn if they don't exist yet, and call the result customer:",
				"  • name: user's name",
				"  • email: user's email",
			),
		);
		expect(say(`await autumn.customers.create({ id: "user_456", fingerprint: "device_abc123" });`)).toBe(
			lines(
				`Create the customer "user_456" in Autumn if they don't exist yet:`,
				`  • device fingerprint "device_abc123", so the same person can't start another free trial`,
			),
		);
	});

	test("fetch, update, delete", () => {
		expect(say(`await autumn.customers.get({ customerId: "user_123", expand: ["invoices", "trials_used"] });`)).toBe(
			lines(`Fetch the customer "user_123" from Autumn:`, "  • including their invoices and the free trials they've used"),
		);
		expect(say(`await autumn.customers.get("user_123");`)).toBe(`Fetch the customer "user_123" from Autumn.`);
		expect(say(`await autumn.customers.delete({ customerId, deleteInStripe: true });`)).toBe(
			lines("Delete the customer from Autumn:", "  • also deleting them in Stripe"),
		);
	});

	test("billing controls", () => {
		expect(
			say(`await autumn.customers.update({
  customerId: "user_123",
  billingControls: {
    spendLimits: [{ featureId: "api_calls", enabled: true, overageLimit: 5000 }],
    usageLimits: [{ featureId: "credits", limit: 50, interval: "day" }],
    usageAlerts: [{ featureId: "api_calls", threshold: 80, thresholdType: "usage_percentage", enabled: true, name: "80% warning" }],
    autoTopups: [{ featureId: "credits", enabled: true, threshold: 500, quantity: 1000 }],
  },
});`),
		).toBe(
			lines(
				`Update the customer "user_123":`,
				"  • billing controls:",
				"    • cap overage spending on the api_calls feature at 5000",
				"    • limit the credits feature to 50 a day",
				`    • alert when 80% of the api_calls feature is used ("80% warning")`,
				"    • top up 1000 of the credits feature when its balance drops below 500",
			),
		);
	});

	test("entities in both majors", () => {
		expect(say(`await autumn.entities.create({ customerId: "org_123", entityId: "user_abc", featureId: "seats", name: "John Doe" });`)).toBe(
			lines(`Create entity "user_abc" under the customer "org_123", counted against the seats feature:`, `  • named "John Doe"`),
		);
		expect(say(`await autumn.entities.delete({ customerId: "org_123", entityId: "user_abc" });`)).toBe(`Delete entity "user_abc" of the customer "org_123".`);
		expect(say(`await autumn.entities.get("org_123", "seat_1");`)).toBe(`Fetch entity "seat_1" of the customer "org_123".`);
	});

	test("plans, products, features, referrals and generic resources", () => {
		expect(say(`const { list } = await autumn.plans.list({ customerId: "user_123" });`)).toBe(
			`Fetch every plan, with whether each is an upgrade or a downgrade for the customer "user_123", and take its list.`,
		);
		expect(say(`await autumn.products.get("pro");`)).toBe("Fetch the pro plan.");
		expect(say(`await autumn.plans.create({ planId: "pro", name: "Pro", price: { amount: 20, interval: "month" } });`)).toBe(
			lines("Create the pro plan:", `  • named "Pro"`, "  • priced at 20 per month"),
		);
		expect(say(`await autumn.features.create({ featureId: "messages", type: "metered", consumable: true });`)).toBe(
			lines("Create the messages feature:", "  • a metered feature", "  • used up and reset each period"),
		);
		expect(say(`await autumn.referrals.redeemCode({ code, customerId });`)).toBe("Redeem the code as a referral for the customer.");
		expect(say(`await autumn.webhooks.sync({ webhooks });`)).toBe(lines("Sync Autumn webhooks:", "  • webhooks"));
	});
});

describe("backend handlers", () => {
	test("a Next.js route", () => {
		const { text, fallbacks } = narrateWithStats(
			`import { autumnHandler } from "autumn-js/next";
export const { GET, POST } = autumnHandler({
  identify: async (request) => ({ customerId: session.user.id, customerData: { name: session.user.name, email: session.user.email } }),
});`,
			{ plugins: [autumnJs()] },
		);
		expect(fallbacks).toBe(0);
		expect(text).toBe(
			lines(
				"Serve Autumn's backend routes for the React hooks, answering GET and POST requests:",
				"  • identifying the customer as session's user's ID, along with their name and email",
			),
		);
	});

	test("an identify function that works the customer out first, and the low-level handler", () => {
		const read = (code: string) => narrateWithStats(code, { plugins: [autumnJs()] }).text;
		expect(
			read(`import { autumnHandler } from "autumn-js/hono";
const handler = autumnHandler({ identify: async (c) => { const user = await getUser(c); return { customerId: user.id }; } });`),
		).toBe(lines("Let handler be Autumn's backend routes for the React hooks:", "  • identifying the customer as user's ID, after:", "    Get user (c)."));
		expect(read(`import { autumnHandler } from "autumn-js/backend";\nconst result = await autumnHandler({ request, customerId: userId });`)).toBe(
			"Pass request on to Autumn for the customer with ID user ID, and keep the result.",
		);
	});
});

describe("React", () => {
	test("useCustomer and the functions it hands back", () => {
		expect(ui(`const { attach } = useCustomer();\nattach({ planId: "pro" });`)).toBe(
			lines("Load the customer's plans and balances from Autumn, and take its attach.", "Attach the pro plan to the customer."),
		);
		expect(ui(`const { checkout } = useCustomer();\nawait checkout({ productId: "pro", dialog: CheckoutDialog });`)).toBe(
			lines(
				"Load the customer's plans and balances from Autumn, and take its checkout.",
				"",
				"Start checkout for the pro plan for the customer:",
				"  • asking the customer to confirm in the checkout dialog first",
			),
		);
	});

	test("the local check, as a condition and kept in a variable", () => {
		expect(
			ui(`const { check, track } = useCustomer();\nif (!check({ featureId: "messages" }).allowed) alert("Out");\nawait track({ featureId: "messages" });`),
		).toBe(
			lines(
				"Load the customer's plans and balances from Autumn, and take its check and track.",
				`If the customer can't use the messages feature, run alert ("Out").`,
				"Record 1 use of the messages feature for the customer.",
			),
		);
		expect(ui(`const { check } = useCustomer();\nconst result = check({ featureId: "messages" });`)).toBe(
			lines(
				"Load the customer's plans and balances from Autumn, and take its check.",
				"Check whether the customer can use the messages feature, from the customer data already loaded, and keep the answer.",
			),
		);
	});

	test("the portal, refetch and the object form", () => {
		expect(ui(`const { openBillingPortal, refetch } = useCustomer();\nawait openBillingPortal({ returnUrl: url });\nawait refetch();`)).toBe(
			lines(
				"Load the customer's plans and balances from Autumn, and take its open billing portal and refetch.",
				"",
				"Open the billing portal for the customer:",
				"  • coming back to URL afterwards",
				"",
				"Reload the customer from Autumn.",
			),
		);
		expect(ui(`const customer = useCustomer({ expand: ["invoices"] });\nawait customer.attach({ planId: "pro" });`)).toBe(
			lines(
				"Load the customer's plans and balances from Autumn, including their invoices, and call the result customer.",
				"Attach the pro plan to the customer.",
			),
		);
	});

	test("the other hooks", () => {
		expect(ui(`const { data } = useEntity({ entityId: "workspace_a" });`)).toBe(`Load entity "workspace_a" of the customer from Autumn, and take its data.`);
		expect(ui(`const { products } = usePricingTable();`)).toBe(
			"Load the plans for the pricing table, with the customer's options on each, and take its products.",
		);
		expect(ui(`const { data, refetch } = useListPlans();\nrefetch();`)).toBe(
			lines("Load every plan, with whether each is an upgrade or a downgrade for the customer, and take its data and refetch.", "Run refetch."),
		);
		expect(ui(`const { redeemCode } = useReferrals({ programId: "friends" });\nawait redeemCode({ code: "4EXWV1" });`)).toBe(
			lines(
				`Load the customer's referral code in the referral program "friends", and take its redeem code.`,
				`Redeem the code "4EXWV1" as a referral for the customer.`,
			),
		);
	});
});

describe("receivers and results", () => {
	test("a client kept on a class", () => {
		const { text } = narrateWithStats(
			`import { Autumn } from "autumn-js";
class Billing {
  constructor(private autumn: Autumn) {}
  async canExport(id: string) {
    const res = await this.autumn.check({ customerId: id, featureId: "exports" });
    return res.allowed;
  }
}`,
			{ plugins: [autumnJs()] },
		);
		expect(text).toBe(
			lines(
				"Class Billing:",
				"  When created, given autumn:",
				"    Keep autumn as a field.",
				"  Can export? (async), given ID:",
				"    Check whether the customer can use the exports feature, and call the answer response.",
				"    Give back whether the customer can use the exports feature.",
			),
		);
	});

	test("the billing portal URL, and resources read by method", () => {
		expect(
			say(
				`const portal = await autumn.billing.openCustomerPortal({ customerId });\nwindow.location.href = portal.url;\nawait autumn.invoices.void({ invoiceId });`,
			),
		).toBe(
			lines(
				"Create a billing portal link for the customer, and call the result portal.",
				"Set window's location's href to the billing portal URL.",
				"",
				"Void an Autumn invoice:",
				"  • invoice ID",
			),
		);
	});

	test("an identify function passed by name, and a path prefix", () => {
		const { text } = narrateWithStats(
			`import { autumnHandler } from "autumn-js/fetch";\nconst handle = autumnHandler({ identify: getIdentity, pathPrefix: "/billing" });`,
			{
				plugins: [autumnJs()],
			},
		);
		expect(text).toBe(
			lines("Let handle be Autumn's backend routes for the React hooks:", "  • identifying the customer with get identity", `  • under the path "/billing"`),
		);
	});

	test("0.x hook options: a paywall dialog, and entities made from the browser", () => {
		expect(
			ui(
				`const { check, createEntity } = useCustomer();\ncheck({ featureId: "ai-messages", dialog: PaywallDialog });\nawait createEntity([{ id: "seat_1", featureId: "seats" }]);`,
			),
		).toBe(
			lines(
				"Load the customer's plans and balances from Autumn, and take its check and create entity.",
				"",
				"Check whether the customer can use the ai-messages feature, from the customer data already loaded:",
				"  • showing the paywall dialog if not",
				"",
				"Create entities under the customer:",
				`  • an object with ID: "seat_1" and feature ID: "seats"`,
			),
		);
	});
});

describe("guards", () => {
	const plain = (code: string, opts = {}) => narrateWithStats(code, opts).text;
	const withPlugin = (code: string, opts = {}) => narrateWithStats(code, { ...opts, plugins: [autumnJs()] }).text;

	test("other clients named autumn, and Autumn's own test client, are left alone", () => {
		const code = `import { Autumn } from "autumn-js";
import type { AutumnInt } from "@/external/autumn/autumnCli.js";
export const attachPlan = async ({ autumn }: { autumn: AutumnInt }) => {
  await autumn.attach({ customer_id: "c1", product_id: "pro" });
  await autumn.check({ customer_id: "c1", feature_id: "f" });
};
const autumnV1 = new AutumnInt({ version: "1.2" });
await autumnV1.track({ customer_id: "c1", feature_id: "f", value: 1 });`;
		expect(withPlugin(code, { dependencies: { "autumn-js": "^1.4.23" } })).toBe(plain(code, { dependencies: { "autumn-js": "^1.4.23" } }));
	});

	test("Stripe calls stay Stripe's, and both plugins read their own", () => {
		const code = `import Stripe from "stripe";
import { Autumn } from "autumn-js";
const stripe = new Stripe(key);
const autumn = new Autumn();
await stripe.customers.create({ email });
await autumn.customers.getOrCreate({ customerId });`;
		expect(narrateWithStats(code, { plugins: [stripe(), autumnJs()] }).text).toBe(
			lines(
				"Let stripe be a Stripe client using the API key key.",
				"Let autumn be an Autumn client authenticated with the AUTUMN_SECRET_KEY environment variable.",
				"",
				"Create a Stripe customer:",
				"  • email",
				"",
				"Create the customer in Autumn if they don't exist yet.",
			),
		);
	});

	test("same-named functions and hooks from elsewhere are untouched", () => {
		const code = `import { useCustomer } from "@/hooks/useCustomer";
const { attach, check } = useCustomer();
attach({ planId: "pro" });
const ok = check({ featureId: "x" });
if (ok.allowed) go();`;
		expect(withPlugin(code)).toBe(plain(code));
	});

	test("files that don't use autumn-js are untouched", () => {
		const code = `const autumn = makeClient();\nawait autumn.check({ customerId, featureId: "messages" });\nexport const { GET } = autumnHandler({ identify });`;
		expect(withPlugin(code)).toBe(plain(code));
	});

	test("Better Auth's autumn() plugin is not a client", () => {
		const code = `import { autumn } from "autumn-js/better-auth";\nconst plugin = autumn();\nawait plugin.check({ customerId });`;
		expect(withPlugin(code)).toBe(plain(code));
	});
});

describe("dependency activation", () => {
	const code = `import { autumn } from "@/lib/autumn";\nawait autumn.track({ customerId, featureId: "messages" });`;
	test("a client imported from the app's own module counts when the package depends on autumn-js", () => {
		expect(narrateWithStats(code, { plugins: [autumnJs()], dependencies: { "autumn-js": "^1.4.23" } }).text).toBe(
			"Record 1 use of the messages feature for the customer.",
		);
	});
	test("without the dependency it reads as any other call", () => {
		expect(narrateWithStats(code, { plugins: [autumnJs()] }).text).toBe(narrateWithStats(code).text);
	});
});

test("a partial translation reports what it is missing", () => {
	const gaps = phrasebookGaps(en, { check: { can: () => "" } });
	expect(gaps.missing).toContain("check.cannot");
	expect(gaps.missing).toContain("billing.attach.do");
	expect(gaps.missing).toContain("react.useCustomer.done");
	expect(gaps.extra).toEqual([]);
});

test("the English phrasebook is complete", () => {
	const gaps = phrasebookGaps(en, en);
	expect(gaps.missing).toEqual([]);
	expect(gaps.extra).toEqual([]);
});
