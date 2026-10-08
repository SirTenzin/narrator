/** Arguments are already-rendered markup strings; `neg` asks for the negated form. */
type P<K extends string> = { [key in K]: string };
type Phrase<K extends string> = (p: P<K>) => string;
type NegPhrase<K extends string> = (p: P<K> & { neg: boolean }) => string;

/** Every column type the schema rules recognise; each needs a word in `schema.types`. */
export type ColumnType =
	| "integer"
	| "int"
	| "smallint"
	| "tinyint"
	| "mediumint"
	| "bigint"
	| "serial"
	| "smallserial"
	| "bigserial"
	| "boolean"
	| "text"
	| "tinytext"
	| "mediumtext"
	| "longtext"
	| "varchar"
	| "char"
	| "numeric"
	| "decimal"
	| "real"
	| "doublePrecision"
	| "double"
	| "float"
	| "json"
	| "jsonb"
	| "uuid"
	| "timestamp"
	| "datetime"
	| "date"
	| "time"
	| "year"
	| "interval"
	| "blob"
	| "bytea"
	| "binary"
	| "varbinary"
	| "inet"
	| "cidr"
	| "macaddr"
	| "point"
	| "line"
	| "vector";

/** What happens to a row when the row it references is deleted or updated. */
export type ReferentialAction = "cascade" | "setNull" | "setDefault" | "restrict" | "noAction";

