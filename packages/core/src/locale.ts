/** Language-specific word mechanics: everything a renderer needs besides fixed phrases. */
export interface Grammar {
	/** "a, b, and c" / "a or b". */
	list(items: string[], conj?: "and" | "or"): string;
	formatNumber(n: number): string;
	/** Indefinite article for a noun phrase ("a"/"an"). */
	article(noun: string): string;
	/** "customer" -> "customer's"; markup-aware. */
	possessive(noun: string): string;
	plural(noun: string): string;
	singular(noun: string): string;
	isPlural(noun: string): boolean;
	/** Leading word of a yes/no name, negated: "is" -> "is not", "has" -> "has no". */
	negatePredicateHead(head: string): string;
	/** A rendered type phrase as a bare noun, for use after "a list of": "a number" -> "number". */
	bareNoun(phrase: string): string;
	/** Whether a rendered sentence subject takes a plural verb ("customer's items are", "the number of items is"). */
	isPluralSubject(subject: string): boolean;
	/** Whether a rendered (plain) noun phrase names a moment in time, so comparisons read "before"/"after". */
	isTimeLike(phrase: string): boolean;
}

/** A phrase built from already-rendered markup strings. */
type Phrase<T> = (p: T) => string;
type Neg = { neg: boolean };
type RelOp = "<" | ">" | "<=" | ">=";

/** Values, member access, collections, literals, lambdas, assignment, JSX. */
export interface ExpressionPhrases {
	/** Arithmetic and bitwise operators, keyed by source operator. */
	ops: Record<"+" | "-" | "*" | "/" | "%" | "**" | "<<" | ">>" | "&" | "|", Phrase<{ left: string; right: string }>>;
	fallback: Phrase<{ value: string; fallback: string }>;
	fallbackBlock: Phrase<{ value: string; fallback: string }>;
	fallbackInline: Phrase<{ value: string; fallback: string }>;
	/** `a || b` used as a value. */
	orIfEmpty: Phrase<{ value: string; fallback: string }>;
	/** A value that only exists when a condition holds. */
	onlyIf: Phrase<{ value: string; condition: string }>;
	/** A constant-folded number next to the expression it came from. */
	folded: Phrase<{ value: string; expression: string }>;
	/** `"text" + x`. */
	concatText: Phrase<{ left: string; right: string }>;
	nothing: string;
	this: string;
	parentClass: string;
	metaProperty: string;
	/** `new.target`: the class a constructor was invoked through. */
	newTarget: string;
	importMeta: { main: string; dir: string; url: string; path: string };
	envVar: Phrase<{ name: string }>;
	whether: Phrase<{ condition: string }>;
	allOf: Phrase<{ value: string }>;
	everythingIn: Phrase<{ value: string }>;
	typeOf: Phrase<{ value: string }>;
	negative: Phrase<{ value: string }>;
	asNumber: Phrase<{ value: string }>;
	increment: Phrase<{ target: string }>;
	decrement: Phrase<{ target: string }>;
	sequence: Phrase<{ steps: string[] }>;
	yield: Phrase<{ value: string }>;
	yieldAll: Phrase<{ value: string }>;
	dynamicImport: Phrase<{ path: string }>;
	sql: Phrase<{ query: string }>;
	/** Bun's `` $`cmd` ``: a shell command; `command` is the rendered template. */
	shell: Phrase<{ command: string; stmt: boolean }>;
	/** Any other tagged template: `tag` processes the rendered `text`. */
	tagged: Phrase<{ tag: string; text: string }>;
	classExpr: Phrase<{ name: string | null }>;
	/** "key: value" for a labelled item in a list. */
	labeled: Phrase<{ key: string; value: string }>;
	/** Default name for a lambda's element parameter. */
	item: string;
	member: {
		countOf: Phrase<{ value: string }>;
		countWhere: Phrase<{ collection: string; condition: string }>;
		/** Like countWhere, when the lambda destructures its item. */
		countWhose: Phrase<{ collection: string; condition: string }>;
		firstOf: Phrase<{ value: string }>;
		lastOf: Phrase<{ value: string }>;
		/** `xs[2]`; `position` is 1-based. */
		nthOf: Phrase<{ value: string; position: string }>;
		/** `xs.items[0]` -> "first item"; `item` is already singular. */
		firstItem: Phrase<{ item: string }>;
		entryFor: Phrase<{ owner: string; key: string }>;
		/** Owner-first chain of property names: `a.b.c` -> ["a", "b", "c"]. */
		chain: Phrase<{ path: string[] }>;
		/** A chain on an ambient root (the context object). */
		contextChain: Phrase<{ path: string[] }>;
		/** Properties read off a call result. */
		fromResult: Phrase<{ path: string[]; source: string }>;
		context: string;
	};
	array: {
		empty: string;
		withoutDuplicates: Phrase<{ value: string }>;
		copyOf: Phrase<{ value: string }>;
		concat: Phrase<{ parts: string[] }>;
		concatBlock: string;
		listOf: Phrase<{ items: string }>;
		listOfBlock: string;
	};
	object: {
		empty: string;
		override: Phrase<{ key: string; value: string }>;
		withOverrides: Phrase<{ base: string; overrides: string }>;
		withOverridesBlock: Phrase<{ base: string }>;
		getter: Phrase<{ key: string }>;
		method: Phrase<{ key: string; params: string | null }>;
		with: Phrase<{ items: string }>;
		withBlock: string;
	};
	ternary: {
		nothingIf: Phrase<{ condition: string; otherwise: string }>;
		otherwiseNote: Phrase<{ value: string; condition: string; otherwise: string }>;
		onlyIfBlock: Phrase<{ value: string; condition: string }>;
		otherwiseNothing: Phrase<{ value: string; condition: string }>;
		inline: Phrase<{ value: string; condition: string; otherwise: string }>;
		ifSo: Phrase<{ value: string }>;
		ifNot: Phrase<{ value: string }>;
		depending: Phrase<{ condition: string }>;
	};
	assign: {
		callInto: Phrase<{ call: string; target: string }>;
		set: Phrase<{ target: string; value: string }>;
		add: Phrase<{ target: string; value: string }>;
		subtract: Phrase<{ target: string; value: string }>;
		multiply: Phrase<{ target: string; value: string }>;
		setIfMissing: Phrase<{ target: string; value: string }>;
		setIfEmpty: Phrase<{ target: string; value: string }>;
		replaceIfSet: Phrase<{ target: string; value: string }>;
	};
	lambda: {
		/** The parameter clause of a function noun, e.g. " of price and quantity". */
		params: Phrase<{ params: string }>;
		giving: Phrase<{ params: string | null; value: string }>;
		steps: Phrase<{ params: string | null }>;
	};
	params: {
		typed: Phrase<{ name: string; type: string }>;
		withDefault: Phrase<{ name: string; value: string }>;
		rest: Phrase<{ name: string }>;
		restOf: Phrase<{ name: string }>;
		renamed: Phrase<{ key: string; local: string }>;
	};
	args: {
		/** Short argument list appended right after a callee. */
		inline: Phrase<{ list: string }>;
		flagOff: Phrase<{ key: string }>;
	};
	jsx: {
		fragment: string;
		steps: string;
		element: Phrase<{ tag: string; attrs: string[] }>;
		text: Phrase<{ text: string }>;
		onlyIf: Phrase<{ condition: string; value: string }>;
		showing: Phrase<{ element: string; child: string }>;
		containing: Phrase<{ element: string }>;
	};
	errors: {
		generic: string;
		/** Name of a custom error class, from its words: "BadRequest" -> "a bad request". */
		label: Phrase<{ words: string }>;
		describe: Phrase<{ label: string; message: string | null; code: string | null; status: string | null }>;
	};
}

