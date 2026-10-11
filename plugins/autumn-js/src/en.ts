import type { AutumnPhrases, Op, Term } from "./phrases";

/** `the messages feature`, `the feature`, `the feature with ID feature key`. */
const term = (noun: string): Term => ({
	id: ({ id }) => `the ${id} ${noun}`,
	it: `the ${noun}`,
	named: ({ value }) => `the ${noun} with ID ${value}`,
});
/** `the customer "user_123"`, `the customer`, `the customer with ID user's ID`. */
const quoted = (noun: string, article = "the "): Term => ({
	id: ({ id }) => `${article}${noun} ${id}`,
	it: `the ${noun}`,
	named: ({ value }) => `the ${noun} with ID ${value}`,
});

const op = <K extends string>(act: (p: Record<K, string>) => string, value: (p: Record<K, string>) => string): Op<K> => ({ do: act, done: value });
/** A step whose value is the result of doing it: "record …" / "the result of recording …". */
const step = <K extends string>(act: (p: Record<K, string>) => string, gerund: (p: Record<K, string>) => string): Op<K> =>
	op(act, (p) => `the result of ${gerund(p)}`);

export const en: AutumnPhrases = {
	terms: {
		customer: quoted("customer"),
		feature: term("feature"),
		plan: term("plan"),
		entity: quoted("entity", ""),
		event: { id: ({ id }) => `the ${id} event`, it: "the event", named: ({ value }) => `the event named ${value}` },
		lock: { id: ({ id }) => `the lock ${id}`, it: "the lock", named: ({ value }) => `the lock ${value}` },
		code: { id: ({ id }) => `the code ${id}`, it: "the code", named: ({ value }) => `the code ${value}` },
		model: { id: ({ id }) => `the ${id} model`, it: "the model", named: ({ value }) => `the model ${value}` },
		their: ({ fields }) => `their ${fields}`,
		entityOf: ({ entity, customer }) => `${entity} of ${customer}`,
		plans: ({ ids }) => `the plans ${ids}`,
		features: ({ ids }) => `the features ${ids}`,
		uses: ({ amount, count }) => (count === 1 ? `${amount} use` : count === null ? `${amount} units` : `${amount} uses`),
	},
	client: {
		create: ({ key }) => `an Autumn client authenticated with ${key}`,
		envKey: "an Autumn client authenticated with the AUTUMN_SECRET_KEY environment variable",
		serverURL: ({ url }) => `talking to Autumn at ${url}`,
		failOpen: {
			on: "failing open: if Autumn can't be reached, checks allow access and tracked usage is dropped",
			off: "failing closed: if Autumn can't be reached, every call throws",
		},
		timeout: ({ ms }) => `giving up on a request after ${ms} ms`,
		version: ({ version }) => `using API version ${version}`,
		defaultReturnUrl: ({ url }) => `sending customers back to ${url} by default`,
	},
	check: {
		can: ({ who, feature }) => `${who} can use ${feature}`,
		cannot: ({ who, feature }) => `${who} can't use ${feature}`,
		atLeast: ({ who, feature, amount }) => `${who} has at least ${amount} of ${feature} left`,
		lessThan: ({ who, feature, amount }) => `${who} has less than ${amount} of ${feature} left`,
		hasPlan: ({ who, plan }) => `${who} has access to ${plan}`,
		lacksPlan: ({ who, plan }) => `${who} doesn't have access to ${plan}`,
		do: ({ condition }) => `check whether ${condition}`,
		done: ({ condition }) => `whether ${condition}`,
		andRecord: ({ check, uses }) => `${check}, and if so record ${uses} of it`,
		andHold: ({ check, amount, lock }) => `${check}, and if so hold ${amount} of it under ${lock}`,
		lockExpires: ({ time }) => `the hold expires at ${time}`,
		withPreview: "including upgrade options to show if access is denied",
		callAnswer: ({ call, name }) => `${call}, and call the answer ${name}`,
		keepAnswer: ({ call }) => `${call}, and keep the answer`,
		local: ({ check }) => `${check}, from the customer data already loaded`,
		dialog: ({ dialog }) => `showing the ${dialog} if not`,
	},
	track: {
		record: step(
			({ uses, feature, who }) => `record ${uses} of ${feature} for ${who}`,
			({ uses, feature, who }) => `recording ${uses} of ${feature} for ${who}`,
		),
		giveBack: step(
			({ uses, feature, who }) => `give back ${uses} of ${feature} to ${who}`,
			({ uses, feature, who }) => `giving back ${uses} of ${feature} to ${who}`,
		),
		event: step(
			({ uses, event, who }) => `record ${uses} through ${event} for ${who}`,
			({ uses, event, who }) => `recording ${uses} through ${event} for ${who}`,
		),
		tokens: step(
			({ tokens, model, who }) => `record ${tokens} on ${model} for ${who}, charged as AI credits`,
			({ tokens, model, who }) => `recording ${tokens} on ${model} for ${who}`,
		),
		tokenCounts: ({ input, output }) => `${input} input and ${output} output tokens`,
		tokenUsage: "AI token usage",
		tokenField: {
			inputTokens: ({ count }) => `input tokens: ${count}`,
			outputTokens: ({ count }) => `output tokens: ${count}`,
			cacheReadTokens: ({ count }) => `${count} cached input tokens read`,
			cacheWriteTokens: ({ count }) => `${count} input tokens written to the cache`,
			audioInputTokens: ({ count }) => `${count} audio input tokens`,
			audioOutputTokens: ({ count }) => `${count} audio output tokens`,
			reasoningTokens: ({ count }) => `${count} reasoning tokens`,
		},
		creditFeature: ({ feature }) => `charged to ${feature}`,
		batch: step(
			({ events }) => `queue usage events to be recorded in the background: ${events}`,
			({ events }) => `queueing usage events: ${events}`,
		),
		properties: ({ value }) => `event properties: ${value}`,
		timestamp: ({ value }) => `dated ${value} (Unix time in milliseconds)`,
		overage: {
			overflow: "deducting the full amount even if it takes the balance below zero",
			cap: "deducting only what's left in the balance",
		},
		wait: "waiting for the updated balance instead of queueing it",
		queue: "queued, without waiting for the updated balance",
		idempotencyKey: ({ key }) => `idempotency key ${key}, so a retry won't record it twice`,
		customerData: ({ value }) => `creating the customer with ${value} if they don't exist yet`,
		entityData: ({ value }) => `creating the entity with ${value} if it doesn't exist yet`,
	},
	balances: {
		setUsage: step(
			({ feature, who, value }) => `set the usage of ${feature} for ${who} to ${value}`,
			({ feature, who, value }) => `setting the usage of ${feature} for ${who} to ${value}`,
		),
		setRemaining: step(
			({ feature, who, value }) => `set the remaining balance of ${feature} for ${who} to ${value}`,
			({ feature, who, value }) => `setting the remaining balance of ${feature} for ${who} to ${value}`,
		),
		setBalance: step(
			({ feature, who, value }) => `set the balance of ${feature} for ${who} to ${value}`,
			({ feature, who, value }) => `setting the balance of ${feature} for ${who} to ${value}`,
		),
		update: step(
			({ feature, who }) => `update the balance of ${feature} for ${who}`,
			({ feature, who }) => `updating the balance of ${feature} for ${who}`,
		),
		grant: step(
			({ amount, feature, who }) => `grant ${who} ${amount} of ${feature}`,
			({ amount, feature, who }) => `granting ${who} ${amount} of ${feature}`,
		),
		grantSome: step(
			({ feature, who }) => `grant ${who} a balance of ${feature}`,
			({ feature, who }) => `granting ${who} a balance of ${feature}`,
		),
		remove: step(
			({ feature, who }) => `delete the balance of ${feature} for ${who}`,
			({ feature, who }) => `deleting the balance of ${feature} for ${who}`,
		),
		list: op(
			({ who }) => `fetch a page of balances of ${who}`,
			({ who }) => `a page of balances of ${who}`,
		),
		resetsEvery: ({ interval }) => `resetting every ${interval}`,
		oneOff: "granted once, without resetting",
		confirm: step(
			({ lock }) => `confirm the usage held under ${lock}`,
			({ lock }) => `confirming the usage held under ${lock}`,
		),
		confirmAs: step(
			({ lock, value }) => `confirm the usage held under ${lock}, counting ${value} instead`,
			({ lock }) => `confirming the usage held under ${lock}`,
		),
		release: step(
			({ lock }) => `release the usage held under ${lock}, returning it to the balance`,
			({ lock }) => `releasing the usage held under ${lock}`,
		),
		finalize: step(
			({ lock, action }) => `finish the usage held under ${lock} (${action})`,
			({ lock }) => `finishing the usage held under ${lock}`,
		),
		setBalances: step(
			({ who }) => `set the balances of ${who}`,
			({ who }) => `setting the balances of ${who}`,
		),
		balanceItem: ({ feature, value }) => `${feature} to ${value}`,
	},
	events: {
		aggregate: op(
			({ feature, who }) => `fetch the usage totals of ${feature} for ${who}`,
			({ feature, who }) => `the usage totals of ${feature} for ${who}`,
		),
		list: op(
			({ feature, who }) => `fetch the usage events of ${feature} for ${who}`,
			({ feature, who }) => `the usage events of ${feature} for ${who}`,
		),
		range: {
			"24h": "the last 24 hours",
			"7d": "the last 7 days",
			"30d": "the last 30 days",
			"90d": "the last 90 days",
			last_cycle: "the last billing cycle",
			"1bc": "the current billing cycle",
			"3bc": "the last 3 billing cycles",
		},
		over: ({ range }) => `over ${range}`,
		perBin: ({ size }) => `totalled per ${size}`,
		groupBy: ({ field }) => `split by ${field}`,
		between: ({ start, end }) => `between ${start} and ${end}`,
	},
	billing: {
		attach: step(
			({ plan, who }) => `attach ${plan} to ${who}`,
			({ plan, who }) => `attaching ${plan} to ${who}`,
		),
		multiAttach: step(
			({ plans, who }) => `attach ${plans} to ${who} together`,
			({ plans, who }) => `attaching ${plans} to ${who}`,
		),
		previewAttach: op(
			({ plan, who }) => `preview what attaching ${plan} to ${who} would charge, without changing anything`,
			({ plan, who }) => `a preview of what attaching ${plan} to ${who} would charge`,
		),
		previewMultiAttach: op(
			({ plans, who }) => `preview what attaching ${plans} to ${who} would charge, without changing anything`,
			({ plans, who }) => `a preview of what attaching ${plans} to ${who} would charge`,
		),
		checkout: op(
			({ plan, who }) => `start checkout for ${plan} for ${who}`,
			({ plan, who }) => `a checkout for ${plan} for ${who}`,
		),
		update: step(
			({ plan, who }) => `update ${plan} for ${who}`,
			({ plan, who }) => `updating ${plan} for ${who}`,
		),
		previewUpdate: op(
			({ plan, who }) => `preview what updating ${plan} for ${who} would charge, without changing anything`,
			({ plan, who }) => `a preview of what updating ${plan} for ${who} would charge`,
		),
		cancelEnd: step(
			({ plan, who }) => `cancel ${plan} for ${who} at the end of the billing cycle`,
			({ plan, who }) => `cancelling ${plan} for ${who} at the end of the billing cycle`,
		),
		cancelNow: step(
			({ plan, who }) => `cancel ${plan} for ${who} immediately`,
			({ plan, who }) => `cancelling ${plan} for ${who} immediately`,
		),
		uncancel: step(
			({ plan, who }) => `undo the scheduled cancellation of ${plan} for ${who}`,
			({ plan, who }) => `undoing the scheduled cancellation of ${plan} for ${who}`,
		),
		multiUpdate: step(
			({ who }) => `update several plans of ${who} at once`,
			({ who }) => `updating several plans of ${who}`,
		),
		portal: op(
			({ who }) => `create a billing portal link for ${who}`,
			({ who }) => `a billing portal link for ${who}`,
		),
		openPortal: step(
			({ who }) => `open the billing portal for ${who}`,
			({ who }) => `opening the billing portal for ${who}`,
		),
		setupPayment: op(
			({ who }) => `start a payment method setup for ${who}`,
			({ who }) => `a payment method setup for ${who}`,
		),
		schedule: step(
			({ who }) => `schedule a sequence of plans for ${who}`,
			({ who }) => `scheduling a sequence of plans for ${who}`,
		),
		verify: op(
			({ who }) => `compare the Stripe subscriptions of ${who} with Autumn's records, without changing anything`,
			({ who }) => `the differences between the Stripe subscriptions of ${who} and Autumn's records`,
		),
		import: step(
			({ who }) => `import ${who} into Autumn from the payment processor`,
			({ who }) => `importing ${who} into Autumn`,
		),
		successUrl: ({ url }) => `when they finish, send them to ${url}`,
		returnUrl: ({ url }) => `coming back to ${url} afterwards`,
		thenAttach: ({ plan }) => `then attaching ${plan}`,
		trialDays: ({ length, unit }) => `with a ${length}-${unit} free trial`,
		trialCard: { required: "card required for the trial", notRequired: "no card needed for the trial" },
		planTrial: { on: "with the plan's free trial", off: "without the plan's free trial" },
		noTrial: "without a free trial, charging straight away",
		quantity: ({ quantity, feature }) => `${quantity} of ${feature}`,
		licenses: ({ quantity, plan }) => `${quantity} licenses of ${plan}`,
		proration: {
			prorate_immediately: "charging or crediting the prorated difference now",
			none: "without prorating the change",
			bill_difference: "billing the difference",
		},
		prorateOff: "without prorating the change",
		redirect: {
			always: "always sending the customer to a payment page",
			if_required: "sending the customer to a payment page only if payment is needed",
			never: "never sending the customer to a payment page",
		},
		invoice: "billed by invoice instead of charging a card",
		forceCheckout: "always through Stripe Checkout",
		reward: ({ reward }) => `applying the reward ${reward}`,
		promotionCode: ({ code }) => `applying the promotion code ${code}`,
		carryBalances: "carrying over the remaining balances",
		carryBalancesOf: ({ features }) => `carrying over the remaining balances of ${features}`,
		carryUsage: "carrying over the usage so far",
		carryUsageOf: ({ features }) => `carrying over the usage so far of ${features}`,
		version: ({ version }) => `version ${version} of the plan`,
		newSubscription: "on a separate, new subscription",
		startsAt: ({ time }) => `starting at ${time}`,
		endsAt: ({ time }) => `ending at ${time}`,
		removePlans: ({ plans }) => `removing ${plans}`,
		openInNewTab: "opening the page in a new tab",
		checkoutDialog: ({ dialog }) => `asking the customer to confirm in the ${dialog} first`,
		customize: "with custom pricing for this customer",
		checkoutSettings: ({ value }) => `extra Stripe Checkout settings: ${value}`,
		urls: { payment: "payment page URL", checkout: "checkout page URL", portal: "billing portal URL", setup: "payment setup page URL" },
		url: ({ what }) => `the ${what}`,
		hasUrl: ({ what, neg }) => (neg ? `Autumn didn't return a ${what}` : `Autumn returned a ${what}`),
	},
	customers: {
		getOrCreate: op(
			({ who }) => `create ${who} in Autumn if they don't exist yet`,
			({ who }) => `${who}, created in Autumn if they don't exist yet`,
		),
		get: op(
			({ who }) => `fetch ${who} from Autumn`,
			({ who }) => `${who} from Autumn`,
		),
		list: op(
			() => "fetch a page of customers",
			() => "a page of customers",
		),
		update: step(
			({ who }) => `update ${who}`,
			({ who }) => `updating ${who}`,
		),
		delete: step(
			({ who }) => `delete ${who} from Autumn`,
			({ who }) => `deleting ${who}`,
		),
		listSubscriptions: op(
			() => "fetch a page of subscriptions",
			() => "a page of subscriptions",
		),
		listPurchases: op(
			() => "fetch a page of one-off purchases",
			() => "a page of one-off purchases",
		),
		advanceTestClock: step(
			({ who, time }) => `move the Stripe test clock of ${who} forward to ${time}`,
			({ who, time }) => `moving the Stripe test clock of ${who} forward to ${time}`,
		),
		name: ({ value }) => `name: ${value}`,
		email: ({ value }) => `email: ${value}`,
		fingerprint: ({ value }) => `device fingerprint ${value}, so the same person can't start another free trial`,
		createInStripe: "also creating them in Stripe now",
		stripeId: ({ value }) => `linked to the Stripe customer ${value}`,
		autoEnable: ({ plan }) => `starting them on ${plan}`,
		expand: ({ items }) => `including ${items}`,
		expandItems: {
			invoices: "their invoices",
			invoice_previews: "their upcoming invoices",
			trials_used: "the free trials they've used",
			rewards: "their rewards",
			entities: "their entities",
			referrals: "their referrals",
			payment_method: "their payment method",
			billing_details: "their billing details",
			"subscriptions.plan": "the plan of each subscription",
			"purchases.plan": "the plan of each purchase",
			"balances.feature": "the feature of each balance",
			"flags.feature": "the feature of each flag",
		},
		deleteInStripe: "also deleting them in Stripe",
		pageSize: ({ count }) => `up to ${count} per page`,
		offset: ({ count }) => `skipping the first ${count}`,
		metadata: ({ value }) => `metadata: ${value}`,
	},
	controls: {
		heading: "billing controls:",
		overageOn: ({ feature }) => `allow usage of ${feature} beyond the balance, billed as overage`,
		overageOff: ({ feature }) => `stop usage of ${feature} at the balance`,
		spendLimit: ({ feature, limit }) => `cap overage spending on ${feature} at ${limit}`,
		spendLimitOff: ({ feature }) => `turn off the spend limit on ${feature}`,
		spendNoOverageBill: ({ feature }) => `cap overage on ${feature} without billing for it`,
		usageLimit: ({ feature, limit, interval }) => `limit ${feature} to ${limit} ${interval}`,
		usageAlert: ({ feature, threshold }) => `alert when usage of ${feature} reaches ${threshold}`,
		usageAlertPercent: ({ feature, threshold }) => `alert when ${threshold}% of ${feature} is used`,
		alertName: ({ alert, name }) => `${alert} (${name})`,
		autoTopup: ({ feature, quantity, threshold }) => `top up ${quantity} of ${feature} when its balance drops below ${threshold}`,
		autoTopupOff: ({ feature }) => `turn off automatic top-ups of ${feature}`,
		perInterval: { minute: "a minute", hour: "an hour", day: "a day", week: "a week", month: "a month", year: "a year" },
	},
	entities: {
		create: op(
			({ entity, who, feature }) => `create ${entity} under ${who}, counted against ${feature}`,
			({ entity, who, feature }) => `a new ${entity} under ${who}, counted against ${feature}`,
		),
		createMany: op(
			({ who }) => `create entities under ${who}`,
			({ who }) => `new entities under ${who}`,
		),
		get: op(
			({ entity }) => `fetch ${entity}`,
			({ entity }) => entity,
		),
		update: step(
			({ entity }) => `update ${entity}`,
			({ entity }) => `updating ${entity}`,
		),
		delete: step(
			({ entity }) => `delete ${entity}`,
			({ entity }) => `deleting ${entity}`,
		),
		list: op(
			() => "fetch a page of entities",
			() => "a page of entities",
		),
		transfer: step(
			({ who }) => `move a plan between entities of ${who}`,
			({ who }) => `moving a plan between entities of ${who}`,
		),
		name: ({ value }) => `named ${value}`,
	},
	catalog: {
		getPlan: op(
			({ plan }) => `fetch ${plan}`,
			({ plan }) => plan,
		),
		listPlans: op(
			() => "fetch every plan",
			() => "every plan",
		),
		listPlansFor: op(
			({ who }) => `fetch every plan, with whether each is an upgrade or a downgrade for ${who}`,
			({ who }) => `every plan, with whether each is an upgrade or a downgrade for ${who}`,
		),
		createPlan: op(
			({ plan }) => `create ${plan}`,
			({ plan }) => `a new ${plan}`,
		),
		updatePlan: step(
			({ plan }) => `update ${plan}`,
			({ plan }) => `updating ${plan}`,
		),
		deletePlan: step(
			({ plan }) => `delete ${plan}`,
			({ plan }) => `deleting ${plan}`,
		),
		getFeature: op(
			({ feature }) => `fetch ${feature}`,
			({ feature }) => feature,
		),
		listFeatures: op(
			() => "fetch every feature",
			() => "every feature",
		),
		createFeature: op(
			({ feature }) => `create ${feature}`,
			({ feature }) => `a new ${feature}`,
		),
		updateFeature: step(
			({ feature }) => `update ${feature}`,
			({ feature }) => `updating ${feature}`,
		),
		deleteFeature: step(
			({ feature }) => `delete ${feature}`,
			({ feature }) => `deleting ${feature}`,
		),
		price: ({ amount, interval }) => `priced at ${amount} per ${interval}`,
		oneOffPrice: ({ amount }) => `priced at ${amount}, paid once`,
		name: ({ value }) => `named ${value}`,
		addOn: "an add-on, bought on top of another plan",
		autoEnable: "given to every new customer automatically",
		items: ({ count }) => (count === "1" ? "with 1 plan item" : `with ${count} plan items`),
		featureType: {
			boolean: "an on/off feature",
			metered: "a metered feature",
			credit_system: "a credit system",
			static: "an on/off feature",
			single_use: "a consumable feature",
			continuous_use: "a non-consumable feature, like seats",
		},
		consumable: { on: "used up and reset each period", off: "kept until removed, like seats" },
	},
	referrals: {
		createCode: op(
			({ who, program }) => `get the referral code of ${who} in ${program}, creating it if needed`,
			({ who, program }) => `the referral code of ${who} in ${program}`,
		),
		redeemCode: step(
			({ code, who }) => `redeem ${code} as a referral for ${who}`,
			({ code, who }) => `redeeming ${code} as a referral for ${who}`,
		),
		redeemReward: step(
			({ code, who }) => `redeem ${code} as a promo code for ${who}`,
			({ code, who }) => `redeeming ${code} as a promo code for ${who}`,
		),
		program: ({ id }) => `the referral program ${id}`,
	},
	resources: {
		invoices: { a: "an Autumn invoice", one: "Autumn invoice", many: "Autumn invoices" },
		rewards: { a: "an Autumn reward", one: "Autumn reward", many: "Autumn rewards" },
		referralPrograms: { a: "a referral program", one: "referral program", many: "referral programs" },
		webhooks: { a: "an Autumn webhook", one: "Autumn webhook", many: "Autumn webhooks" },
		keys: { a: "a customer access token", one: "customer access token", many: "customer access tokens" },
		sandboxes: { a: "an Autumn sandbox", one: "Autumn sandbox", many: "Autumn sandboxes" },
		logs: { a: "an Autumn request log", one: "Autumn request log", many: "Autumn request logs" },
		platform: { a: "a platform organization", one: "platform organization", many: "platform organizations" },
	},
	generic: {
		create: op(
			({ a }) => `create ${a}`,
			({ resource }) => `a new ${resource}`,
		),
		get: op(
			({ a }) => `fetch ${a}`,
			({ a }) => a,
		),
		list: op(
			({ resources }) => `fetch ${resources}`,
			({ resources }) => resources,
		),
		update: step(
			({ a }) => `update ${a}`,
			({ a }) => `updating ${a}`,
		),
		delete: step(
			({ a }) => `delete ${a}`,
			({ a }) => `deleting ${a}`,
		),
		other: op(
			({ action, resource }) => `${action} ${resource}`,
			({ action, resource }) => `the result of the request to ${action} ${resource}`,
		),
	},
	licenses: {
		assign: step(
			({ plan, who }) => `assign licenses of ${plan} to entities of ${who}`,
			({ plan, who }) => `assigning licenses of ${plan} to entities of ${who}`,
		),
		release: step(
			({ plan, who }) => `release licenses of ${plan} from entities of ${who}`,
			({ plan, who }) => `releasing licenses of ${plan} from entities of ${who}`,
		),
	},
	handler: {
		routes: "Autumn's backend routes for the React hooks",
		serve: ({ methods }) => `serve Autumn's backend routes for the React hooks, answering ${methods} requests`,
		identify: ({ customer }) => `identifying the customer as ${customer}`,
		identifyWith: ({ customer, details }) => `identifying the customer as ${customer}, along with ${details}`,
		identifyFn: "identifying the customer by:",
		identifyAfter: ({ identify }) => `${identify}, after:`,
		identifyBy: ({ fn }) => `identifying the customer with ${fn}`,
		secretKey: ({ key }) => `authenticated with ${key}`,
		autumnURL: ({ url }) => `talking to Autumn at ${url}`,
		pathPrefix: ({ path }) => `under the path ${path}`,
		forward: step(
			({ request, who }) => `pass ${request} on to Autumn for ${who}`,
			({ request, who }) => `passing ${request} on to Autumn for ${who}`,
		),
		customerData: ({ value }) => `along with ${value}`,
	},
	react: {
		useCustomer: op(
			() => "load the customer's plans and balances from Autumn",
			() => "the customer's plans and balances from Autumn",
		),
		useCustomerExpanded: op(
			({ items }) => `load the customer's plans and balances from Autumn, including ${items}`,
			({ items }) => `the customer's plans and balances from Autumn, including ${items}`,
		),
		useEntity: op(
			({ entity }) => `load ${entity} of the customer from Autumn`,
			({ entity }) => `${entity} of the customer, from Autumn`,
		),
		usePricingTable: op(
			() => "load the plans for the pricing table, with the customer's options on each",
			() => "the plans for the pricing table",
		),
		useListPlans: op(
			() => "load every plan, with whether each is an upgrade or a downgrade for the customer",
			() => "every plan, as it applies to the customer",
		),
		useReferrals: op(
			({ program }) => `load the customer's referral code in ${program}`,
			({ program }) => `the customer's referral code in ${program}`,
		),
		useListEvents: op(
			({ feature }) => `load the customer's usage events of ${feature}, a page at a time`,
			({ feature }) => `the customer's usage events of ${feature}`,
		),
		useAggregateEvents: op(
			({ feature }) => `load the customer's usage totals of ${feature}`,
			({ feature }) => `the customer's usage totals of ${feature}`,
		),
		usePaywall: op(
			({ feature }) => `load what to show on a paywall for ${feature}`,
			({ feature }) => `the paywall details for ${feature}`,
		),
		refetch: op(
			() => "reload the customer from Autumn",
			() => "the customer, reloaded from Autumn",
		),
	},
	results: {
		keep: ({ call }) => `${call}, and keep the result`,
		balance: ({ feature }) => `the balance of ${feature}`,
		newBalance: ({ feature }) => `the updated balance of ${feature}`,
		failed: ({ neg }) => (neg ? "Autumn didn't return an error" : "Autumn returned an error"),
	},
};
