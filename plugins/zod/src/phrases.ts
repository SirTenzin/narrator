type P<K extends string> = (p: Record<K, string>) => string;

/** Everything the Zod plugin says. Arguments are already-rendered markup strings. */
export type ZodPhrases = {
	schema: P<"type">;
	/** `Schema.parse(value)` read as a value: the validated data (parsing throws when it doesn't match). */
	parse: P<"value" | "schema">;
	/** `Schema.parse(value);` on its own: a validation step. */
	parseStep: P<"value" | "schema">;
	/** `Schema.safeParse(value)`: an outcome object rather than the data. */
	safeParse: P<"value" | "schema">;
	/** Stands in for a value shown as a block of lines underneath. */
	following: string;
	base: Record<"string" | "number" | "boolean" | "date" | "any" | "unknown" | "null" | "bigint", string>;
	/** `fields` is already a rendered list of field names. */
	object: P<"fields">;
	array: P<"item">;
	enum: P<"options">;
	literal: P<"value">;
	union: P<"options">;
	record: P<"value">;
	/** A record whose value schema isn't recognised. */
	recordOfAnything: string;
	nativeEnum: P<"name">;
	extend: P<"type">;
	/** A type followed by its modifiers, e.g. "text (optional, at most 5)". */
	withModifiers: (p: { type: string; modifiers: string[] }) => string;
	modifiers: {
		optional: string;
		nullable: string;
		default: P<"value">;
		min: P<"value">;
		max: P<"value">;
		int: string;
		positive: string;
		nonnegative: string;
		email: string;
		url: string;
		uuid: string;
		refine: string;
		transform: string;
	};
};