/** Function and method calls that no plugin rule claimed. `owner` is a code tag like "[Utils]" or "". */
export interface CallPhrases {
	superCall: Phrase<{ args: string }>;
	run: Phrase<{ fn: string; owner: string; args: string }>;
	trigger: Phrase<{ fn: string; owner: string; args: string }>;
	/** A verb-named function used as an action, e.g. "charge customer (amount)". */
	action: Phrase<{ fn: string; owner: string; args: string }>;
	resultOf: Phrase<{ fn: string; owner: string; args: string }>;
	/** A noun-named function used as a value; `words` is its plain text for article choice. */
	noun: Phrase<{ fn: string; words: string; plural: boolean; owner: string; args: string }>;
	/** A function whose name ends in a preposition: `pricesFor(x)`. */
	prepositional: Phrase<{ fn: string; args: string; owner: string }>;
	convert: Phrase<{ target: string; subject: string; owner: string; given: string | null }>;
	convertArgs: Phrase<{ target: string; source: string; owner: string; args: string }>;
	checkWhether: Phrase<{ condition: string }>;
	predicate: Phrase<{ subject: string | null; predicate: string; owner: string; given: string | null }>;
	methodPredicate: Phrase<{ object: string | null; predicate: string; args: string; action: boolean }>;
	methodVerb: Phrase<{ verb: string; object: string | null; rest: string | null; args: string }>;
	method: Phrase<{ object: string | null; method: string; args: string }>;
	methodRun: Phrase<{ object: string | null; method: string; args: string }>;
	methodTrigger: Phrase<{ object: string | null; method: string; args: string }>;
	callValue: Phrase<{ callee: string; args: string }>;
	callAction: Phrase<{ callee: string; args: string }>;
	newInstance: Phrase<{ ctor: string; args: string }>;
}

