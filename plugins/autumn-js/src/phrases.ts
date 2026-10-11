type P<K extends string> = (p: Record<K, string>) => string;

/** One SDK call as a step (`do`) and as a value (`done`). */
export type Op<K extends string> = { do: P<K>; done: P<K> };

/** How a named thing is referred to: by a literal ID, by a value whose name already says what it is, or by some other value. */
export type Term = { id: P<"id">; it: string; named: P<"value"> };

/** Everything the autumn-js plugin says. Arguments are already-rendered markup strings. */
export type AutumnPhrases = {
	terms: {
		customer: Term;
		feature: Term;
		plan: Term;
		entity: Term;
		event: Term;
		lock: Term;
		code: Term;
		model: Term;
		/** Fields of an object of details: `their name and email`. */
		their: P<"fields">;
		/** `entity "user_abc" of the customer "org_123"`. */
		entityOf: P<"entity" | "customer">;
		/** Several plans: `the plans pro and storage`. */
		plans: P<"ids">;
		features: P<"ids">;
		/** `1 use`, `3 uses`; `count` is null when the amount isn't a literal. */
		uses: (p: { amount: string; count: number | null }) => string;
	};
	client: {
		create: P<"key">;
		envKey: string;
		serverURL: P<"url">;
		failOpen: { on: string; off: string };
		timeout: P<"ms">;
		version: P<"version">;
		defaultReturnUrl: P<"url">;
	};
	check: {
		can: P<"who" | "feature">;
		cannot: P<"who" | "feature">;
		atLeast: P<"who" | "feature" | "amount">;
		lessThan: P<"who" | "feature" | "amount">;
		hasPlan: P<"who" | "plan">;
		lacksPlan: P<"who" | "plan">;
		/** `Check whether …`. */
		do: P<"condition">;
		/** `whether …`, for a check used as a value. */
		done: P<"condition">;
		/** `sendEvent: true`: record the usage in the same request. */
		andRecord: P<"check" | "uses">;
		/** `sendEvent` with a `lock`: reserve the usage until it's confirmed or released. */
		andHold: P<"check" | "amount" | "lock">;
		lockExpires: P<"time">;
		withPreview: string;
		/** The answer destructured on its own: `const { allowed } = await autumn.check(…)`. */
		callAnswer: P<"call" | "name">;
		/** `const result = await autumn.check(…)`: "result" needs no naming. */
		keepAnswer: P<"call">;
		/** The local check of a React hook, which reads the customer data already loaded. */
		local: P<"check">;
		/** The 0.x hook `dialog` option: a paywall shown when access is denied. */
		dialog: P<"dialog">;
	};
	track: {
		record: Op<"uses" | "feature" | "who">;
		giveBack: Op<"uses" | "feature" | "who">;
		event: Op<"uses" | "event" | "who">;
		tokens: Op<"tokens" | "model" | "who">;
		/** `1000 input and 500 output tokens`. */
		tokenCounts: P<"input" | "output">;
		/** Token counts that aren't literals go in bullets. */
		tokenUsage: string;
		tokenField: Record<
			"inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "audioInputTokens" | "audioOutputTokens" | "reasoningTokens",
			P<"count">
		>;
		creditFeature: P<"feature">;
		batch: Op<"events">;
		properties: P<"value">;
		timestamp: P<"value">;
		overage: { overflow: string; cap: string };
		/** `async: false`. */
		wait: string;
		/** `async: true`. */
		queue: string;
		idempotencyKey: P<"key">;
		customerData: P<"value">;
		entityData: P<"value">;
	};
	balances: {
		setUsage: Op<"feature" | "who" | "value">;
		setRemaining: Op<"feature" | "who" | "value">;
		setBalance: Op<"feature" | "who" | "value">;
		update: Op<"feature" | "who">;
		grant: Op<"amount" | "feature" | "who">;
		grantSome: Op<"feature" | "who">;
		remove: Op<"feature" | "who">;
		list: Op<"who">;
		resetsEvery: P<"interval">;
		oneOff: string;
		confirm: Op<"lock">;
		confirmAs: Op<"lock" | "value">;
		release: Op<"lock">;
		finalize: Op<"lock" | "action">;
		/** 0.x `customers.updateBalances(id, { balances: [...] })`. */
		setBalances: Op<"who">;
		balanceItem: P<"feature" | "value">;
	};
	events: {
		aggregate: Op<"feature" | "who">;
		list: Op<"feature" | "who">;
		range: Record<"24h" | "7d" | "30d" | "90d" | "last_cycle" | "1bc" | "3bc", string>;
		over: P<"range">;
		perBin: P<"size">;
		groupBy: P<"field">;
		between: P<"start" | "end">;
	};
	billing: {
		attach: Op<"plan" | "who">;
		multiAttach: Op<"plans" | "who">;
		previewAttach: Op<"plan" | "who">;
		previewMultiAttach: Op<"plans" | "who">;
		checkout: Op<"plan" | "who">;
		update: Op<"plan" | "who">;
		previewUpdate: Op<"plan" | "who">;
		cancelEnd: Op<"plan" | "who">;
		cancelNow: Op<"plan" | "who">;
		uncancel: Op<"plan" | "who">;
		multiUpdate: Op<"who">;
		portal: Op<"who">;
		/** The React hooks, which send the browser to the portal. */
		openPortal: Op<"who">;
		setupPayment: Op<"who">;
		schedule: Op<"who">;
		verify: Op<"who">;
		import: Op<"who">;
		successUrl: P<"url">;
		returnUrl: P<"url">;
		thenAttach: P<"plan">;
		trialDays: P<"length" | "unit">;
		trialCard: { required: string; notRequired: string };
		/** 0.x `free_trial` is a yes/no switch on the plan's own trial. */
		planTrial: { on: string; off: string };
		noTrial: string;
		quantity: P<"quantity" | "feature">;
		licenses: P<"quantity" | "plan">;
		proration: Record<"prorate_immediately" | "none" | "bill_difference", string>;
		prorateOff: string;
		redirect: Record<"always" | "if_required" | "never", string>;
		invoice: string;
		forceCheckout: string;
		reward: P<"reward">;
		promotionCode: P<"code">;
		carryBalances: string;
		carryBalancesOf: P<"features">;
		carryUsage: string;
		carryUsageOf: P<"features">;
		version: P<"version">;
		newSubscription: string;
		startsAt: P<"time">;
		endsAt: P<"time">;
		removePlans: P<"plans">;
		openInNewTab: string;
		checkoutDialog: P<"dialog">;
		customize: string;
		checkoutSettings: P<"value">;
		urls: Record<"payment" | "checkout" | "portal" | "setup", string>;
		/** A URL on a billing result, read as a value. */
		url: P<"what">;
		/** The same URL tested as a condition: `if (data?.checkout_url)`. */
		hasUrl: (p: { what: string; neg: boolean }) => string;
	};
	customers: {
		getOrCreate: Op<"who">;
		get: Op<"who">;
		list: Op<never>;
		update: Op<"who">;
		delete: Op<"who">;
		listSubscriptions: Op<never>;
		listPurchases: Op<never>;
		advanceTestClock: Op<"who" | "time">;
		name: P<"value">;
		email: P<"value">;
		fingerprint: P<"value">;
		createInStripe: string;
		stripeId: P<"value">;
		autoEnable: P<"plan">;
		expand: P<"items">;
		expandItems: Record<string, string>;
		deleteInStripe: string;
		pageSize: P<"count">;
		offset: P<"count">;
		metadata: P<"value">;
	};
	controls: {
		heading: string;
		overageOn: P<"feature">;
		overageOff: P<"feature">;
		spendLimit: P<"feature" | "limit">;
		spendLimitOff: P<"feature">;
		spendNoOverageBill: P<"feature">;
		usageLimit: P<"feature" | "limit" | "interval">;
		usageAlert: P<"feature" | "threshold">;
		usageAlertPercent: P<"feature" | "threshold">;
		alertName: P<"alert" | "name">;
		autoTopup: P<"feature" | "quantity" | "threshold">;
		autoTopupOff: P<"feature">;
		perInterval: Record<"minute" | "hour" | "day" | "week" | "month" | "year", string>;
	};
	entities: {
		create: Op<"entity" | "who" | "feature">;
		createMany: Op<"who">;
		get: Op<"entity">;
		update: Op<"entity">;
		delete: Op<"entity">;
		list: Op<never>;
		transfer: Op<"who">;
		name: P<"value">;
	};
	catalog: {
		getPlan: Op<"plan">;
		listPlans: Op<never>;
		listPlansFor: Op<"who">;
		createPlan: Op<"plan">;
		updatePlan: Op<"plan">;
		deletePlan: Op<"plan">;
		getFeature: Op<"feature">;
		listFeatures: Op<never>;
		createFeature: Op<"feature">;
		updateFeature: Op<"feature">;
		deleteFeature: Op<"feature">;
		price: P<"amount" | "interval">;
		oneOffPrice: P<"amount">;
		name: P<"value">;
		addOn: string;
		autoEnable: string;
		items: P<"count">;
		featureType: Record<"boolean" | "metered" | "credit_system" | "static" | "single_use" | "continuous_use", string>;
		consumable: { on: string; off: string };
	};
	referrals: {
		createCode: Op<"who" | "program">;
		redeemCode: Op<"code" | "who">;
		redeemReward: Op<"code" | "who">;
		program: P<"id">;
	};
	/** Resources without their own wording: `autumn.rewards.list()`, `autumn.webhooks.create(…)`. */
	resources: Record<string, { a: string; one: string; many: string }>;
	generic: {
		create: Op<"a" | "resource">;
		get: Op<"a">;
		list: Op<"resources">;
		update: Op<"a">;
		delete: Op<"a">;
		other: Op<"action" | "resource">;
	};
	licenses: {
		assign: Op<"plan" | "who">;
		release: Op<"plan" | "who">;
	};
	handler: {
		/** `autumnHandler(…)`: the backend routes Autumn's React hooks call. */
		routes: string;
		/** `export const { GET, POST } = autumnHandler(…)`. */
		serve: P<"methods">;
		identify: P<"customer">;
		identifyWith: P<"customer" | "details">;
		identifyFn: string;
		/** An identify function that works the customer out first: its steps follow. */
		identifyAfter: P<"identify">;
		identifyBy: P<"fn">;
		secretKey: P<"key">;
		autumnURL: P<"url">;
		pathPrefix: P<"path">;
		/** The low-level `autumnHandler({ request, customerId })` from `autumn-js/backend`. */
		forward: Op<"request" | "who">;
		customerData: P<"value">;
	};
	react: {
		useCustomer: Op<never>;
		useCustomerExpanded: Op<"items">;
		useEntity: Op<"entity">;
		usePricingTable: Op<never>;
		useListPlans: Op<never>;
		useReferrals: Op<"program">;
		useListEvents: Op<"feature">;
		useAggregateEvents: Op<"feature">;
		usePaywall: Op<"feature">;
		refetch: Op<never>;
	};
	results: {
		/** `const result = await …`: the variable's name adds nothing. */
		keep: P<"call">;
		/** `res.balance` after a check. */
		balance: P<"feature">;
		/** `res.balance` after `track({ async: false })`. */
		newBalance: P<"feature">;
		/** `if (error)` after a 0.x call, which returns `{ data, error }`. */
		failed: (p: { neg: boolean }) => string;
	};
};
