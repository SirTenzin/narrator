/** Arguments are already-rendered markup strings; `neg` asks for the negated form. */
type P<K extends string> = { [key in K]: string };
type Phrase<K extends string> = (p: P<K>) => string;
type NegPhrase<K extends string> = (p: P<K> & { neg: boolean }) => string;
type PatternPhrase = (p: { value: string; text: string; neg: boolean; ignoreCase: boolean }) => string;

/** Kysely phrasebook. A translator implements this type in `src/<locale>.ts`. */
export type KyselyPhrases = {
	compare: {
		equal: NegPhrase<"left" | "right">;
		moreThan: Phrase<"left" | "right">;
		atLeast: Phrase<"left" | "right">;
		lessThan: Phrase<"left" | "right">;
		atMost: Phrase<"left" | "right">;
		in: NegPhrase<"left" | "right">;
		between: NegPhrase<"value" | "low" | "high">;
		empty: NegPhrase<"value">;
		/** `is distinct from` and other operators with no plainer reading; `op` is the SQL operator as code. */
		other: NegPhrase<"left" | "op" | "right">;
	};
	pattern: {
		contains: PatternPhrase;
		startsWith: PatternPhrase;
		endsWith: PatternPhrase;
		matches: (p: { value: string; pattern: string; neg: boolean; ignoreCase: boolean }) => string;
		regex: (p: { value: string; pattern: string; neg: boolean; ignoreCase: boolean }) => string;
	};
	array: {
		containsAll: NegPhrase<"value" | "items">;
		within: NegPhrase<"value" | "items">;
		overlaps: NegPhrase<"value" | "items">;
	};
	exists: {
		lookup: NegPhrase<"query">;
	};
	logic: {
		all: string;
		any: string;
		/** `eb.and(filters)` with a variable. */
		allIn: NegPhrase<"list">;
		anyIn: NegPhrase<"list">;
	};
	order: {
		ascending: (p: { column: string; time: boolean }) => string;
		descending: (p: { column: string; time: boolean }) => string;
		nulls: (p: { order: string; first: boolean }) => string;
	};
	value: {
		/** `"person.first_name"` -> "person's first name". */
		column: Phrase<"table" | "column">;
		/** `excluded.x` in an upsert: the value the insert tried to write. */
		excluded: Phrase<"column">;
		/** `"first_name as fn"` / `.as("fn")`. */
		named: Phrase<"value" | "name">;
		/** Every column of one table: `selectAll("person")`, `"person.*"`. */
		allColumnsOf: Phrase<"table">;
		/** `eb.fn("upper", [col])`. */
		fn: Phrase<"name" | "args">;
		/** `eb.cast(x, "integer")`. */
		cast: Phrase<"value" | "type">;
		/** A subquery used as a value. */
		subquery: Phrase<"query">;
		/** `eb.case()...end()`: `cases` are rendered "when" lines. */
		caseOf: string;
		when: Phrase<"condition" | "value">;
		otherwise: Phrase<"value">;
		/** `jsonArrayFrom(subquery)` / `jsonObjectFrom(subquery)` from `kysely/helpers/*`. */
		jsonArray: Phrase<"query">;
		jsonObject: Phrase<"query">;
	};
	aggregate: {
		countRows: string;
		count: Phrase<"column">;
		countDistinct: Phrase<"column">;
		sum: Phrase<"column">;
		avg: Phrase<"column">;
		min: Phrase<"column">;
		max: Phrase<"column">;
		coalesce: Phrase<"values">;
	};
	query: {
		select: Phrase<"fields" | "table">;
		fromRows: Phrase<"table">;
		fromFields: Phrase<"table">;
		picking: Phrase<"fields">;
		/** Many or complex fields, listed as bullets below. */
		pickingBlock: string;
		/** A table given as a subquery, defined in bullets below. */
		tableDefinedAs: string;
		insertInto: Phrase<"table">;
		replaceInto: Phrase<"table">;
		update: Phrase<"table">;
		deleteFrom: Phrase<"table">;
		mergeInto: Phrase<"table">;
		values: Phrase<"values">;
		/** `values([...])` with one bullet per row. */
		rows: string;
		/** A row heading inside `rows`. */
		row: string;
		valuesFrom: Phrase<"query">;
		setting: Phrase<"changes">;
		where: Phrase<"condition">;
		joined: Phrase<"table" | "condition">;
		leftJoined: Phrase<"table" | "condition">;
		rightJoined: Phrase<"table" | "condition">;
		fullJoined: Phrase<"table" | "condition">;
		crossJoined: Phrase<"table">;
		/** A join whose callback adds more than one condition. */
		joinedOn: Phrase<"table">;
		sortedBy: Phrase<"columns">;
		atMost: Phrase<"count">;
		skipping: Phrase<"count">;
		groupedBy: Phrase<"columns">;
		having: Phrase<"condition">;
		distinct: string;
		distinctOn: Phrase<"columns">;
		returning: Phrase<"fields">;
		returningAll: string;
		ignoreConflicts: string;
		ignoreConflictsOn: Phrase<"target">;
		updateConflicts: string;
		updateConflictsOn: Phrase<"target">;
		/** `onConflict(oc => oc.constraint("name"))`. */
		constraint: Phrase<"name">;
		locking: Phrase<"mode">;
		/** `$if(condition, qb => qb.where(...))`. */
		onlyIf: Phrase<"condition">;
		/** `$call(fn)`. */
		passedThrough: Phrase<"fn">;
		/** `.with("name", qb => ...)` before the main query. */
		cte: Phrase<"name">;
		/** A builder held in a variable, with clauses added below. */
		refined: Phrase<"query">;
		/** Other builder steps with no plainer reading. */
		otherStep: (p: { method: string; args: string }) => string;
		/** `whenMatched()...` / `whenNotMatched()...` on `mergeInto`. */
		whenMatched: string;
		whenNotMatched: string;
		using: Phrase<"table" | "condition">;
		thenUpdate: string;
		thenDelete: string;
		thenInsert: string;
		thenDoNothing: string;
	};
	run: {
		/** `.executeTakeFirst()` used as a value. */
		first: Phrase<"query">;
		firstOrFail: Phrase<"query">;
		/** `.execute()` on an insert/update/delete used as a value. */
		results: Phrase<"query">;
		stream: Phrase<"query">;
		compile: Phrase<"query">;
		/** `.explain()`. */
		explain: Phrase<"query">;
		/** A query held in a variable then executed: `await query.execute()`. */
		runQuery: Phrase<"query">;
	};
	transaction: {
		run: (p: { settings: string[] }) => string;
		result: (p: { settings: string[] }) => string;
		isolation: Phrase<"level">;
		accessMode: Phrase<"mode">;
	};
};
