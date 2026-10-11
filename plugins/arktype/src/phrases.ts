type P<K extends string> = (p: Record<K, string>) => string;

/** Everything the ArkType plugin says. Arguments are already-rendered markup strings. */
export type ArkTypePhrases = {
	schema: P<"type">;
	/** ArkType's root keywords. */
	base: Record<
		"string" | "number" | "bigint" | "boolean" | "symbol" | "null" | "undefined" | "unknown" | "never" | "object" | "date" | "array" | "true" | "false",
		string
	>;
	object: P<"fields">;
	emptyObject: string;
	array: P<"item">;
	tuple: P<"items">;
	literal: P<"value">;
	union: P<"options">;
	/** A union of literals: `"'a' | 'b'"`, `type.enumerated("a", "b")`. */
	oneOf: P<"options">;
	intersection: P<"types">;
	instance: P<"name">;
	/** `"[string]": "number"`: any key of that type. */
	anyKey: P<"key" | "value">;
	/** `"+": "reject"` / `"+": "delete"`. */
	rejectsOthers: string;
	dropsOthers: string;
	merged: P<"type" | "extra">;
	/** A name the definition refers to, like a scope alias. */
	alias: P<"name">;
	withModifiers: (p: { type: string; modifiers: string[] }) => string;
	modifiers: {
		optional: string;
		nullable: string;
		default: P<"value">;
		/** Number and date bounds. */
		atLeast: P<"value">;
		atMost: P<"value">;
		moreThan: P<"value">;
		lessThan: P<"value">;
		exactly: P<"value">;
		/** String and array bounds are lengths. */
		lengthAtLeast: P<"value">;
		lengthAtMost: P<"value">;
		lengthMoreThan: P<"value">;
		lengthLessThan: P<"value">;
		lengthExactly: P<"value">;
		divisibleBy: P<"value">;
		/** Keyword refinements: `string.email`, `number.integer`... */
		email: string;
		url: string;
		uuid: string;
		ip: string;
		semver: string;
		creditCard: string;
		alpha: string;
		alphanumeric: string;
		digits: string;
		numeric: string;
		json: string;
		isoDate: string;
		integer: string;
		safe: string;
		epoch: string;
		trim: string;
		lower: string;
		upper: string;
		capitalize: string;
		normalize: string;
		/** `string.numeric.parse`, `string.date.parse`, `string.json.parse`: converted to another type. */
		parsedAs: P<"type">;
		/** A sub-keyword the plugin doesn't know, by name. */
		other: P<"name">;
		narrow: string;
		pipe: string;
		to: P<"type">;
		description: P<"text">;
		brand: P<"name">;
		matching: P<"pattern">;
	};
	validate: {
		/** `const out = User(data)`: either the data or the problems found. */
		check: P<"value" | "schema">;
		assert: P<"value" | "schema">;
		assertStep: P<"value" | "schema">;
		allows: (p: { value: string; schema: string; neg: boolean }) => string;
		/** `out.summary` on a failed check. */
		summary: P<"result">;
	};
	scope: P<"names">;
	/** `type.errors`, for `out instanceof type.errors`. */
	errors: string;
};
