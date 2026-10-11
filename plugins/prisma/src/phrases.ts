/** Arguments are already-rendered markup strings; `neg` asks for the negated form. */
type P<K extends string> = { [key in K]: string };
type Phrase<K extends string> = (p: P<K>) => string;
type NegPhrase<K extends string> = (p: P<K> & { neg: boolean }) => string;
type PatternPhrase = (p: { value: string; text: string; neg: boolean; ignoreCase: boolean }) => string;

/** Prisma Client phrasebook. A translator implements this type in `src/<locale>.ts`. */
export type PrismaPhrases = {
	compare: {
		equal: NegPhrase<"left" | "right">;
		moreThan: Phrase<"left" | "right">;
		atLeast: Phrase<"left" | "right">;
		lessThan: Phrase<"left" | "right">;
		atMost: Phrase<"left" | "right">;
		in: NegPhrase<"left" | "right">;
		empty: NegPhrase<"value">;
	};
	/** `contains` / `startsWith` / `endsWith`; `ignoreCase` is set by `mode: "insensitive"`. */
	pattern: {
		contains: PatternPhrase;
		startsWith: PatternPhrase;
		endsWith: PatternPhrase;
		/** Full-text `search`. */
		search: NegPhrase<"value" | "text">;
	};
	/** Scalar list filters. */
	list: {
		has: NegPhrase<"value" | "item">;
		hasEvery: NegPhrase<"value" | "items">;
		hasSome: NegPhrase<"value" | "items">;
		isEmpty: NegPhrase<"value">;
	};
	logic: {
		all: string;
		any: string;
		/** `AND: filters` / `OR: filters` where the list is a variable. */
		allIn: NegPhrase<"list">;
		anyIn: NegPhrase<"list">;
		/** A `where` held in a variable. */
		matchesFilter: NegPhrase<"filter">;
	};
	/** Relation filters. */
	relation: {
		/** `some` (and `none`, negated). */
		has: NegPhrase<"relation" | "condition">;
		/** `posts: { some: {} }`: any related row at all. */
		hasAny: NegPhrase<"relation">;
		every: NegPhrase<"relation" | "condition">;
		/** A to-one relation's field: `author: { name: "x" }` -> "author's name". */
		field: Phrase<"relation" | "field">;
		/** `author: null` / `author: { isNot: null }`. */
		missing: NegPhrase<"relation">;
	};
	order: {
		ascending: (p: { column: string; time: boolean }) => string;
		descending: (p: { column: string; time: boolean }) => string;
		/** `orderBy: { posts: { _count: "desc" } }`. */
		byCount: (p: { relation: string; descending: boolean }) => string;
		/** `{ sort: "asc", nulls: "last" }`. */
		nulls: (p: { order: string; first: boolean }) => string;
		/** `orderBy: { _relevance: { fields, search, sort } }`. */
		relevance: Phrase<"fields" | "search">;
	};
	rows: {
		every: Phrase<"table">;
		some: Phrase<"table">;
		first: Phrase<"table">;
		unique: Phrase<"table">;
		/** The rows phrase with its only filter inline. */
		filtered: Phrase<"rows" | "condition">;
		/** `...OrThrow`. */
		orFail: Phrase<"rows">;
		lookUp: Phrase<"rows">;
		/** Options passed as a variable. */
		withOptions: Phrase<"rows" | "options">;
	};
	options: {
		where: Phrase<"condition">;
		pickingOnly: Phrase<"fields">;
		leavingOut: Phrase<"fields">;
		including: Phrase<"relation">;
		/** `...shared` spread into `select` / `include`. */
		includingAllIn: Phrase<"value">;
		countOf: Phrase<"relation">;
		countOfWhere: Phrase<"relation" | "condition">;
		/** `_count: true`. */
		countAll: string;
		sortedBy: Phrase<"columns">;
		atMost: Phrase<"count">;
		/** Negative `take`: from the end. */
		lastOnes: Phrase<"count">;
		skipping: Phrase<"count">;
		startingFrom: Phrase<"condition">;
		distinct: Phrase<"fields">;
		option: Phrase<"key" | "value">;
	};
	write: {
		create: Phrase<"table">;
		created: Phrase<"table">;
		createMany: Phrase<"table">;
		/** `createManyAndReturn`. */
		createdManyReturning: Phrase<"table">;
		skipDuplicates: string;
		update: Phrase<"rows">;
		updated: Phrase<"rows">;
		updateMany: Phrase<"rows">;
		upsert: Phrase<"rows">;
		upserted: Phrase<"rows">;
		/** The value of `createMany` / `updateMany` / `deleteMany`: a count. */
		affected: Phrase<"action">;
		ifFound: string;
		ifMissing: string;
		delete: Phrase<"rows">;
		deleted: Phrase<"rows">;
		deleteMany: Phrase<"rows">;
		/** The data block's heading when it sits under other options. */
		setting: string;
		values: string;
		/** `data: input` held in a variable. */
		valuesFrom: Phrase<"value">;
		/** One row of a `createMany` list. */
		row: string;
	};
	/** Field operations inside `data`. */
	data: {
		field: Phrase<"key" | "value">;
		increment: Phrase<"key" | "value">;
		decrement: Phrase<"key" | "value">;
		multiply: Phrase<"key" | "value">;
		divide: Phrase<"key" | "value">;
		set: Phrase<"key" | "value">;
		push: Phrase<"key" | "value">;
		unset: Phrase<"key">;
		/** Nested writes on a relation. */
		createRelated: Phrase<"relation">;
		createManyRelated: Phrase<"relation">;
		connect: Phrase<"relation" | "condition">;
		connectEach: Phrase<"relation">;
		connectOrCreate: Phrase<"relation">;
		disconnect: Phrase<"relation">;
		disconnectEach: Phrase<"relation">;
		disconnectWhere: Phrase<"relation" | "condition">;
		setRelated: Phrase<"relation" | "value">;
		clearRelated: Phrase<"relation">;
		updateRelated: Phrase<"relation">;
		upsertRelated: Phrase<"relation">;
		deleteRelated: Phrase<"relation">;
		deleteRelatedWhere: Phrase<"relation" | "condition">;
		/** A nested write whose kind isn't recognised. */
		other: Phrase<"relation" | "action" | "value">;
	};
	aggregate: {
		countRows: Phrase<"table">;
		countWhere: Phrase<"table" | "condition">;
		/** `count({ select: { _all: true, email: true } })`. */
		counts: Phrase<"table" | "fields">;
		/** `_all: true`. */
		rowCount: string;
		/** `_count: { email: true }`: rows where the field isn't empty. */
		setCount: Phrase<"field">;
		summary: Phrase<"table">;
		groups: Phrase<"table" | "fields">;
		/** `_avg: { age: true }` -> "the average of age". */
		avg: Phrase<"fields">;
		sum: Phrase<"fields">;
		min: Phrase<"fields">;
		max: Phrase<"fields">;
		having: Phrase<"condition">;
	};
	transaction: {
		/** `$transaction([q1, q2])`. */
		batch: (p: { settings: string[] }) => string;
		batchResult: (p: { settings: string[] }) => string;
		run: (p: { settings: string[] }) => string;
		result: (p: { settings: string[] }) => string;
		/** `$transaction(queries)` with a variable. */
		batchOf: Phrase<"queries">;
		isolation: Phrase<"level">;
		timeout: Phrase<"ms">;
		maxWait: Phrase<"ms">;
		setting: Phrase<"key" | "value">;
	};
	client: {
		create: string;
		adapter: Phrase<"adapter">;
		accelerate: Phrase<"url">;
		log: Phrase<"levels">;
		connect: string;
		disconnect: string;
		/** `prisma.$extends({...})`. */
		extended: Phrase<"client">;
		extendedWith: Phrase<"client" | "extension">;
		queryHook: Phrase<"model" | "operation">;
		allModels: string;
		allOperations: string;
		computedField: Phrase<"model" | "field">;
		needs: Phrase<"fields">;
		modelMethods: Phrase<"model" | "methods">;
		clientMethods: Phrase<"methods">;
		/** `defineConfig` from `prisma/config`. */
		config: string;
	};
};