/** Yes/no conditions. */
export interface ConditionPhrases {
	bool: Phrase<{ value: boolean }>;
	it: string;
	onlyCheckedWhen: Phrase<{ condition: string; when: string }>;
	ifElse: Phrase<{ test: string; then: string; otherwise: string }>;
	/** Rephrases an arbitrary call's rendered text as a condition (it may start "whether"/"the"/...). */
	fromCall: Phrase<{ call: string } & Neg>;
	methodPredicate: Phrase<{ object: string | null; predicate: string; args: string }>;
	subjectPredicate: Phrase<{ subject: string; predicate: string }>;
	flag: Phrase<{ subject: string } & Neg>;
	isSet: Phrase<{ subject: string } & Neg>;
	/** `if (new.target)`: whether the function was invoked with `new`. */
	calledWithNew: Phrase<Neg>;
	isEmpty: Phrase<{ subject: string } & Neg>;
	afterAssign: Phrase<{ action: string } & Neg>;
	allOf: string;
	anyOf: string;
	/** Readable names for `typeof x === "..."` results. */
	typeofNames: Record<string, string>;
	isType: Phrase<{ subject: string; type: string } & Neg>;
	sameAs: Phrase<{ left: string; right: string } & Neg>;
	equals: Phrase<{ left: string; right: string } & Neg>;
	countCompare: Record<RelOp, Phrase<{ subject: string; count: number }>>;
	sign: Record<RelOp, Phrase<{ subject: string }>>;
	compare: Record<RelOp, Phrase<{ left: string; right: string; time: boolean }>>;
	instanceOf: Phrase<{ subject: string; type: string; typeWords: string } & Neg>;
	hasKey: Phrase<{ object: string; key: string } & Neg>;
}

/** Control flow. Block intros omit their trailing colon; the walker adds it. */
export interface StatementPhrases {
	comment: Phrase<{ text: string }>;
	/** `void run();`: start something without waiting for it to finish. */
	startWithoutWaiting: Phrase<{ action: string }>;
	/** `await pending;` on a value that isn't a call. */
	waitFor: Phrase<{ value: string }>;
	doNothing: string;
	continue: string;
	break: string;
	stop: string;
	exportDefault: Phrase<{ value: string }>;
	loopForever: string;
	whileBlock: string;
	while: Phrase<{ condition: string }>;
	doOnce: string;
	doWhileTail: Phrase<{ condition: string }>;
	loopItem: {
		each: Phrase<{ item: string }>;
		key: Phrase<{ key: string; value: string | null }>;
		indexed: Phrase<{ item: string; position: string | null }>;
	};
	forOf: Phrase<{ label: string; collection: string; async: boolean }>;
	forIndex: Phrase<{ index: string; collection: string }>;
	countFrom: Phrase<{ index: string; start: string; condition: string }>;
	forParts: Phrase<{ init: string | null; test: string | null; update: string | null }>;
	ifThen: Phrase<{ condition: string; action: string }>;
	if: Phrase<{ condition: string }>;
	ifBlock: string;
	then: string;
	elseIf: Phrase<{ condition: string }>;
	otherwise: string;
	skipIf: Phrase<{ condition: string }>;
	breakIf: Phrase<{ condition: string }>;
	returnNothing: string;
	returnWhether: Phrase<{ condition: string }>;
	returnCall: Phrase<{ call: string }>;
	returnEither: Phrase<{ value: string; condition: string; otherwise: string }>;
	return: Phrase<{ value: string }>;
	throw: Phrase<{ error: string }>;
	try: string;
	catchIgnore: string;
	catch: Phrase<{ error: string | null }>;
	finally: string;
	switch: Phrase<{ value: string }>;
	case: Phrase<{ values: string }>;
	caseOrDefault: Phrase<{ values: string }>;
	default: string;
}

/** Functions, classes, variables, and type/enum headings. */
export interface DeclarationPhrases {
	names: { defaultExport: string; anonymous: string; anonymousClass: string };
	type: Phrase<{ name: string; shape: string }>;
	enum: Phrase<{ name: string; members: string }>;
	uninitialized: Phrase<{ name: string }>;
	letMean: Phrase<{ name: string; condition: string }>;
	/** A call whose result's name only repeats the function's own words (`const user = await findUser(id)`). */
	callInto: Phrase<{ call: string; name: string }>;
	callAs: Phrase<{ call: string; name: string }>;
	letStart: Phrase<{ name: string; value: string }>;
	let: Phrase<{ name: string; value: string }>;
	declare: Phrase<{ names: string }>;
	callTake: Phrase<{ call: string; names: string }>;
	takeFrom: Phrase<{ source: string; names: string }>;
	skipped: string;
	parallel: string;
	callTakeFirst: Phrase<{ call: string; name: string }>;
	letFirst: Phrase<{ name: string; value: string }>;
	split: Phrase<{ value: string; names: string }>;
	title: {
		converter: Phrase<{ from: string; to: string }>;
		predicate: Phrase<{ words: string }>;
		component: Phrase<{ name: string }>;
		toType: Phrase<{ target: string }>;
		action: Phrase<{ action: string }>;
	};
	signature: Phrase<{ title: string; params: string | null; returns: string | null; async: boolean }>;
	class: Phrase<{ name: string; base: string | null }>;
	constructor: Phrase<{ params: string | null }>;
	fieldInit: Phrase<{ field: string; value: string }>;
	field: Phrase<{ field: string }>;
}

