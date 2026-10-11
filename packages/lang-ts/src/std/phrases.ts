type P<K extends string> = (p: Record<K, string>) => string;
type Neg<K extends string> = (p: Record<K, string> & { neg: boolean }) => string;

/** Everything the JS built-ins plugin says. Arguments are already-rendered markup strings. */
export type StdPhrases = {
	/** Name for a lambda's item when its parameter has no usable name. */
	item: string;
	/** A lambda's parameter read as one of many: "each price". */
	each: P<"item">;
	whether: P<"cond">;
	nothing: string;
	someCssClasses: string;
	/** Exact source text -> phrase. */
	constants: {
		"Number.MAX_SAFE_INTEGER": string;
		"Number.POSITIVE_INFINITY": string;
		Infinity: string;
		NaN: string;
		"Number.EPSILON": string;
		"Number.NaN": string;
		"Number.NEGATIVE_INFINITY": string;
		"Number.MIN_SAFE_INTEGER": string;
	};
	map: {
		passedThrough: P<"list" | "fn">;
		/** "the IDs of customer products"; `props` is the property name in the plural. */
		pluck: P<"props" | "list">;
		/** The body already ends in "each <item>": "the price of each item in items". */
		eachIn: P<"value" | "list">;
		forEach: P<"value" | "item" | "list">;
		eachInto: P<"list" | "value">;
		withEachInto: P<"list" | "item" | "value">;
		withEachIntoBlock: P<"list" | "item">;
	};
	flatMap: {
		pluck: P<"props" | "list">;
		eachIn: P<"value" | "list">;
		forEach: P<"value" | "item" | "list">;
		into: P<"item" | "list" | "value">;
		intoBlock: P<"item" | "list">;
	};
	filter: {
		dropEmpty: P<"list">;
		passing: P<"list" | "fn">;
		where: P<"list" | "cond">;
		/** The lambda destructures its item, so the condition is about the item's own fields. */
		whose: P<"list" | "cond">;
		/** `items` is the item name in the plural. */
		checkBlock: P<"list" | "items">;
	};
	find: {
		whose: P<"list" | "cond">;
		firstWhere: P<"item" | "list" | "cond">;
		firstCheckBlock: P<"item" | "list">;
		lastWhere: P<"item" | "list" | "cond">;
		indexWhere: P<"item" | "list" | "cond">;
	};
	some: {
		passes: Neg<"list" | "fn">;
		checkBlock: Neg<"item" | "list">;
		whose: Neg<"list" | "cond">;
		where: Neg<"item" | "list" | "cond" | "article">;
	};
	every: {
		passes: Neg<"list" | "fn">;
		checkBlock: Neg<"item" | "list">;
		whose: Neg<"list" | "cond">;
		where: Neg<"item" | "list" | "cond">;
	};
	isIn: Neg<"value" | "list">;
	/** `article` is the locale's article for `item`. */
	/** `options` is already a rendered "a, b, or c" list. */
	isOneOf: Neg<"value" | "options">;
	isList: Neg<"value">;
	reduce: {
		totalProp: P<"prop" | "list">;
		total: P<"value" | "list">;
		/** `xs.reduce((a, b) => a + b)`: the items themselves added up. */
		sum: P<"list">;
		/** A total that starts from a non-zero value; `total` is one of the phrases above. */
		plusStart: P<"start" | "total">;
		firstItem: string;
		step: P<"value">;
		/** `acc` is the running total's name, or "" when the lambda has none. */
		block: P<"list" | "start" | "item" | "acc">;
	};
	sort: {
		sorted: P<"list">;
		using: P<"list" | "fn">;
		/** The sort key when items are compared directly rather than by a field. */
		value: string;
		smallestFirst: P<"list" | "key">;
		largestFirst: P<"list" | "key">;
		alphabetical: P<"list" | "key">;
		reverseAlphabetical: P<"list" | "key">;
		byRule: P<"list">;
		compare: P<"a" | "b" | "expr">;
	};
	join: { with: P<"list" | "sep">; commas: P<"list"> };
	slice: {
		copy: P<"list">;
		first: P<"count" | "list">;
		last: P<"count" | "list">;
		from: P<"list" | "start">;
		range: P<"list" | "start" | "end">;
	};
	at: { first: P<"list">; last: P<"list"> };
	/** `rest` is already a rendered list. */
	concat: P<"list" | "rest">;
	push: { everything: P<"source" | "list">; add: P<"values" | "list">; addThese: P<"list"> };
	unshift: P<"values" | "list">;
	pop: P<"list">;
	shift: P<"list">;
	indexOf: P<"value" | "list">;
	object: {
		keys: P<"value">;
		values: P<"value">;
		entries: P<"value">;
		fromEntries: P<"value">;
		merged: P<"sources">;
		copyInto: P<"sources" | "target">;
		copiedInto: P<"sources" | "target">;
	};
	arrayFrom: { mapped: P<"source" | "value">; sized: P<"count">; sizedEach: P<"count" | "value">; range: P<"count">; list: P<"source"> };
	collection: {
		/** `ownerPossessive` is `owner` run through the locale's possessive. */
		get: P<"owner" | "ownerPossessive" | "key">;
		set: P<"value" | "key" | "owner">;
		add: P<"value" | "owner">;
		remove: P<"value" | "owner">;
		clear: P<"owner">;
		uniqueOf: P<"value">;
		emptySet: string;
		lookupFrom: P<"value">;
		emptyLookup: string;
		promise: string;
	};
	text: {
		asText: P<"value">;
		lowercase: P<"value">;
		uppercase: P<"value">;
		trimmed: P<"value">;
		split: P<"value" | "sep">;
		replace: P<"value" | "search" | "replacement">;
		replaceAll: P<"value" | "search" | "replacement">;
		padStart: P<"value" | "length">;
		charAt: P<"value" | "index">;
		compare: P<"value" | "other">;
		startsWith: Neg<"value" | "prefix">;
		endsWith: Neg<"value" | "suffix">;
		matches: Neg<"value" | "pattern">;
		/** `text.match(re)`; `all` when the pattern is global. */
		match: (p: { value: string; pattern: string; all: boolean }) => string;
		matchAll: P<"value" | "pattern">;
	};
	number: {
		asNumber: P<"value">;
		asWholeNumber: P<"value">;
		toFixed: P<"value" | "places">;
		isFinite: Neg<"value">;
		/** Note `neg` here means "is NaN" was negated, i.e. the value IS valid. */
		isNaN: Neg<"value">;
		isInteger: Neg<"value">;
	};
	date: { from: P<"value">; timestamp: P<"value">; isoString: P<"value">; now: string; utc: P<"parts"> };
	promise: {
		/** `item` names the resolved result inside the callback. */
		then: P<"value" | "item" | "result">;
		catch: P<"value" | "fallback">;
		catchBlock: P<"value">;
		/** `p.finally(() => x)`: `action` runs whether `value` succeeds or fails. */
		finally: P<"value" | "action">;
		finallyBlock: P<"value">;
		/** `Promise.race([...])`, read as a block of the racers. */
		race: (p: { stmt: boolean }) => string;
	};
	json: { stringify: P<"value">; parse: P<"value"> };
	math: {
		/** `many`: more than two values. */
		max: (p: { values: string; many: boolean }) => string;
		min: (p: { values: string; many: boolean }) => string;
		round: P<"value">;
		floor: P<"value">;
		ceil: P<"value">;
		abs: P<"value">;
		random: string;
	};
	exit: (p: { code: string | null }) => string;
	bigint: P<"value">;
	/** `ms` is a rendered duration in milliseconds. */
	wait: P<"ms">;
	/** A pause used as a value, e.g. inside `Promise.race`. */
	pause: P<"ms">;
	timeoutSignal: P<"ms">;
	clearTimer: P<"timer">;
	setInterval: (p: { ms: string; stmt: boolean }) => string;
	event: { preventDefault: P<"event">; stopPropagation: P<"event"> };
	deepCopy: P<"value">;
	/** `stmt`: scheduled as a step; otherwise the timer is kept as a value. */
	setTimeout: (p: { ms: string; stmt: boolean }) => string;
	/** `message` is the logged text (if any); `details` is a rendered list of the other logged values (if any). */
	log: Record<"log" | "debug" | "warn" | "error", (p: { message: string | null; details: string | null }) => string>;
	parallel: {
		/** `stmt`: run as an action rather than read as a value; `settled`: keep going when some fail. */
		list: (p: { stmt: boolean; settled: boolean }) => string;
		each: (p: { item: string; list: string; stmt: boolean; settled: boolean }) => string;
		other: (p: { value: string; stmt: boolean; settled: boolean }) => string;
	};
	/** A chain like `xs.filter(...).map(...)` read as numbered steps applied to "them". */
	pipe: {
		steps: P<"source">;
		/** One numbered step; `n` is 1-based. */
		stage: P<"n" | "step">;
		them: string;
		dropEmpty: string;
		keepWhere: P<"cond">;
		keepWhose: P<"cond">;
		keepCheckBlock: P<"items">;
		keepPassing: P<"fn">;
		/** `flat`: the results are flattened into one list. */
		passThrough: (p: { fn: string; flat: boolean }) => string;
		takeAll: P<"props">;
		takeEach: P<"prop">;
		/** A destructured item, listing the names it unpacks. */
		destructuredItem: P<"names">;
		turnEach: (p: { item: string; value: string; flat: boolean }) => string;
		turnEachBlock: (p: { item: string; flat: boolean }) => string;
		/** `last`: findLast rather than find. */
		takeWhere: (p: { cond: string; last: boolean }) => string;
		takeWhose: (p: { cond: string; last: boolean }) => string;
		takePassing: (p: { fn: string; last: boolean }) => string;
		takeCheckBlock: (p: { last: boolean }) => string;
		/** `some`: any rather than all. `cond` has the item's name stripped from its front. */
		checkHas: (p: { cond: string; some: boolean }) => string;
		checkPasses: (p: { fn: string; some: boolean }) => string;
		checkPassesBlock: (p: { some: boolean }) => string;
		dedupe: string;
		joinWith: P<"sep">;
		joinCommas: string;
		reverse: string;
	};
};
