type P<K extends string> = (p: Record<K, string>) => string;

/** Everything the Valibot plugin says. Arguments are already-rendered markup strings. */
export type ValibotPhrases = {
	schema: P<"type">;
	base: Record<
		"string" | "number" | "bigint" | "boolean" | "date" | "any" | "unknown" | "null" | "undefined" | "void" | "never" | "nan" | "symbol" | "file" | "blob",
		string
	>;
	/** `fields` is already a rendered list of field names. */
	object: P<"fields">;
	/** `objectWithRest(entries, rest)`. */
	objectWithRest: P<"fields" | "rest">;
	emptyObject: string;
	array: P<"item">;
	tuple: P<"items">;
	set: P<"item">;
	map: P<"key" | "value">;
	picklist: P<"options">;
	enum: P<"name">;
	literal: P<"value">;
	union: P<"options">;
	/** `variant("type", [...])`: a union told apart by one field. */
	variant: P<"key" | "options">;
	intersect: P<"types">;
	record: P<"key" | "value">;
	instance: P<"name">;
	/** `partial(Schema)` / `required(Schema)` / `pick(Schema, keys)` / `omit(Schema, keys)`. */
	partial: P<"type">;
	required: P<"type">;
	pick: P<"type" | "keys">;
	omit: P<"type" | "keys">;
	/** A schema the plugin doesn't model, like `custom(...)` or `lazy(...)`. */
	custom: string;
	lazy: string;
	/** A type followed by its modifiers, e.g. "text (optional, at least 3 characters)". */
	withModifiers: (p: { type: string; modifiers: string[] }) => string;
	modifiers: {
		optional: string;
		nullable: string;
		/** `nullish`: may be null or missing. */
		nullish: string;
		required: string;
		default: P<"value">;
		fallback: P<"value">;
		minLength: P<"value">;
		maxLength: P<"value">;
		length: P<"value">;
		nonEmpty: string;
		minValue: P<"value">;
		maxValue: P<"value">;
		gtValue: P<"value">;
		ltValue: P<"value">;
		value: P<"value">;
		notValue: P<"value">;
		multipleOf: P<"value">;
		integer: string;
		finite: string;
		safeInteger: string;
		email: string;
		url: string;
		uuid: string;
		ulid: string;
		cuid2: string;
		isoDate: string;
		isoDateTime: string;
		isoTimestamp: string;
		ip: string;
		hexColor: string;
		emoji: string;
		digits: string;
		regex: P<"pattern">;
		startsWith: P<"value">;
		endsWith: P<"value">;
		includes: P<"value">;
		excludes: P<"value">;
		minSize: P<"value">;
		maxSize: P<"value">;
		minWords: P<"value">;
		maxWords: P<"value">;
		mimeType: P<"value">;
		/** `check(fn)` without a message; `checkWith` shows the message. */
		check: string;
		checkWith: P<"message">;
		checkItems: string;
		trim: string;
		toLowerCase: string;
		toUpperCase: string;
		transform: string;
		/** `toNumber()` / `toDate()` ...: converted to the named type. */
		convert: P<"type">;
		brand: P<"name">;
		readonly: string;
		description: P<"text">;
		title: P<"text">;
		/** An action the plugin doesn't know, by name. */
		other: P<"name">;
	};
	/** `parse` / `safeParse` / `is` / `assert` / `parser`. */
	validate: {
		parse: P<"value" | "schema">;
		parseStep: P<"value" | "schema">;
		safeParse: P<"value" | "schema">;
		assert: P<"value" | "schema">;
		/** `is(Schema, x)` as a condition. */
		matches: (p: { value: string; schema: string; neg: boolean }) => string;
		parser: P<"schema">;
		safeParser: P<"schema">;
		async: P<"text">;
		getDefault: P<"schema">;
		flatten: P<"issues">;
		summarize: P<"issues">;
	};
	/** `result.success` / `result.output` / `result.issues` on a `safeParse` result. */
	result: {
		success: (p: { result: string; neg: boolean }) => string;
		output: P<"result">;
		issues: P<"result">;
	};
};