/** Drizzle ORM phrasebook. A translator implements this type in `src/<locale>.ts`. */
export type DrizzlePhrases = {
	compare: {
		/** `eq` (and `ne`, which is `eq` negated). */
		equal: NegPhrase<"left" | "right">;
		moreThan: Phrase<"left" | "right">;
		atLeast: Phrase<"left" | "right">;
		lessThan: Phrase<"left" | "right">;
		atMost: Phrase<"left" | "right">;
		/** `inArray` / `notInArray`. */
		in: NegPhrase<"left" | "right">;
		between: NegPhrase<"value" | "low" | "high">;
		/** `isNull` / `isNotNull`. */
		empty: NegPhrase<"value">;
	};
	/** `like` / `ilike`, by what the pattern means; `ignoreCase` is set for `ilike`. */
	pattern: {
		contains: (p: { value: string; text: string; neg: boolean; ignoreCase: boolean }) => string;
		startsWith: (p: { value: string; text: string; neg: boolean; ignoreCase: boolean }) => string;
		endsWith: (p: { value: string; text: string; neg: boolean; ignoreCase: boolean }) => string;
		matches: (p: { value: string; pattern: string; neg: boolean; ignoreCase: boolean }) => string;
	};
	/** Postgres array operators. */
	array: {
		containsAll: NegPhrase<"value" | "items">;
		within: NegPhrase<"value" | "items">;
		overlaps: NegPhrase<"value" | "items">;
	};
	exists: {
		/** `exists(db.select()...)`; `query` is the subquery's action phrase. */
		lookup: NegPhrase<"query">;
		/** `exists(subquery)` where the subquery is a named value. */
		rows: NegPhrase<"query">;
		/** An `exists` check used as a value rather than a condition. */
		whether: Phrase<"condition">;
	};
	logic: {
		/** Fixed headers that introduce bullet lists (the trailing colon marks that). */
		all: string;
		any: string;
		/** A spread list of conditions inside `and(...)` / `or(...)`. */
		allIn: NegPhrase<"list">;
		anyIn: NegPhrase<"list">;
	};
	order: {
		/** `time` is true when the column looks like a date or time. */
		ascending: (p: { column: string; time: boolean }) => string;
		descending: (p: { column: string; time: boolean }) => string;
	};
	aggregate: {
		countRows: string;
		count: Phrase<"column">;
		countDistinct: Phrase<"column">;
		sum: Phrase<"column">;
		sumDistinct: Phrase<"column">;
		avg: Phrase<"column">;
		avgDistinct: Phrase<"column">;
		min: Phrase<"column">;
		max: Phrase<"column">;
		/** `db.$count(table)` / `db.$count(table, filter)`. */
		rowsIn: Phrase<"table">;
		rowsInWhere: Phrase<"table" | "condition">;
	};
	sql: {
		/** `sql\`...\`` used as a value; `sql` is the full SQL text as code. */
		fragment: Phrase<"sql">;
		/** `sql\`...\`` used as a yes/no condition. */
		condition: NegPhrase<"sql">;
		empty: string;
		/** `sql.raw(text)` where the text isn't a literal. */
		rawFrom: Phrase<"value">;
		joined: Phrase<"parts">;
		joinedWith: Phrase<"parts" | "separator">;
		placeholder: Phrase<"name">;
		identifier: Phrase<"name">;
		named: Phrase<"value" | "name">;
		mappedWith: Phrase<"value" | "mapper">;
		/** One `key: value` entry of an object whose values include SQL. */
		field: Phrase<"key" | "value">;
	};
	table: {
		allColumns: Phrase<"table">;
		name: Phrase<"table">;
	};
	query: {
		/** `db.select(fields)` with no `.from(...)`. */
		select: Phrase<"selection">;
		/** A select object's fields; `list` is empty when they're listed below instead. */
		fields: Phrase<"list">;
		selectAll: string;
		/** `.from(t)` after `select()` with no fields. */
		fromRows: Phrase<"table">;
		/** `.from(t)` after `select(fields)`. */
		fromFields: Phrase<"table">;
		picking: Phrase<"fields">;
		insertInto: Phrase<"table">;
		update: Phrase<"table">;
		deleteFrom: Phrase<"table">;
		values: Phrase<"values">;
		setting: Phrase<"changes">;
		where: Phrase<"condition">;
		joined: Phrase<"table" | "condition">;
		crossJoined: Phrase<"table">;
		sortedBy: Phrase<"columns">;
		atMost: Phrase<"count">;
		skipping: Phrase<"count">;
		returning: string;
		returningIds: string;
		ignoreConflicts: string;
		updateConflicts: string;
		updateConflictsOn: Phrase<"target">;
		conflictWhere: Phrase<"condition">;
		groupedBy: Phrase<"columns">;
		having: Phrase<"condition">;
		locking: Phrase<"mode">;
		distinctOn: Phrase<"columns">;
		subquery: Phrase<"name">;
		dynamic: string;
		prepared: Phrase<"name">;
		toSql: string;
		/** `db.$with("name").as(query)`: a named subquery (CTE). */
		cte: Phrase<"name">;
		usingCtes: Phrase<"names">;
		/** Any other builder step; `args` may be empty. */
		otherStep: Phrase<"method" | "args">;
	};
	relational: {
		everyRow: Phrase<"table">;
		rows: Phrase<"table">;
		firstRow: Phrase<"table">;
		/** The rows phrase with its only filter inline. */
		filtered: Phrase<"rows" | "condition">;
		/** A relational query used as a statement. */
		lookUp: Phrase<"rows">;
		/** Options passed as a variable rather than an object literal. */
		withOptions: Phrase<"rows" | "options">;
		pickingOnly: Phrase<"columns">;
		leavingOut: Phrase<"columns">;
		noColumns: string;
		including: Phrase<"relation">;
		extra: Phrase<"name" | "value">;
		/** A `where` filter held in a variable, read as a condition. */
		matchesFilter: Phrase<"filter">;
		option: Phrase<"key" | "value">;
		/** Object-style `where: { posts: { ... } }` filtering on a related table. */
		hasRelated: NegPhrase<"relation" | "condition">;
	};
	transaction: {
		/** `db.transaction(fn)` as a statement; `settings` are rendered transaction options. */
		run: (p: { settings: string[] }) => string;
		/** `db.transaction(fn)` whose result is used. */
		result: (p: { settings: string[] }) => string;
		/** `tx.transaction(fn)`: a savepoint inside a transaction. */
		nested: (p: { settings: string[] }) => string;
		isolation: Phrase<"level">;
		readOnly: string;
		readWrite: string;
		deferrable: string;
		setting: Phrase<"key" | "value">;
		rollback: string;
		batch: string;
		batchResult: string;
		batchOf: Phrase<"queries">;
	};
	schema: {
		/** A table definition, by dialect. */
		table: { pg: Phrase<"name">; mysql: Phrase<"name">; sqlite: Phrase<"name">; singlestore: Phrase<"name"> };
		/** `pgTable(...).enableRLS()`. */
		rowLevelSecurity: string;
		/** One column inside a table; `traits` are rendered modifiers in source order. */
		column: (p: { column: string; type: string; traits: string[] }) => string;
		/** A column builder outside a table. */
		columnValue: (p: { type: string; traits: string[] }) => string;
		/** `...shared` spread into a table's columns. */
		columnsFrom: Phrase<"value">;
		types: Record<ColumnType, string>;
		listOf: Phrase<"type">;
		oneOf: Phrase<"values">;
		storedAs: Phrase<"name">;
		mode: Phrase<"mode">;
		withTimezone: string;
		maxLength: Phrase<"length">;
		precision: Phrase<"precision">;
		precisionScale: Phrase<"precision" | "scale">;
		dimensions: Phrase<"count">;
		option: Phrase<"key" | "value">;
		primaryKey: string;
		notNull: string;
		unique: string;
		autoIncrement: string;
		identity: string;
		defaultsTo: Phrase<"value">;
		defaultNow: string;
		defaultRandom: string;
		/** `$defaultFn` / `$default`: a default worked out in app code. */
		defaultFn: Phrase<"value">;
		/** `$onUpdate` / `$onUpdateFn`. */
		onUpdate: Phrase<"value">;
		computedAs: Phrase<"value">;
		typedAs: Phrase<"type">;
		references: Phrase<"target">;
		onTargetDelete: Record<ReferentialAction, string>;
		onTargetUpdate: Record<ReferentialAction, string>;
		otherModifier: Phrase<"name" | "args">;
		/** `name` may be empty; `traits` are rendered index options. */
		index: (p: { name: string; columns: string; traits: string[] }) => string;
		uniqueIndex: (p: { name: string; columns: string; traits: string[] }) => string;
		uniqueConstraint: (p: { name: string; columns: string; traits: string[] }) => string;
		indexUsing: Phrase<"method">;
		indexWhere: Phrase<"condition">;
		concurrently: string;
		nullsNotDistinct: string;
		compositeKey: Phrase<"columns" | "name">;
		foreignKey: (p: { columns: string; target: string; name: string; traits: string[] }) => string;
		check: Phrase<"name" | "condition">;
		enum: { pg: Phrase<"name" | "values"> };
		/** `relations(table, ({ one, many }) => ...)`. */
		relationsOf: Phrase<"table">;
		/** `defineRelations(schema, (r) => ...)`. */
		relationsAll: string;
		many: Phrase<"name" | "table">;
		one: Phrase<"name" | "table">;
		/** `one(table, { fields, references })`; `fields` link to `references`. */
		oneVia: Phrase<"name" | "table" | "fields" | "references">;
		relationOption: Phrase<"key" | "value">;
	};
};