/** Type annotations, and the standalone type explainer. */
export interface TypePhrases {
	unknown: string;
	string: string;
	number: string;
	boolean: string;
	nothing: string;
	any: string;
	object: string;
	function: string;
	listOf: Phrase<{ item: string }>;
	lookup: Phrase<{ key: string; value: string }>;
	map: Phrase<{ key: string; value: string }>;
	set: Phrase<{ item: string }>;
	/** A named type; `name` is its plain text for article choice. */
	reference: Phrase<{ type: string; name: string }>;
	oneOf: Phrase<{ options: string; optional: boolean }>;
	union: Phrase<{ options: string; optional: boolean }>;
	objectWith: Phrase<{ members: string }>;
	tuple: Phrase<{ items: string }>;
	/** `A & B`: every part, all at once. */
	intersection: Phrase<{ parts: string[] }>;
	/** `T["key"]`. */
	indexed: Phrase<{ type: string; key: string }>;
	/** `typeof value`. */
	typeOf: Phrase<{ value: string }>;
	/** `(typeof list)[number]`, `T[number]`. */
	itemOf: Phrase<{ type: string }>;
	/** `Pick<T, "a" | "b">`. */
	pick: Phrase<{ type: string; fields: string }>;
	/** `Omit<T, "a">`. */
	omit: Phrase<{ type: string; fields: string }>;
	/** `ReturnType<F>`. */
	returnOf: Phrase<{ fn: string }>;
	/** `Parameters<F>`, and `Parameters<F>[i]` with a 0-based `index`. */
	paramsOf: Phrase<{ fn: string; index: number | null }>;
	/** `keyof T`. */
	keyOf: Phrase<{ type: string }>;
	bigint: string;
	predicate: Phrase<{ subject: string; type: string }>;
	/** `z.infer<typeof S>` / `z.input` / `z.output`: the data a schema describes. */
	schemaShape: Phrase<{ schema: string; side: "data" | "input" | "output" }>;
	member: Phrase<{ name: string; optional: boolean }>;
	explain: {
		object: Phrase<{ name: string; bases: string | null }>;
		oneOf: Phrase<{ name: string }>;
		class: Phrase<{ name: string }>;
		method: string;
		field: string;
		/** One field line; `doc` is its source comment, if any. */
		member: Phrase<{ name: string; type: string; optional: boolean; doc: string | null }>;
		enumMember: Phrase<{ name: string; value: string | null; doc: string | null }>;
		option: Phrase<{ value: string; doc: string | null }>;
		schemaShape: Phrase<{ name: string; schema: string }>;
		intersection: Phrase<{ name: string; bases: string | null }>;
		is: Phrase<{ name: string; type: string }>;
		fromSchema: Phrase<{ name: string; schema: string }>;
		/** Adapts a plugin's schema description for a field line (drops what the line already says). */
		schemaField: Phrase<{ described: string }>;
		nullable: string;
		list: string;
		defaultsTo: Phrase<{ value: string }>;
		modified: Phrase<{ base: string; modifiers: string[] }>;
	};
}

/** Every phrase the built-in TS/JS narration can produce, grouped by area. Arguments are already-rendered markup strings. */
export interface CorePhrases {
	expressions: ExpressionPhrases;
	calls: CallPhrases;
	conditions: ConditionPhrases;
	statements: StatementPhrases;
	declarations: DeclarationPhrases;
	types: TypePhrases;
}

/**
 * Phrasebook types by plugin name, so `Locale.plugins` overrides are type-checked. Plugins add themselves:
 * `declare module "@usenarrator/core" { interface PluginPhrases { zod: ZodPhrases } }`.
 */
export interface PluginPhrases {}

/** An output (human) language. Add one by implementing this interface; see `@usenarrator/locale-en`. */
export interface Locale {
	/** BCP 47 tag, e.g. "en", "es", "pt-BR". Plugins look up their own phrasebooks by this id. */
	id: string;
	grammar: Grammar;
	phrases: CorePhrases;
	/** Translations for plugins that don't ship this locale themselves, keyed by plugin name. */
	plugins?: { [K in keyof PluginPhrases]?: PluginPhrases[K] } & Record<string, unknown>;
}
