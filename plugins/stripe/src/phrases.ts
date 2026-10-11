type P<K extends string> = (p: Record<K, string>) => string;

/** What a call does as a step (`do`) and what it gives back as a value (`done`). */
export type MethodPhrase = {
	do: P<"target" | "resource" | "resources">;
	done: P<"target" | "resource" | "resources">;
	/** For list methods: everything across all pages, as a `for await` loop or `autoPagingEach` sees it. */
	all?: P<"target" | "resource" | "resources">;
};

/** Everything the Stripe plugin says. Arguments are already-rendered markup strings. */
export type StripePhrases = {
	/** Resource path (`customers`, `checkout.sessions`) -> its name, one and many. */
	resources: Record<string, { one: string; many: string }>;
	target: {
		/** `stripe.subscriptions.retrieve(sub.id)` -> the subscription named by `sub`. */
		named: P<"resource" | "name">;
		/** `currentStripeCustomer.id`, whose name already says what it is. */
		itself: P<"name">;
		/** A fetch of an object the code already holds: its latest state. */
		current: P<"target">;
		byId: P<"resource" | "id">;
		one: P<"resource">;
		/** A singleton like `stripe.balance.retrieve()`. */
		only: P<"resource">;
		many: P<"resources">;
	};
	/** Keyed by SDK method name. */
	methods: Record<string, MethodPhrase>;
	/** The action and its headline details (customer, price, amount...) in reading order. */
	headline: (p: { action: string; details: string[] }) => string;
	params: {
		customer: P<"value">;
		price: P<"value">;
		product: P<"value">;
		items: P<"items">;
		itemsFrom: P<"value">;
		item: P<"price">;
		itemWithQuantity: P<"price" | "quantity">;
		/** An inline price defined by `price_data`. */
		inlinePrice: string;
		/** A subscription or checkout item with more than a price and quantity. */
		itemBlock: string;
		amount: P<"amount" | "unit">;
		amountField: P<"key" | "amount" | "unit">;
		currency: P<"currency">;
		recurring: P<"every">;
		interval: Record<"day" | "week" | "month" | "year", string>;
		everyN: P<"count" | "unit">;
		trialDays: P<"days">;
		trialEnd: P<"value">;
		trialEndNow: string;
		cancelAtPeriodEnd: { on: string; off: string };
		cancelAt: P<"value">;
		proration: Record<"none" | "create_prorations" | "always_invoice", string>;
		collection: Record<"charge_automatically" | "send_invoice", string>;
		daysUntilDue: P<"days">;
		expand: P<"paths">;
		expandFrom: P<"value">;
		limit: P<"count">;
		/** A limit whose own name already says "per page". */
		limitNamed: P<"count">;
		nextPage: string;
		previousPage: string;
		startingAfter: P<"value">;
		endingBefore: P<"value">;
		query: P<"query">;
		mode: Record<"payment" | "subscription" | "setup", string>;
		percentOff: P<"percent">;
		amountOff: P<"amount" | "unit">;
		duration: Record<"once" | "forever", string>;
		durationMonths: P<"months">;
		unixTime: P<"key" | "value">;
		field: P<"key" | "value">;
		settingsIn: P<"value">;
		/** The `{ ...rest }` part of params. */
		spread: P<"value">;
	};
	/** Smallest currency unit by lowercase ISO code; `unknownUnit` when the currency isn't a literal. */
	minorUnits: Record<string, string>;
	unknownUnit: string;
	options: {
		idempotencyKey: P<"key">;
		stripeAccount: P<"account">;
		apiVersion: P<"version">;
		field: P<"key" | "value">;
	};
	client: {
		create: P<"key">;
		maxNetworkRetries: P<"count">;
	};
	pages: {
		paged: P<"items">;
		eachOf: P<"item" | "items">;
		toArray: P<"items">;
		toArrayLimit: P<"items" | "limit">;
		filtered: P<"items" | "filters">;
	};
	webhooks: {
		verify: P<"payload" | "signature" | "secret">;
		event: P<"payload" | "signature" | "secret">;
		testHeader: P<"payload" | "secret">;
		switch: P<"event">;
		case: P<"names">;
		otherwise: string;
		casesOrOtherwise: P<"names">;
		/** `"invoice.paid"` -> `"invoice.paid" (an invoice was paid)`. */
		eventName: P<"name" | "meaning">;
		eventObject: P<"event">;
		previousAttributes: P<"event">;
	};
	/** Common event types -> what happened. Others are worded from their own parts. */
	events: Record<string, string>;
	/** Event type parts: `customer.subscription.trial_will_end` -> object "subscription", happening "trial will end". */
	eventParts: P<"object" | "happening">;
};
