/** Every argument is already-rendered markup unless typed otherwise. */
type F<K extends string> = (p: { [key in K]: string }) => string;
type Neg<K extends string> = (p: { [key in K]: string } & { neg: boolean }) => string;
type Matching = (p: { value: string; text: string; neg: boolean; ignoreCase: boolean }) => string;
type Pattern = (p: { value: string; pattern: string; neg: boolean; ignoreCase: boolean }) => string;

export type JoinKind = "inner" | "left" | "right" | "full" | "cross";
export type LockKind = "update" | "noKeyUpdate" | "share" | "keyShare";
export type RefAction = "cascade" | "setNull" | "setDefault" | "restrict";
export type DropKind = "table" | "index" | "type" | "sequence" | "trigger";

export type SqlPhrases = {
	/** How a whole SQL text reads where the JS code runs or holds it. */
	run: {
		/** The full SQL, shown under the English so nothing is ever hidden. */
		sql: F<"sql">;
		/** SQL the parser couldn't read (or no parser is loaded): the text itself is the description. */
		rawAction: F<"sql">;
		rawValue: F<"sql">;
		/** A statement used as a value: `const r = await sql\`insert ...\``. `action` starts lowercase. */
		value: F<"action">;
		/** `db.prepare("...")`: a statement compiled now and run later. */
		prepared: F<"action">;
		/** A constant holding SQL text. */
		text: F<"action">;
		severalAction: F<"count">;
		severalValue: F<"count">;
		/** A template that's an expression, not a statement: kysely's `sql\`now()\``. */
		fragment: F<"value">;
		/** A statement kind this plugin has no words for, named by its SQL keywords. */
		other: F<"kind">;
		/** A placeholder no JS value is bound to: `$1`, `?`, `:id`. */
		unbound: F<"name">;
	};
	select: {
		action: F<"what">;
		/** `select *`: no column list worth naming. */
		rows: F<"source">;
		columns: F<"columns" | "source">;
		/** `select now()`: values with no table. */
		bare: F<"columns">;
		/** Heading for a column list too long to inline. */
		columnList: string;
		alias: F<"value" | "name">;
		all: string;
		allOf: F<"table">;
		/** `order by 2`: a column by its position in the select list. */
		position: F<"position">;
		distinct: string;
		distinctOn: F<"columns">;
		join: Record<JoinKind, F<"table" | "on">>;
		/** `join ... using (a, b)`, used as the `on` of a join phrase. */
		joinUsing: F<"columns">;
		/** `from (select ...) as x` / `with x as (...)`: introduces what `x` holds. */
		defines: F<"name" | "what">;
		/** `with recursive x as (start union step)`. */
		recursive: F<"name">;
		recursiveStart: F<"what">;
		recursiveStep: F<"what">;
		where: F<"condition">;
		groupBy: F<"columns">;
		having: F<"condition">;
		orderBy: F<"keys">;
		/** `time` is true when the value names a moment, so English can say newest/oldest. */
		asc: (p: { value: string; time: boolean }) => string;
		desc: (p: { value: string; time: boolean }) => string;
		nullsFirst: F<"key">;
		nullsLast: F<"key">;
		limit: F<"count">;
		offset: F<"count">;
		lock: Record<LockKind, string>;
		skipLocked: string;
		noWait: string;
		union: string;
		unionAll: string;
		values: string;
		row: F<"values">;
	};
	/** `set a = b` in UPDATE, INSERT values, and ON CONFLICT DO UPDATE. */
	set: {
		list: F<"assignments">;
		block: string;
		assign: F<"column" | "value">;
		increase: F<"column" | "by">;
		decrease: F<"column" | "by">;
	};
	insert: {
		/** `n` is the number of listed rows, or null for `insert ... select`. */
		action: (p: { table: string; count: string; n: number | null }) => string;
		rows: F<"columns">;
		copy: F<"what">;
		defaults: string;
		/** `excluded.email` inside ON CONFLICT: the value that was being inserted. */
		incoming: F<"column">;
		conflictNothing: F<"target">;
		conflictUpdate: F<"target">;
		/** ON CONFLICT with no target. */
		anyConflictNothing: string;
		constraintTarget: F<"name">;
		conflictWhere: F<"condition">;
	};
	update: {
		action: F<"table">;
		using: F<"tables">;
	};
	delete: {
		action: F<"table">;
	};
	/** Shared by INSERT/UPDATE/DELETE. */
	write: {
		returning: F<"columns">;
		everyRow: string;
	};
	schema: {
		createTable: (p: { table: string; ifNotExists: boolean; temporary: boolean }) => string;
		column: F<"name" | "type" | "details">;
		primaryKey: string;
		unique: string;
		required: string;
		optional: string;
		defaultsTo: F<"value">;
		references: F<"target">;
		onDelete: Record<RefAction, string>;
		onUpdate: Record<RefAction, string>;
		check: F<"condition">;
		generated: F<"value">;
		identity: string;
		likeTable: F<"table">;
		tablePrimaryKey: F<"columns">;
		tableUnique: F<"columns">;
		tableForeignKey: F<"columns" | "target">;
		named: F<"rule" | "name">;
		createIndex: (p: { name: string; table: string; keys: string; unique: boolean; ifNotExists: boolean }) => string;
		concurrently: string;
		indexMethod: F<"method">;
		partial: F<"condition">;
		alterTable: F<"table">;
		addColumn: (p: { column: string; ifNotExists: boolean }) => string;
		dropColumn: (p: { column: string; ifExists: boolean }) => string;
		renameColumn: F<"column" | "to">;
		renameTable: F<"to">;
		renameRule: F<"name" | "to">;
		setType: F<"column" | "type">;
		setDefault: F<"column" | "value">;
		dropDefault: F<"column">;
		setRequired: F<"column">;
		setOptional: F<"column">;
		addConstraint: F<"constraint">;
		dropConstraint: (p: { name: string; ifExists: boolean }) => string;
		owner: F<"to">;
		drop: (p: { kind: DropKind; names: string; many: boolean; ifExists: boolean }) => string;
		cascade: string;
		truncate: F<"tables">;
		restartIdentity: string;
		createView: (p: { name: string; materialized: boolean; orReplace: boolean }) => string;
		showing: F<"what">;
		refreshView: F<"name">;
		createExtension: (p: { name: string; ifNotExists: boolean }) => string;
		createEnum: F<"name" | "values">;
		createSchema: (p: { name: string; ifNotExists: boolean }) => string;
	};
	transaction: {
		begin: string;
		isolation: F<"level">;
		readOnly: string;
		commit: string;
		rollback: string;
	};
	compare: {
		equal: Neg<"left" | "right">;
		moreThan: F<"left" | "right">;
		atLeast: F<"left" | "right">;
		lessThan: F<"left" | "right">;
		atMost: F<"left" | "right">;
		empty: Neg<"value">;
		isTrue: Neg<"value">;
		isFalse: Neg<"value">;
		oneOf: Neg<"value" | "list">;
		among: Neg<"value" | "query">;
		between: Neg<"value" | "low" | "high">;
		contains: Matching;
		startsWith: Matching;
		endsWith: Matching;
		like: Pattern;
		regex: Pattern;
		/** `condition` is an empty string when the subquery has no WHERE. */
		exists: Neg<"source" | "condition">;
		not: F<"condition">;
		all: string;
		any: string;
	};
	expr: {
		/** `owner` is `table` already in possessive form, for languages that put the owner first. */
		column: F<"table" | "owner" | "column">;
		null: string;
		default: string;
		plus: F<"left" | "right">;
		minus: F<"left" | "right">;
		times: F<"left" | "right">;
		dividedBy: F<"left" | "right">;
		remainder: F<"left" | "right">;
		concat: F<"left" | "right">;
		negative: F<"value">;
		cast: F<"value" | "type">;
		list: F<"items">;
		atTimeZone: F<"value" | "zone">;
		/** `CASE`: `branches` are `when` phrases joined in order. */
		case: F<"branches" | "otherwise">;
		when: F<"value" | "condition">;
		/** A function this plugin has no words for, shown by name with its arguments narrated. */
		call: F<"name" | "args">;
		labeled: F<"key" | "value">;
		/** An operator this plugin has no words for, shown as written. */
		operator: F<"left" | "op" | "right">;
		whether: F<"condition">;
		/** A scalar subquery used as a value. */
		subquery: F<"query">;
	};
	json: {
		/** `text` is true for `->>` / `#>>`, which give text instead of JSON. */
		field: (p: { value: string; key: string; text: boolean }) => string;
		item: (p: { value: string; position: string; text: boolean }) => string;
		path: (p: { value: string; path: string; text: boolean }) => string;
		contains: Neg<"left" | "right">;
		containedIn: Neg<"left" | "right">;
		hasKey: Neg<"value" | "key">;
		hasAnyKey: F<"value" | "keys">;
		hasAllKeys: F<"value" | "keys">;
		withoutPath: F<"value" | "path">;
		object: F<"entries">;
		list: F<"value">;
		array: F<"items">;
	};
	array: {
		literal: F<"items">;
		overlaps: Neg<"left" | "right">;
		items: F<"value">;
		length: F<"value">;
		fromQuery: F<"query">;
	};
	fn: {
		countRows: string;
		count: F<"value">;
		countDistinct: F<"value">;
		sum: F<"value">;
		average: F<"value">;
		min: F<"value">;
		max: F<"value">;
		listOf: F<"value">;
		listOfDistinct: F<"value">;
		joinedWith: F<"value" | "separator">;
		sorted: F<"value" | "order">;
		filtered: F<"value" | "condition">;
		/** `partition` and `order` are empty strings when the OVER clause leaves them out. */
		window: F<"value" | "partition" | "order">;
		rowNumber: string;
		rank: string;
		denseRank: string;
		previous: F<"value">;
		next: F<"value">;
		firstValue: F<"value">;
		lastValue: F<"value">;
		coalesce: F<"value" | "fallback">;
		firstSet: F<"values">;
		nullIf: F<"value" | "other">;
		greatest: F<"values">;
		least: F<"values">;
		now: string;
		today: string;
		currentUser: string;
		randomId: string;
		random: string;
		lower: F<"value">;
		upper: F<"value">;
		trim: F<"value">;
		length: F<"value">;
		abs: F<"value">;
		round: F<"value">;
		roundTo: F<"value" | "digits">;
		ceil: F<"value">;
		floor: F<"value">;
		concat: F<"values">;
		dateTrunc: F<"value" | "unit">;
		part: F<"value" | "unit">;
		series: F<"from" | "to">;
		interval: F<"value">;
	};
};
