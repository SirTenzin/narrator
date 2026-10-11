import {
	type CorePhrases,
	capFirst,
	D,
	DETAILS,
	type Doc,
	type ExpressionPhrases,
	type Grammar,
	Lexicon,
	type Line,
	type LineKind,
	type Locale,
	lowerFirst,
	mergePhrases,
	mk,
	plain,
	type RuleError,
	vlen,
} from "@usenarrator/core";
import type { Parser } from "./parser";
import type { CallRule, CondRule, DisplayText, ImportInfo, JsxRule, MemberRule, StmtRule, TsPlugin } from "./plugin";

export type N = any;

/** A rule after the engine has bound its plugin's phrasebook in. */
type Bound<R extends (ctx: any) => any> = (ctx: Omit<Parameters<R>[0], "say">) => ReturnType<R>;

type RelOp = "<" | ">" | "<=" | ">=";

/** Every `import` in a file, keyed by the local name it binds. */
export function importsOf(program: N): Map<string, ImportInfo> {
	const out = new Map<string, ImportInfo>();
	for (const st of program?.body ?? []) {
		if (st.type !== "ImportDeclaration") continue;
		for (const sp of st.specifiers ?? []) {
			const name = sp.type === "ImportDefaultSpecifier" ? "default" : sp.type === "ImportNamespaceSpecifier" ? "*" : (sp.imported?.name ?? sp.imported?.value);
			out.set(sp.local.name, { from: st.source.value, name });
		}
	}
	return out;
}

/** Splits a signature after its title (and any "(async)"-style suffix up to the first separator) for UIs that style details apart. */
const markDetails = (said: string, title: string) => {
	if (!said.startsWith(title)) return said;
	const rest = said.slice(title.length);
	const cut = rest.search(/[,;:]\s/);
	return cut < 0 ? said : `${title}${rest.slice(0, cut + 1)}${DETAILS}${rest.slice(cut + 1)}`;
};

const asDoc = (x: Doc | string) => (typeof x === "string" ? D(x) : x);

/** What a rule may hand back: a Doc, a string, or nothing (falsy) to pass. */
const isRuleResult = (x: unknown) =>
	!x || typeof x === "string" || (typeof x === "object" && typeof (x as Doc).t === "string" && Array.isArray((x as Doc).kids));
const describeValue = (x: unknown) => (x === null ? "null" : Array.isArray(x) ? "an array" : typeof x === "object" ? "an object" : `${typeof x} ${String(x)}`);

const ID = "[A-Za-z_$][\\w$]*";
const INNER = `(?:${ID}|${ID}\\.${ID}|\\*\\.${ID})`;
/** Call and condition keys: `f`, `new F`, `Obj.m`, `Obj.*`, `*.m`, `*.owner.m`, curried `inner()`, tagged ``tag`` ``. A bare `f` may be any
 * dot-free name, since plugins can rewrite the tree with synthetic callees (Effect's `yield*`). */
const CALL_KEY = new RegExp(
	`^(?:[^\\s.()\`*][^\\s.()\`]*|new ${ID}|(?:new )?${ID}\\.(?:${ID}|\\*)|\\*\\.${ID}|\\*\\.${ID}\\.${ID}|${INNER}\\(\\)|${INNER}(?:\\(\\))?\`\`)$`,
);
/** Member keys: `Obj.prop`, `*.prop`, `*.owner.prop`, `Obj.*`, `*.owner.*`. */
const MEMBER_KEY = new RegExp(`^(?:${ID}\\.(?:${ID}|\\*)|\\*\\.${ID}|\\*\\.${ID}\\.(?:${ID}|\\*))$`);
const warnedKeys = new Set<string>();
const warnBadKey = (plugin: string, kind: string, key: string) => {
	const id = `${plugin}:${kind}:${key}`;
	if (warnedKeys.has(id)) return;
	warnedKeys.add(id);
	console.warn(
		`[narrator] plugin "${plugin}" has a ${kind} rule keyed "${key}", which no code can match. See the rule key grammar in the writing-a-plugin guide.`,
	);
};

/** English list join. Kept for plugins; the walker itself uses the locale's `g.list`. */
export const listJoin = (xs: string[], conj = "and") =>
	xs.length <= 1 ? (xs[0] ?? "") : xs.length === 2 ? `${xs[0]} ${conj} ${xs[1]}` : `${xs.slice(0, -1).join(", ")}, ${conj} ${xs.at(-1)}`;

export function unwrap(n: N): N {
	while (
		n &&
		(n.type === "ParenthesizedExpression" ||
			n.type === "TSAsExpression" ||
			n.type === "TSSatisfiesExpression" ||
			n.type === "TSNonNullExpression" ||
			n.type === "TSTypeAssertion" ||
			n.type === "TSInstantiationExpression" ||
			n.type === "ChainExpression" ||
			n.type === "AwaitExpression")
	)
		n = n.expression ?? n.argument;
	return n;
}

const isFn = (n: N) => n && (n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression");
const isNullish = (n: N) => {
	n = unwrap(n);
	return (
		!n ||
		(n.type === "Literal" && n.value === null && !n.regex) ||
		(n.type === "Identifier" && n.name === "undefined") ||
		(n.type === "UnaryExpression" && n.operator === "void")
	);
};
/** Whether an `await` sits under any parentheses or casts. */
const unwrapsAwait = (n: N): boolean => {
	let cur = n;
	while (cur && cur.type !== "AwaitExpression" && cur !== unwrap(cur)) cur = cur.expression ?? cur.argument;
	return cur?.type === "AwaitExpression";
};

const ESCAPES: Record<string, string> = { "\n": "\\n", "\t": "\\t", "\r": "\\r", "\0": "\\0" };

/** Control characters in text shown as their escapes (`\n`, `\t`, `\0`), so output stays on one visible line. */
const visible = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, (c) => ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

const isBoolLit = (n: N) => unwrap(n)?.type === "Literal" && typeof unwrap(n).value === "boolean";
const calleeName = (n: N): string | null => {
	const c = unwrap(n?.callee);
	if (!c) return null;
	if (c.type === "Identifier") return c.name;
	if (c.type === "MemberExpression" && !c.computed) return c.property.name;
	return null;
};
/** Splits off a block colon so a phrase can wrap the text and the colon be put back after it. */
const colonSplit = (t: string) => ({ text: t.replace(/:$/, ""), colon: t.endsWith(":") ? ":" : "" });

const WRAPPERS = new Set(["Promise", "Array", "Partial", "Readonly", "Required", "NonNullable", "Awaited", "ReadonlyArray", "Pick", "Omit"]);

/** The named type behind an annotation (`Promise<Foo[]> | null` -> "Foo"), or null for primitives/inline shapes. */
/** `Item[]`, `Array<Item>`, `readonly Item[]`, optionally `| null`: a list annotation. */
function isListType(t: N): boolean {
	if (!t) return false;
	if (t.type === "TSArrayType") return true;
	if (t.type === "TSParenthesizedType" || t.type === "TSTypeOperator") return isListType(t.typeAnnotation);
	if (t.type === "TSTypeReference") return /^(Readonly)?Array$/.test(t.typeName?.name ?? "");
	if (t.type === "TSUnionType") {
		const real = t.types.filter((x: N) => !/^TS(Null|Undefined)Keyword$/.test(x.type));
		return real.length === 1 && isListType(real[0]);
	}
	return false;
}

export function typeRefName(t: N, code: (n: N) => string): string | null {
	if (!t) return null;
	switch (t.type) {
		case "TSTypeReference": {
			const name = code(t.typeName);
			const args = t.typeArguments?.params ?? t.typeParameters?.params ?? [];
			if (WRAPPERS.has(name) && args[0]) return typeRefName(args[0], code);
			if (/^[A-Z]$/.test(name)) return null;
			return name;
		}
		case "TSArrayType":
			return typeRefName(t.elementType, code);
		case "TSUnionType": {
			const named = t.types.map((x: N) => typeRefName(x, code)).filter(Boolean);
			return named.length === 1 ? named[0] : null;
		}
		case "TSParenthesizedType":
			return typeRefName(t.typeAnnotation, code);
		default:
			return null;
	}
}

export class Engine {
	src = "";
	dialects: TsPlugin[] = [];
	ambient = new Set<string>();
	errorNames = new Set<string>();
	errorLabels: Record<string, string> = Object.create(null);
	constants: Record<string, string> = Object.create(null);
	errorPattern: RegExp | null = null;
	calls: Record<string, Bound<CallRule>[]> = Object.create(null);
	conds: Record<string, Bound<CondRule>[]> = Object.create(null);
	stmtRules: Bound<StmtRule>[] = [];
	members: Record<string, Bound<MemberRule>[]> = Object.create(null);
	jsxRules: Bound<JsxRule>[] = [];
	/** The current file's AST and its imports (local name -> where it came from), set by `narrate`. */
	program: N = null;
	/** The parser's errors for the current file, before any recovery. */
	parseErrors: unknown[] = [];
	imports = new Map<string, ImportInfo>();
	/** The current file's path as the host passed it (repo-relative in the CLI and extension). */
	path = "";
	/** The current file's package dependencies (name -> version range), when the host knows them. */
	dependencies: Record<string, string> = {};

	/** Whether this file imports `lib` (or a subpath like `lib/x`), or its package depends on it. */
	usesLibrary(lib: string): boolean {
		if (this.dependencies[lib] !== undefined) return true;
		for (const { from } of this.imports.values()) if (from === lib || from.startsWith(`${lib}/`)) return true;
		return false;
	}

	/** The major version of `lib` the current package declares, e.g. "^4.2.0" -> 4. */
	libraryMajor(lib: string): number | null {
		const m = this.dependencies[lib]?.match(/(\d+)/);
		return m ? Number(m[1]) : null;
	}
	aliases = new Map<string, string>();
	/** variable -> type spec: `Type` or `@Type.field`. */
	varTypes = new Map<string, string>();
	localFns = new Set<string>();
	/** Optional cross-file hook: declared return type name of a called function. */
	typeOfCall: ((fnName: string) => string | null) | null = null;
	bools = new Set<string>();
	comments: { start: number; end: number; value: string; type: string }[] = [];
	usedComments = new Set<number>();
	/** Heading line text -> its short title (the declaration's name without signature details). */
	headTitles = new Map<string, string>();
	stats = { nodes: 0, fallbacks: 0, fallbackTypes: {} as Record<string, number>, ruleErrors: [] as RuleError[] };

	readonly parse: Parser;
	readonly locale: Locale;
	readonly say: CorePhrases;
	readonly g: Grammar;
	readonly lex = new Lexicon();

	constructor({ parser, plugins, locale }: { parser: Parser; plugins: TsPlugin[]; locale: Locale }) {
		this.parse = parser;
		this.locale = locale;
		this.say = locale.phrases;
		this.g = locale.grammar;
		for (const d of plugins) this.use(d);
	}

	use(d: TsPlugin) {
		this.dialects.push(d);
		const say = this.phrasesFor(d) as DisplayText | undefined;
		const lib = d.library?.name;
		const bind = <R extends (ctx: any) => any>(r: R, rule: string, ok: (out: unknown) => boolean, fallback: ReturnType<R>): Bound<R> => {
			const bound = ((ctx: Omit<Parameters<R>[0], "say">) => {
				const lines = this.lines;
				const lineCount = lines.length;
				try {
					const out = r({ ...ctx, say });
					if (ok(out)) return out;
					this.ruleError(
						d.name,
						rule,
						(ctx as { node?: N }).node,
						`returned ${describeValue(out)}; expected ${rule.startsWith("statements") ? "true or false" : "a Doc, a string or null"}`,
					);
				} catch (err) {
					this.lines = lines;
					lines.length = lineCount;
					this.ruleError(d.name, rule, (ctx as { node?: N }).node, err instanceof Error ? err.message : String(err));
				}
				return fallback;
			}) as Bound<R> & { lib?: string };
			bound.lib = lib;
			return bound;
		};
		const table = (kind: "calls" | "conditions" | "members", rules: Record<string, (ctx: any) => any> | undefined, into: Record<string, any[]>) => {
			for (const [k, r] of Object.entries(rules ?? {})) {
				if (!(kind === "members" ? MEMBER_KEY : CALL_KEY).test(k)) warnBadKey(d.name, kind, k);
				(into[k] ??= []).unshift(bind(r, `${kind}["${k}"]`, isRuleResult, null));
			}
		};
		if (d.vocabulary) this.lex.extend(d.vocabulary);
		if (say?.glossary) this.lex.extend({ glossary: say.glossary });
		for (const a of d.ambient ?? []) this.ambient.add(a);
		Object.assign(this.errorLabels, d.errorLabels, say?.errorLabels);
		Object.assign(this.constants, d.constants, say?.constants);
		if (d.errors instanceof RegExp) this.errorPattern = d.errors;
		else for (const x of d.errors ?? []) this.errorNames.add(x);
		table("calls", d.calls, this.calls);
		table("conditions", d.conditions, this.conds);
		table("members", d.members, this.members);
		this.stmtRules.push(...(d.statements ?? []).map((r, i) => bind(r, `statements[${i}]`, (out) => typeof out === "boolean" || out == null, false)));
		if (d.jsx) this.jsxRules.unshift(bind(d.jsx, "jsx", isRuleResult, null));
		return this;
	}

	/** Records a plugin rule failure in `stats.ruleErrors`, counting repeats. */
	ruleError(plugin: string, rule: string, node: N, message: string) {
		const seen = this.stats.ruleErrors.find((x) => x.plugin === plugin && x.rule === rule && x.message === message);
		if (seen) seen.count++;
		else {
			const line = typeof node?.start === "number" ? this.src.slice(0, node.start).split("\n").length : undefined;
			this.stats.ruleErrors.push({ plugin, rule, message, count: 1, ...(line ? { line } : {}) });
		}
	}

	/** A plugin's phrasebook for this locale, merged key by key: locale override, then the plugin's own translation, then English. */
	phrasesFor(d: TsPlugin): unknown {
		if (this.phrasebooks.has(d)) return this.phrasebooks.get(d);
		const layers = [d.phrases?.en, this.locale.id === "en" ? undefined : d.phrases?.[this.locale.id], this.locale.plugins?.[d.name]].filter(
			(x) => x !== undefined,
		);
		const merged = layers.length <= 1 ? layers[0] : mergePhrases(layers[0], ...layers.slice(1));
		this.phrasebooks.set(d, merged);
		return merged;
	}
	private phrasebooks = new WeakMap<TsPlugin, unknown>();

	/** `isUpgrade` -> "is upgrade" / "is not upgrade". */
	predicatePhrase(id: string, negated: boolean): string {
		const w = this.lex.words(id);
		return `${negated ? this.g.negatePredicateHead(w[0]!) : w[0]!} ${this.lex.display(w.slice(1))}`.trim();
	}

	/** A property or key name as linked display text: `cusId` -> "customer ID". */
	prop(key: string): string {
		return mk("v", this.words(key), key);
	}

	schemaText(n: N): string | null {
		for (const d of this.dialects) {
			if (!d.describeSchema) continue;
			try {
				const t = d.describeSchema(this, n, this.phrasesFor(d));
				if (t && typeof t !== "string") this.ruleError(d.name, "describeSchema", n, `returned ${describeValue(t)}; expected a string or null`);
				else if (t) return t;
			} catch (err) {
				this.ruleError(d.name, "describeSchema", n, err instanceof Error ? err.message : String(err));
			}
		}
		return null;
	}

	// ---------- basics ----------

	raw(n: N, reason = n?.type): string {
		this.stats.fallbacks++;
		this.stats.fallbackTypes[reason] = (this.stats.fallbackTypes[reason] ?? 0) + 1;
		const code = this.src.slice(n.start, n.end).replace(/\s+/g, " ");
		return mk("c", code);
	}

	code(n: N) {
		return this.src.slice(n.start, n.end);
	}

	ref(name: string): string {
		const alias = this.aliases.get(name);
		if (alias) return alias;
		const t = this.varTypes.get(name);
		return mk("v", this.words(name), t ? `${name}|${t}` : name);
	}

	/** An identifier as words; HTTP methods and vowelless initialisms (`GET`, `KV`) keep their casing, other constants read as words. */
	words(name: string): string {
		return HTTP_METHODS.has(name) || /^[B-DF-HJ-NP-TV-Z][B-DF-HJ-NP-TV-Z0-9]{1,3}$/.test(name) ? name : this.lex.humanize(name);
	}

	/** `` $`…` `` with `$` imported from "bun". */
	isBunShell(n: N): boolean {
		const tag = unwrap(n.tag);
		return tag?.type === "Identifier" && tag.name === "$" && this.imports.get("$")?.from === "bun";
	}

	/** Whether a variable only names what the call produces (`user = findUser()`, `posts = getPostsFor(x)`, `widths = columnWidths()`), so the call says it. */
	namesItsResult(fnName: string, varName: string): boolean {
		const vw = this.lex.words(varName);
		const fw = this.lex.words(fnName);
		if (!this.lex.startsWithVerb(fnName)) return vw.length > 0 && fw.slice(-vw.length).join(" ") === vw.join(" ");
		const object = fw.slice(1);
		const end = object.findIndex((w) => /^(by|for|from|of|in|on|at|to|with|into)$/.test(w));
		return vw.length > 0 && (end < 0 ? object : object.slice(0, end)).join(" ") === vw.join(" ");
	}

	/** A verb-led name, or a function defined in this file, reads as an action. */
	isActionName(name: string): boolean {
		return this.lex.startsWithVerb(name) || this.localFns.has(name);
	}

	fnRef(name: string, text: string) {
		return mk("f", text, name);
	}

	isAmbient(n: N): boolean {
		n = unwrap(n);
		if (!n) return false;
		if (n.type === "Identifier") return this.ambient.has(n.name);
		if (n.type === "MemberExpression" && !n.computed) return this.ambient.has(n.property.name) && this.isAmbient(n.object);
		return false;
	}

	isErrorCtor(name: string) {
		return this.errorNames.has(name) || !!this.errorPattern?.test(name);
	}

	isBoolName(name: string) {
		return this.bools.has(name) || this.lex.isPredicateName(name);
	}

	looksBoolean(n: N): boolean {
		n = unwrap(n);
		if (!n) return false;
		if (n.type === "UnaryExpression" && n.operator === "!") return true;
		if (n.type === "BinaryExpression" && /^(===|!==|==|!=|<|>|<=|>=|in|instanceof)$/.test(n.operator)) return true;
		if (n.type === "LogicalExpression" && n.operator !== "??") return this.looksBoolean(n.left) && this.looksBoolean(n.right);
		if (isBoolLit(n)) return true;
		if (n.type === "CallExpression") {
			const exact = this.ruleKeyOf(unwrap(n.callee));
			if (exact && !exact.startsWith("*.") && !this.conds[exact] && this.claimsExactly(exact, n)) return false;
			const c = calleeName(n);
			if (c && (this.lex.isPredicateName(c) || /^(includes|has|some|every|startsWith|endsWith|isArray|test|Boolean|notNullish|nullish|eq|and|or)$/.test(c)))
				return true;
		}
		if (n.type === "Identifier") return this.isBoolName(n.name);
		return false;
	}

	// ---------- arguments ----------

	argPairs(args: N[], skip: Set<string> = new Set()): { key: string | null; node: N; text: Doc }[] {
		const out: { key: string | null; node: N; text: Doc }[] = [];
		for (const a of args) {
			const u = unwrap(a);
			if (isNullish(u) && u.type === "Identifier") continue;
			if (this.isAmbient(u)) continue;
			if (u.type === "ObjectExpression") {
				for (const p of u.properties) {
					if (p.type === "SpreadElement") {
						if (!this.isAmbient(p.argument))
							out.push({
								key: null,
								node: p,
								text: D(this.say.expressions.everythingIn({ value: this.noun(p.argument).t }), this.noun(p.argument).kids),
							});
						continue;
					}
					const k = p.key.type === "Identifier" ? p.key.name : p.key.type === "Literal" ? String(p.key.value) : null;
					if (k && skip.has(k)) continue;
					if (this.isAmbient(p.value)) continue;
					out.push({ key: k, node: p.value, text: p.shorthand ? D(this.ref(k!)) : this.noun(p.value) });
				}
				continue;
			}
			out.push({ key: null, node: u, text: this.noun(u) });
		}
		return out;
	}

	/** Rendered arguments, their joined text, and whether they're short enough to sit inline after the callee. */
	argItems(args: N[], skip?: Set<string>): { items: Doc[]; joined: string; inline: boolean } {
		const p = this.say.expressions;
		const items = this.argPairs(args, skip).map(({ key, node, text }) => {
			if (!key) return text;
			const sameWords =
				plain(text.t) === this.lex.humanize(key) || (unwrap(node)?.type === "Identifier" && this.lex.humanize(unwrap(node).name) === this.lex.humanize(key));
			if (sameWords) return text;
			const label = mk("v", this.lex.humanize(key), key);
			if (isBoolLit(node)) return D(unwrap(node).value ? label : p.args.flagOff({ key: label }));
			return D(p.labeled({ key: label, value: text.t }), text.kids);
		});
		const joined = this.g.list(items.map((i) => i.t));
		return { items, joined, inline: items.length <= 3 && vlen(joined) <= 70 && items.every((i) => !i.kids.length) };
	}

	argList(args: N[], skip?: Set<string>): Doc {
		const { items, joined, inline } = this.argItems(args, skip);
		if (!items.length) return D("");
		if (inline) return D(this.say.expressions.args.inline({ list: joined }));
		return D(
			":",
			items.flatMap((i) => this.bullet(i)),
		);
	}

	bullet(doc: Doc, d = 0, kind: LineKind = "bullet"): Line[] {
		return [
			{ d, text: `• ${doc.t}${doc.kids.length && !doc.t.endsWith(":") ? ":" : ""}`, start: -1, end: -1, kind },
			...doc.kids.map((k) => ({ ...k, d: k.d + d + 1 })),
		];
	}

	// ---------- nouns ----------

	noun(node: N): Doc {
		const n = unwrap(node);
		this.stats.nodes++;
		const p = this.say.expressions;
		if (!n) return D(p.nothing);
		if ((n.type === "MemberExpression" || n.type === "Identifier") && Object.keys(this.constants).length) {
			const k = this.code(n).replace(/\?\./g, ".");
			if (this.constants[k]) return D(mk("l", this.constants[k]!));
			const meta = /^import\.meta\.(\w+)(?:\.(\w+))?$/.exec(k);
			if (meta) {
				const M: Record<string, string> = {
					main: p.importMeta.main,
					dir: p.importMeta.dir,
					dirname: p.importMeta.dir,
					url: p.importMeta.url,
					filename: p.importMeta.path,
					path: p.importMeta.path,
				};
				if (meta[1] === "env" && meta[2]) return D(p.envVar({ name: mk("l", meta[2]) }));
				if (Object.hasOwn(M, meta[1]!)) return D(M[meta[1]!]!);
			}
			const env = /^process\.env\.(\w+)$/.exec(k) ?? /^Bun\.env\.(\w+)$/.exec(k);
			if (env) return D(p.envVar({ name: mk("l", env[1]!) }));
		}
		switch (n.type) {
			case "Identifier":
				if (n.name === "undefined") return D(p.nothing);
				return D(this.ref(n.name));
			case "PrivateIdentifier":
				return D(this.ref(n.name));
			case "Literal":
				return D(this.literal(n));
			case "TemplateLiteral":
				return this.template(n);
			case "ThisExpression":
				return D(p.this);
			case "Super":
				return D(p.parentClass);
			case "MemberExpression":
				return this.memberRule(n) ?? this.member(n);
			case "CallExpression":
				return this.call(n, false);
			case "NewExpression":
				return this.newExpr(n);
			case "ArrayExpression":
				return this.array(n);
			case "ObjectExpression":
				return this.object(n);
			case "SpreadElement":
				return this.wrap(this.noun(n.argument), (t) => p.allOf({ value: t }));
			case "UnaryExpression":
				if (n.operator === "!") return this.wrap(this.cond(n.argument, true), (t) => p.whether({ condition: t }));
				if (n.operator === "typeof") return this.wrap(this.noun(n.argument), (t) => p.typeOf({ value: t }));
				if (n.operator === "-" && unwrap(n.argument)?.type === "Literal" && typeof unwrap(n.argument).value === "number")
					return D(mk("l", `-${plain(this.literal(unwrap(n.argument)))}`));
				if (n.operator === "-") return this.wrap(this.noun(n.argument), (t) => p.negative({ value: t }));
				if (n.operator === "void") return D(p.nothing);
				if (n.operator === "+") return this.wrap(this.noun(n.argument), (t) => p.asNumber({ value: t }));
				return D(this.raw(n));
			case "BinaryExpression":
			case "LogicalExpression":
				return this.binaryNoun(n);
			case "ConditionalExpression":
				return this.ternary(n);
			case "ArrowFunctionExpression":
			case "FunctionExpression":
				return this.lambdaNoun(n);
			case "AssignmentExpression":
				return this.assign(n);
			case "UpdateExpression":
				return D((n.operator === "++" ? p.increment : p.decrement)({ target: this.noun(n.argument).t }));
			case "SequenceExpression":
				return D(p.sequence({ steps: n.expressions.map((x: N) => this.noun(x).t) }));
			case "YieldExpression":
				return this.wrap(this.noun(n.argument), (t) => (n.delegate ? p.yieldAll : p.yield)({ value: t }));
			case "ImportExpression":
				return this.wrap(this.noun(n.source), (t) => p.dynamicImport({ path: t }));
			case "TaggedTemplateExpression": {
				const tag = unwrap(n.tag);
				const inner = tag.type === "CallExpression" ? this.ruleKeyOf(unwrap(tag.callee)) : null;
				const key = inner ? `${inner}()` : this.ruleKeyOf(tag);
				const wild = tag.type === "MemberExpression" && !tag.computed && !key?.startsWith("*.") ? `*.${tag.property.name}` : null;
				for (const rule of [key, wild].flatMap((k) => (k ? (this.calls[`${k}\`\``] ?? []) : []))) {
					const r = rule({ node: n, args: [n.quasi], obj: null, e: this, stmt: false });
					if (r) return asDoc(r);
				}
				const tagCode = this.code(n.tag);
				const text = n.quasi.quasis
					.map((q: N) => q.value.cooked)
					.join("{…}")
					.replace(/\s+/g, " ")
					.trim();
				if (/sql/i.test(tagCode)) return D(p.sql({ query: mk("c", text) }));
				const quoted = this.template(n.quasi);
				if (this.isBunShell(n)) return this.wrap(quoted, (t) => p.shell({ command: t, stmt: false }));
				const by = this.noun(n.tag);
				return D(p.tagged({ tag: by.t, text: quoted.t }), [...by.kids, ...quoted.kids]);
			}
			case "ClassExpression":
				return D(p.classExpr({ name: n.id?.name ?? null }));
			case "JSXElement":
			case "JSXFragment":
				for (const rule of this.jsxRules) {
					const r = rule({ node: n, e: this });
					if (r) return asDoc(r);
				}
				return this.jsx(n);
			case "MetaProperty":
				return D(n.meta?.name === "new" ? p.newTarget : p.metaProperty);
			default:
				return D(this.raw(n));
		}
	}

	wrap(d: Doc, f: (t: string) => string): Doc {
		return D(f(d.t.replace(/:$/, "")), d.kids);
	}

	literal(n: N): string {
		if (n.regex) return mk("c", n.raw);
		if (n.value === null) return this.say.expressions.nothing;
		if (typeof n.value === "string") return mk("l", `"${visible(n.value)}"`);
		if (typeof n.value === "number") {
			const v = n.value;
			if (Number.isInteger(v) && Math.abs(v) >= 10000) return mk("l", this.g.formatNumber(v));
			return mk("l", String(v));
		}
		return mk("l", String(n.value));
	}

	template(n: N): Doc {
		if (n.expressions.length === 1 && n.quasis.every((q: N) => !q.value.cooked)) return this.noun(n.expressions[0]);
		const quasi = (i: number) => visible(n.quasis[i].value.cooked ?? n.quasis[i].value.raw);
		if (!n.expressions.length) return D(mk("l", `"${quasi(0)}"`));
		let t = mk("l", `"${quasi(0)}`);
		n.expressions.forEach((ex: N, i: number) => {
			t += `{${this.noun(ex).t}}`;
			t += mk("l", `${quasi(i + 1)}${i === n.expressions.length - 1 ? '"' : ""}`);
		});
		return D(t);
	}

	/** Flattens `a.b?.c[0]` into root + steps. */
	chain(n: N): { root: N; steps: { name?: string; index?: N }[] } {
		const steps: { name?: string; index?: N }[] = [];
		let cur = unwrap(n);
		while (cur?.type === "MemberExpression") {
			if (cur.computed) {
				const p = unwrap(cur.property);
				if (p.type === "Literal" && typeof p.value === "string") steps.unshift({ name: p.value });
				else steps.unshift({ index: cur.property });
			} else steps.unshift({ name: cur.property.name });
			cur = unwrap(cur.object);
		}
		return { root: cur, steps };
	}

	/** `c.env.DB.name`: a member rule that claims an inner link (`c.env.DB`) becomes the owner of the rest of the chain. */
	innerMemberRule(n: N): Doc | null {
		const outer: string[] = [];
		let cur = unwrap(n);
		while (cur?.type === "MemberExpression" && !cur.computed && cur.property?.type === "Identifier" && cur.property.name !== "length") {
			outer.unshift(cur.property.name);
			cur = unwrap(cur.object);
			if (cur?.type !== "MemberExpression") return null;
			const r = this.memberRule(cur);
			if (r)
				return this.joinPossessive(
					r,
					outer.map((name) => mk("v", this.words(name), name)),
				);
		}
		return null;
	}

	member(n: N): Doc {
		const inner = this.innerMemberRule(n);
		if (inner) return inner;
		const m = this.say.expressions.member;
		const { root, steps } = this.chain(n);
		const last = steps.at(-1)!;
		if (
			last.name === "length" &&
			steps.length === 1 &&
			root?.type === "CallExpression" &&
			unwrap(root.callee).property?.name === "filter" &&
			root.arguments[0]?.type?.includes("Function")
		) {
			const fn = unwrap(root.arguments[0]);
			const ex = this.lambdaExpr(fn);
			if (ex) {
				const coll = this.noun(unwrap(root.callee).object);
				const c = this.cond(ex);
				const count = this.readsWhose(fn, c) ? m.countWhose : m.countWhere;
				return D(count({ collection: coll.t, condition: c.t }), [...coll.kids, ...c.kids]);
			}
		}
		if (last.name === "length" && steps.length >= 1) {
			const inner = this.memberFrom(root, steps.slice(0, -1));
			return this.wrap(inner, (t) => m.countOf({ value: t }));
		}
		if (last.index) {
			const idx = unwrap(last.index);
			const inner = this.memberFrom(root, steps.slice(0, -1));
			if (idx.type === "Literal" && idx.value === 0) return this.wrap(inner, (t) => m.firstOf({ value: t }));
			if (idx.type === "Literal" && typeof idx.value === "number") return this.wrap(inner, (t) => m.nthOf({ value: t, position: String(idx.value + 1) }));
			if (
				idx.type === "BinaryExpression" &&
				idx.operator === "-" &&
				unwrap(idx.left).type === "MemberExpression" &&
				unwrap(idx.left).property?.name === "length" &&
				unwrap(idx.right).value === 1
			)
				return this.wrap(inner, (t) => m.lastOf({ value: t }));
			const k = this.noun(idx);
			return D(m.entryFor({ owner: inner.t, key: k.t }), [...inner.kids, ...k.kids]);
		}
		return this.memberFrom(root, steps);
	}

	memberFrom(root: N, steps: { name?: string; index?: N }[]): Doc {
		const m = this.say.expressions.member;
		const rootAmbient = this.isAmbient(root);
		let base: Doc | null = rootAmbient ? null : this.noun(root);
		const firstBase = base;
		const names: string[] = [];
		const words: string[] = [];
		for (let i = 0; i < steps.length; i++) {
			const s = steps[i]!;
			if (s.index) {
				const idx = unwrap(s.index);
				const first = idx.type === "Literal" && idx.value === 0;
				if (first && names.length && this.g.isPlural(this.lex.humanize(names.at(-1)!))) {
					const n = names.pop()!;
					words.pop();
					words.push(m.firstItem({ item: mk("v", this.g.singular(this.lex.humanize(n)), n) }));
					names.push(n);
					continue;
				}
				const cur = this.joinPossessive(base, words);
				const k = this.noun(s.index);
				base = first ? D(m.firstOf({ value: cur.t }), cur.kids) : D(m.entryFor({ owner: cur.t, key: k.t }), [...cur.kids, ...k.kids]);
				names.length = 0;
				words.length = 0;
				continue;
			}
			if (rootAmbient && !names.length && !base && this.ambient.has(s.name!)) continue;
			const rootType = i === 0 && root?.type === "Identifier" ? this.varTypes.get(root.name) : undefined;
			const ownerType = rootType && !rootType.startsWith("@") ? rootType : null;
			names.push(s.name!);
			words.push(mk("v", this.words(s.name!), ownerType ? `${s.name}|@${ownerType}.${s.name}` : s.name!));
		}
		return this.joinPossessive(base, words, root?.type === "CallExpression" && !!base && base === firstBase);
	}

	joinPossessive(base: Doc | null, words: string[], fromCall = false): Doc {
		const m = this.say.expressions.member;
		if (fromCall && base && words.length) return D(m.fromResult({ path: words, source: base.t }), base.kids);
		if (!base) return D(words.length ? m.contextChain({ path: words }) : m.context);
		if (!words.length) return base;
		return D(m.chain({ path: [base.t, ...words] }), base.kids);
	}

	array(n: N): Doc {
		const p = this.say.expressions;
		const a = p.array;
		const els = n.elements.filter(Boolean);
		if (!els.length) return D(a.empty);
		if (els.length === 1 && els[0].type === "SpreadElement") {
			const inner = unwrap(els[0].argument);
			if (inner.type === "NewExpression" && inner.callee.name === "Set")
				return this.wrap(this.noun(inner.arguments[0]), (t) => a.withoutDuplicates({ value: t }));
			return this.wrap(this.noun(inner), (t) => a.copyOf({ value: t }));
		}
		if (els.every((e: N) => e.type === "SpreadElement")) {
			const parts: Doc[] = els.map((e: N) => this.noun(e.argument));
			const joined = a.concat({ parts: parts.map((x) => x.t) });
			if (vlen(joined) <= 80 && parts.every((x) => !x.kids.length)) return D(joined);
			return D(
				`${a.concatBlock}:`,
				parts.flatMap((x) => this.bullet(x)),
			);
		}
		const parts = els.map((e: N) => (e.type === "SpreadElement" ? this.wrap(this.noun(e.argument), (t) => p.everythingIn({ value: t })) : this.noun(e)));
		const joined = this.g.list(parts.map((x: Doc) => x.t));
		if (parts.length <= 4 && vlen(joined) < 70 && parts.every((x: Doc) => !x.kids.length)) return D(a.listOf({ items: joined }));
		return D(
			`${a.listOfBlock}:`,
			parts.flatMap((x: Doc) => this.bullet(x)),
		);
	}

	object(n: N): Doc {
		const p = this.say.expressions;
		const o = p.object;
		if (!n.properties.length) return D(o.empty);
		const [first, ...rest] = n.properties;
		if (first.type === "SpreadElement" && rest.length && rest.every((x: N) => x.type !== "SpreadElement" && !x.method)) {
			const base = this.noun(first.argument);
			const overrides: Doc[] = rest.map((x: N) => {
				const k = x.computed ? `[${this.noun(x.key).t}]` : mk("v", this.lex.humanize(x.key.name ?? String(x.key.value)), x.key.name ?? String(x.key.value));
				const v = x.shorthand ? D(this.ref(x.key.name)) : this.noun(x.value);
				return D(o.override({ key: k, value: v.t }), v.kids);
			});
			const joined = this.g.list(overrides.map((x) => x.t));
			if (vlen(joined) < 70 && overrides.every((x) => !x.kids.length)) return D(o.withOverrides({ base: base.t, overrides: joined }), base.kids);
			return D(`${o.withOverridesBlock({ base: base.t })}:`, [...base.kids, ...overrides.flatMap((x) => this.bullet(x))]);
		}
		const items: Doc[] = n.properties.flatMap((x: N): Doc[] => {
			if (x.type === "SpreadElement") {
				const cs = this.conditionalSpread(x.argument);
				if (cs) return cs;
				return [this.wrap(this.noun(x.argument), (t) => p.everythingIn({ value: t }))];
			}
			return [this.objectProp(x)];
		});
		return this.objectFromItems(items);
	}

	/** `...(cond ? { a } : {})` / `...(cond && { a })` -> each prop tagged with its condition. */
	conditionalSpread(arg: N): Doc[] | null {
		const u = unwrap(arg);
		let test: N | null = null;
		let obj: N | null = null;
		if (
			u.type === "ConditionalExpression" &&
			unwrap(u.consequent).type === "ObjectExpression" &&
			(isNullish(u.alternate) || (unwrap(u.alternate).type === "ObjectExpression" && !unwrap(u.alternate).properties.length))
		) {
			test = u.test;
			obj = unwrap(u.consequent);
		} else if (u.type === "LogicalExpression" && u.operator === "&&" && unwrap(u.right).type === "ObjectExpression") {
			test = u.left;
			obj = unwrap(u.right);
		}
		if (!test || !obj || obj.properties.some((p: N) => p.type === "SpreadElement")) return null;
		const c = this.cond(test);
		if (c.kids.length) return null;
		return obj.properties.map((p: N) => this.wrap(this.objectProp(p), (t) => this.say.expressions.onlyIf({ value: t, condition: c.t })));
	}

	objectProp(p: N): Doc {
		const x = this.say.expressions;
		const keyText = p.computed
			? `[${this.noun(p.key).t}]`
			: p.key.type === "Identifier"
				? mk("v", this.lex.humanize(p.key.name), p.key.name)
				: this.literal(p.key);
		if (p.shorthand && p.key.type === "Identifier") return D(this.ref(p.key.name));
		const key = p.computed ? null : p.key.type === "Identifier" ? p.key.name : typeof p.key.value === "string" ? p.key.value : null;
		const v0 = unwrap(p.value);
		if (key && v0?.type === "Identifier" && this.lex.humanize(v0.name) === this.lex.humanize(key)) return D(this.ref(v0.name));
		if (p.kind === "get") return D(x.object.getter({ key: keyText }));
		if (p.method || (isFn(p.value) && unwrap(p.value).body.type === "BlockStatement")) {
			const f = p.method ? p.value : unwrap(p.value);
			return D(`${x.object.method({ key: keyText, params: this.paramList(f.params) })}:`, this.body(f.body, 0));
		}
		const v = this.noun(p.value);
		return D(x.labeled({ key: keyText, value: v.t }), v.kids);
	}

	objectFromItems(items: Doc[]): Doc {
		const o = this.say.expressions.object;
		const joined = this.g.list(items.map((i) => i.t));
		if (items.length <= 3 && vlen(joined) < 70 && items.every((i) => !i.kids.length)) return D(o.with({ items: joined }));
		return D(
			`${o.withBlock}:`,
			items.flatMap((i) => this.bullet(i)),
		);
	}

	binaryNoun(n: N): Doc {
		const p = this.say.expressions;
		const op = n.operator;
		if (op === "??") {
			const l = this.noun(n.left);
			const r = this.noun(n.right);
			if (unwrap(n.right).type === "ArrayExpression" && !unwrap(n.right).elements.length) return l;
			const parts = { value: l.t, fallback: r.t };
			return D(r.kids.length ? p.fallbackBlock(parts) : p.fallback(parts), [...l.kids, ...r.kids]);
		}
		if (op === "||" && !this.looksBoolean(n)) {
			const l = this.noun(n.left);
			const r = this.noun(n.right);
			return D(p.orIfEmpty({ value: l.t, fallback: r.t }), [...l.kids, ...r.kids]);
		}
		if (op === "&&" && !this.looksBoolean(n.right)) {
			const c = this.cond(n.left);
			const r = this.noun(n.right);
			return D(p.onlyIf({ value: r.t, condition: c.t }), [...c.kids, ...r.kids]);
		}
		const opPhrase = Object.hasOwn(p.ops, op) ? p.ops[op as keyof ExpressionPhrases["ops"]] : undefined;
		if (opPhrase) {
			const folded = this.fold(n);
			if (folded !== null && /[*/]/.test(op))
				return D(p.folded({ value: mk("l", this.g.formatNumber(folded)), expression: this.code(n).replace(/\s+/g, " ") }));
			const operand = (x: N): Doc => {
				const u = unwrap(x);
				if (u.type !== "LogicalExpression" || u.operator !== "??") return this.noun(x);
				const a = this.noun(u.left);
				const b = this.noun(u.right);
				return D(p.fallbackInline({ value: a.t, fallback: b.t }), [...a.kids, ...b.kids]);
			};
			const l = operand(n.left);
			const r = operand(n.right);
			if (op === "+" && unwrap(n.left).type === "Literal" && typeof unwrap(n.left).value === "string")
				return D(p.concatText({ left: l.t, right: r.t }), [...l.kids, ...r.kids]);
			return D(opPhrase({ left: l.t, right: r.t }), [...l.kids, ...r.kids]);
		}
		if (/^(===|!==|==|!=|<|>|<=|>=|in|instanceof|&&|\|\|)$/.test(op)) return this.wrap(this.cond(n), (t) => p.whether({ condition: t }));
		return D(this.raw(n));
	}

	fold(n: N): number | null {
		const u = unwrap(n);
		if (u.type === "Literal" && typeof u.value === "number") return u.value;
		if (u.type !== "BinaryExpression") return null;
		const a = this.fold(u.left);
		const b = this.fold(u.right);
		if (a === null || b === null) return null;
		const r = ({ "+": a + b, "-": a - b, "*": a * b, "/": a / b } as Record<string, number>)[u.operator];
		return r === undefined || !Number.isFinite(r) ? null : r;
	}

	ternary(n: N): Doc {
		const t = this.say.expressions.ternary;
		const c = this.cond(n.test);
		const a = this.noun(n.consequent);
		const b = this.noun(n.alternate);
		if (isNullish(n.consequent) && !c.kids.length) return D(t.nothingIf({ condition: c.t, otherwise: b.t }), b.kids);
		const emptyish = (x: N) => {
			const u = unwrap(x);
			return isNullish(u) || (u.type === "ArrayExpression" && !u.elements.length) || (u.type === "ObjectExpression" && !u.properties.length);
		};
		if (emptyish(n.alternate) && !c.kids.length && a.kids.length) return D(t.otherwiseNote({ value: a.t, condition: c.t, otherwise: b.t }), a.kids);
		if (isNullish(n.alternate) && !c.kids.length) {
			if (a.kids.length) return D(t.onlyIfBlock({ value: a.t, condition: c.t }), a.kids);
			return D(t.otherwiseNothing({ value: a.t, condition: c.t }), a.kids);
		}
		const inline = t.inline({ value: a.t, condition: c.t, otherwise: b.t });
		const short = (x: N) => ["Literal", "Identifier", "TemplateLiteral"].includes(unwrap(x)?.type);
		if ((vlen(inline) <= 130 || (short(n.consequent) && short(n.alternate) && vlen(inline) <= 140)) && !c.kids.length && !a.kids.length && !b.kids.length)
			return D(inline);
		const kids: Line[] = [];
		kids.push(...this.bullet(D(t.ifSo({ value: a.t }), a.kids)));
		kids.push(...this.bullet(D(t.ifNot({ value: b.t }), b.kids)));
		if (c.kids.length) return D(t.depending({ condition: c.t }), [...c.kids, ...kids]);
		return D(`${t.depending({ condition: c.t })}:`, kids);
	}

	assign(n: N): Doc {
		const s = this.say.expressions.assign;
		const target = this.noun(n.left);
		const v = this.noun(n.right);
		const r = unwrap(n.right);
		const fname = r?.type === "CallExpression" ? calleeName(r) : null;
		if (n.operator === "=" && fname && this.lex.startsWithVerb(fname) && !this.lex.converterParts(fname) && !this.applyRulesQuiet(r)) {
			const call = this.call(r, true);
			return D(s.callInto({ call: call.t, target: target.t }), call.kids);
		}
		const parts = { target: target.t, value: v.t };
		switch (n.operator) {
			case "=":
				return D(s.set(parts), v.kids);
			case "+=":
				return D(s.add(parts), v.kids);
			case "-=":
				return D(s.subtract(parts), v.kids);
			case "*=":
				return D(s.multiply(parts), v.kids);
			case "??=":
				return D(s.setIfMissing(parts), v.kids);
			case "||=":
				return D(s.setIfEmpty(parts), v.kids);
			case "&&=":
				return D(s.replaceIfSet(parts), v.kids);
			default:
				return D(this.raw(n));
		}
	}

	jsx(n: N): Doc {
		const p = this.say.expressions;
		if (n.type === "JSXFragment") return this.jsxChildren(n.children, p.jsx.fragment);
		const name = this.code(n.openingElement.name);
		const tag = mk("f", `<${name}>`, name);
		const attrs: string[] = [];
		const attrKids: Line[] = [];
		for (const a of n.openingElement.attributes) {
			if (a.type === "JSXSpreadAttribute") {
				attrs.push(p.everythingIn({ value: this.noun(a.argument).t }));
				continue;
			}
			const key = typeof a.name.name === "string" ? a.name.name : this.code(a.name);
			if (/^(className|class|style|key|ref|data-.*|aria-.*|id|tabIndex|role|asChild)$/.test(key)) continue;
			const label = mk("v", this.lex.humanize(key.replace(/^on([A-Z])/, "on $1")), key);
			if (!a.value) {
				attrs.push(label);
				continue;
			}
			let v: Doc;
			if (a.value.type === "Literal") v = D(this.literal(a.value));
			else if (a.value.type === "JSXExpressionContainer") {
				const ex = unwrap(a.value.expression);
				if (isFn(ex)) {
					const body = this.lambdaExpr(ex);
					v = body ? (unwrap(body).type === "CallExpression" ? this.call(unwrap(body), true) : this.noun(body)) : D(p.jsx.steps, this.body(ex.body, 0));
				} else v = this.noun(ex);
			} else v = this.noun(a.value);
			if (v.kids.length) {
				attrKids.push(...this.bullet(D(p.labeled({ key: label, value: v.t }), v.kids)));
				continue;
			}
			attrs.push(plain(v.t) === this.lex.humanize(key) ? label : p.labeled({ key: label, value: v.t }));
		}
		const kids = this.jsxChildren(n.children, p.jsx.element({ tag, attrs }));
		return D(kids.t, [...attrKids, ...kids.kids]);
	}

	jsxChildren(children: N[], head: string): Doc {
		const x = this.say.expressions.jsx;
		const items: Doc[] = [];
		for (const c of children) {
			if (c.type === "JSXText") {
				const t = c.value.replace(/\s+/g, " ").trim();
				if (t) items.push(D(x.text({ text: mk("l", `"${t}"`) })));
				continue;
			}
			if (c.type === "JSXExpressionContainer") {
				const ex = unwrap(c.expression);
				if (!ex || ex.type === "JSXEmptyExpression") continue;
				if (ex.type === "LogicalExpression" && ex.operator === "&&") {
					const cnd = this.cond(ex.left);
					const r = this.noun(ex.right);
					items.push(D(x.onlyIf({ condition: cnd.t, value: r.t }), [...cnd.kids, ...r.kids]));
					continue;
				}
				items.push(this.noun(ex));
				continue;
			}
			items.push(this.noun(c));
		}
		if (!items.length) return D(head);
		if (items.length === 1 && !items[0]!.kids.length && vlen(items[0]!.t) < 60) return D(x.showing({ element: head, child: items[0]!.t }));
		return D(
			x.containing({ element: head }),
			items.flatMap((i) => this.bullet(i)),
		);
	}

	// ---------- lambdas ----------

	/** A lambda's single expression body, or null when it has real statements. */
	lambdaExpr(fn: N): N | null {
		if (fn.body.type !== "BlockStatement") return fn.body;
		const b = fn.body.body;
		if (b.length === 1 && b[0].type === "ReturnStatement") return b[0].argument;
		return null;
	}

	paramName(p: N): string | null {
		p = p?.type === "AssignmentPattern" ? p.left : p;
		return p?.type === "Identifier" ? p.name : null;
	}

	countUses(node: N, name: string): number {
		let c = 0;
		const walk = (x: N) => {
			if (!x || typeof x !== "object") return;
			if (Array.isArray(x)) return x.forEach(walk);
			if (x.type === "Identifier" && x.name === name) c++;
			if (x.type === "MemberExpression" && !x.computed) return walk(x.object);
			if (x.type === "Property" && !x.computed) return walk(x.value);
			for (const k in x) if (k !== "parent" && typeof x[k] === "object") walk(x[k]);
		};
		walk(node);
		return c;
	}

	/** Renders `body` with the lambda param read as e.g. "each price". */
	withAlias<T>(fn: N, alias: (p: string) => string, f: () => T): T {
		const p = this.paramName(fn.params[0]);
		if (!p) return f();
		const prev = this.aliases.get(p);
		this.aliases.set(p, alias(p));
		try {
			return f();
		} finally {
			if (prev === undefined) this.aliases.delete(p);
			else this.aliases.set(p, prev);
		}
	}

	paramLabel(fn: N): string {
		const p = fn.params[0];
		if (!p) return this.say.expressions.item;
		const name = this.paramName(p);
		if (name) return this.ref(name);
		return this.say.expressions.item;
	}

	/** A destructuring lambda's condition reads "whose …" unless it opens on a bare "it …" predicate. */
	readsWhose(fn: N, cond: Doc): boolean {
		return this.isDestructured(fn) && !plain(cond.t).startsWith(`${plain(this.say.conditions.it)} `);
	}

	isDestructured(fn: N) {
		return fn.params[0]?.type === "ObjectPattern";
	}

	lambdaNoun(n: N): Doc {
		const p = this.say.expressions;
		const ex = this.lambdaExpr(n);
		const params = this.paramList(n.params);
		if (ex) {
			const b = this.looksBoolean(ex) ? this.wrap(this.cond(ex), (t) => p.whether({ condition: t })) : this.noun(ex);
			return D(p.lambda.giving({ params, value: b.t }), b.kids);
		}
		return D(`${p.lambda.steps({ params })}:`, this.body(n.body, 0));
	}

	/** A function's parameter names as one rendered list, or null when none are worth naming. */
	paramList(params: N[]): string | null {
		const ps = params.flatMap((p: N) => this.patternNames(p)).filter((x) => x);
		return ps.length ? this.g.list(ps) : null;
	}

	givenText(params: N[]): string {
		const list = this.paramList(params);
		return list === null ? "" : this.say.expressions.lambda.params({ params: list });
	}

	patternNames(p: N, withTypes = false): string[] {
		const x = this.say.expressions.params;
		if (!p) return [];
		if (p.type === "TSParameterProperty") return this.patternNames(p.parameter, withTypes);
		if (p.type === "Identifier") {
			if (this.ambient.has(p.name)) return [];
			const t = withTypes ? this.varTypes.get(p.name) : undefined;
			const typeName = t?.startsWith("@") ? null : t;
			if (!typeName) return [this.ref(p.name)];
			const shown = isListType(p.typeAnnotation?.typeAnnotation) ? this.say.types.listOf({ item: typeName }) : typeName;
			return [x.typed({ name: this.ref(p.name), type: mk("t", shown, typeName) })];
		}
		if (p.type === "AssignmentPattern") {
			const inner = this.patternNames(p.left, withTypes);
			const def = unwrap(p.right);
			if (inner.length === 1 && def && !(def.type === "ObjectExpression" && !def.properties.length))
				return [x.withDefault({ name: inner[0]!, value: this.noun(def).t })];
			return inner;
		}
		if (p.type === "RestElement") return this.patternNames(p.argument).map((name) => x.rest({ name }));
		if (p.type === "ObjectPattern")
			return p.properties.flatMap((prop: N) => {
				if (prop.type === "RestElement") return this.patternNames(prop.argument).map((name) => x.restOf({ name }));
				const key = prop.key?.name;
				if (key && this.ambient.has(key)) return [];
				const v = prop.value;
				if (v?.type === "Identifier" && key && this.lex.humanize(v.name) !== this.lex.humanize(key))
					return [x.renamed({ key: mk("v", this.lex.humanize(key), key), local: this.ref(v.name) })];
				return this.patternNames(v, withTypes);
			});
		if (p.type === "ArrayPattern") return p.elements.filter(Boolean).flatMap((el: N) => this.patternNames(el));
		return [this.raw(p)];
	}

	// ---------- calls ----------

	ruleFor(table: Record<string, any[]>, n: N): { rule: any; obj: N | null }[] {
		const c = unwrap(n.callee);
		const pre = n.type === "NewExpression" ? "new " : "";
		const out: { rule: any; obj: N | null }[] = [];
		const add = (key: string, obj: N | null, from?: string) => {
			for (const rule of table[key] ?? [])
				if (from === undefined || (rule.lib && (from === rule.lib || from.startsWith(`${rule.lib}/`)))) out.push({ rule, obj });
		};
		const imported = this.importedKey(c);
		if (c.type === "Identifier") add(pre + c.name, null);
		else if (c.type === "CallExpression") {
			const inner = this.ruleKeyOf(unwrap(c.callee));
			if (inner) add(`${inner}()`, null);
			const via = this.importedKey(unwrap(c.callee));
			if (via) add(`${via.key}()`, null, via.from);
		} else if (c.type === "MemberExpression" && !c.computed) {
			const obj = unwrap(c.object);
			const m = c.property.name;
			if (obj.type === "Identifier") {
				add(`${pre}${obj.name}.${m}`, obj);
				if (imported) add(pre + imported.key, imported.key.includes(".") ? obj : null, imported.from);
				add(`${pre}${obj.name}.*`, obj);
			}
			if (obj.type === "MemberExpression" && !obj.computed) add(`*.${obj.property.name}.${m}`, obj);
			add(`*.${m}`, c.object);
		}
		if (imported && c.type === "Identifier") add(pre + imported.key, null, imported.from);
		return out;
	}

	/** The key a callee has in its library when imported under another name: `plus` (`import { addDays as plus }`) -> `addDays`,
	 * `dfn.addDays` (`import * as dfn`) -> `addDays`, `zod.object` (`import { z as zod }`) -> `z.object`. */
	importedKey(c: N): { key: string; from: string } | null {
		if (c?.type === "Identifier") {
			const info = this.imports.get(c.name);
			return info && info.name !== "*" && info.name !== "default" && info.name !== c.name ? { key: info.name, from: info.from } : null;
		}
		if (c?.type !== "MemberExpression" || c.computed || unwrap(c.object)?.type !== "Identifier") return null;
		const local = unwrap(c.object).name;
		const info = this.imports.get(local);
		if (!info || info.name === local) return null;
		const key = info.name === "*" || info.name === "default" ? c.property.name : `${info.name}.${c.property.name}`;
		return { key, from: info.from };
	}

	/** Plugin member rules: keys `Obj.prop`, `*.owner.prop`, `*.prop`, then families `Obj.*` and `*.owner.*`; most specific first. */
	memberRule(n: N): Doc | null {
		if (n.computed || n.property?.type !== "Identifier") return null;
		const obj = unwrap(n.object);
		const prop = n.property.name;
		const keys = [
			obj.type === "Identifier" ? `${obj.name}.${prop}` : null,
			obj.type === "MemberExpression" && !obj.computed ? `*.${obj.property.name}.${prop}` : null,
			`*.${prop}`,
			obj.type === "Identifier" ? `${obj.name}.*` : null,
			obj.type === "MemberExpression" && !obj.computed ? `*.${obj.property.name}.*` : null,
		];
		for (const key of keys)
			for (const rule of key ? (this.members[key] ?? []) : []) {
				const r = rule({ node: n, obj: n.object, prop, e: this });
				if (r) return asDoc(r);
			}
		return null;
	}

	/** `Effect.fn` -> "Effect.fn", `x.y.z` -> "*.z": the key a curried call's inner callee is matched by. */
	ruleKeyOf(c: N): string | null {
		if (c.type === "Identifier") return c.name;
		if (c.type !== "MemberExpression" || c.computed) return null;
		const obj = unwrap(c.object);
		return obj.type === "Identifier" ? `${obj.name}.${c.property.name}` : `*.${c.property.name}`;
	}

	/** Whether a rule registered under exactly `key` (not a wildcard) claims this call. */
	claimsExactly(key: string, n: N): boolean {
		const rules = this.calls[key];
		if (!rules) return false;
		const saved = { ...this.stats, fallbackTypes: { ...this.stats.fallbackTypes } };
		const usedComments = new Set(this.usedComments);
		const lineCount = this.lines.length;
		this.orphanFrames.push([]);
		try {
			const c = unwrap(n.callee);
			const obj = c.type === "MemberExpression" ? c.object : null;
			return rules.some((rule) => !!rule({ node: n, args: n.arguments, obj, e: this, stmt: false }));
		} finally {
			this.orphanFrames.pop();
			this.stats = saved;
			this.usedComments = usedComments;
			this.lines.length = lineCount;
		}
	}

	/** Whether a dialect rule claims this call (without counting it as rendered). */
	applyRulesQuiet(n: N): boolean {
		const saved = { ...this.stats, fallbackTypes: { ...this.stats.fallbackTypes } };
		const r = this.applyRules(this.calls, n, { stmt: false });
		this.stats = saved;
		return !!r;
	}

	orphanFrames: Line[][] = [];

	/** Inline text of a node for dialect rules; its block lines are re-attached to the rule's result. */
	text(node: N): string {
		const d = this.noun(node);
		if (d.kids.length) this.orphanFrames.at(-1)?.push(...d.kids);
		return d.t;
	}

	applyRules<T>(table: Record<string, any[]>, n: N, extra: Record<string, unknown>): Doc | null {
		for (const { rule, obj } of this.ruleFor(table, n)) {
			this.orphanFrames.push([]);
			let r: Doc | null = null;
			try {
				const out = rule({ node: n, args: n.arguments, obj, e: this, ...extra });
				r = out ? asDoc(out) : null;
			} finally {
				const orphans = this.orphanFrames.pop()!;
				if (r && orphans.length) {
					const missing = orphans.filter((o) => !r!.kids.includes(o));
					if (missing.length) r = D(r.t, [...r.kids, ...missing]);
				}
			}
			if (r) return r;
		}
		return null;
	}

	call(n: N, stmt: boolean): Doc {
		const ruled = this.applyRules(this.calls, n, { stmt });
		if (ruled) return ruled;
		const c = unwrap(n.callee);
		if (c.type === "Identifier") return this.namedCall(c.name, n.arguments, stmt, null);
		if (c.type === "MemberExpression" && !c.computed) {
			const obj = unwrap(c.object);
			if (obj.type === "Identifier" && /^[A-Z]/.test(obj.name) && !this.ambient.has(obj.name))
				return this.namedCall(c.property.name, n.arguments, stmt, obj.name);
			return this.methodCall(c.object, c.property.name, n.arguments, stmt);
		}
		if (c.type === "Super") {
			const a = this.argList(n.arguments);
			return D(this.say.calls.superCall({ args: a.t }), a.kids);
		}
		const callee = this.noun(c);
		const a = this.argList(n.arguments);
		return D((stmt ? this.say.calls.callAction : this.say.calls.callValue)({ callee: callee.t, args: a.t }), [...callee.kids, ...a.kids]);
	}

	/** `cusProductToPrices({ cusProduct })` -> "the prices of customer product". */
	namedCall(name: string, args: N[], stmt: boolean, owner: string | null): Doc {
		const c = this.say.calls;
		const conv = this.lex.converterParts(name);
		const via = owner ? mk("c", `[${owner}]`) : "";
		if (conv) {
			const [from, to] = conv;
			const fromKey = from.join(" ");
			const pairs = this.argPairs(args);
			let subjectIdx = pairs.findIndex((p) => p.key && this.lex.words(p.key).join(" ") === fromKey);
			if (subjectIdx < 0) subjectIdx = pairs.findIndex((p) => p.key && fromKey.endsWith(this.lex.words(p.key).join(" ")));
			if (subjectIdx < 0 && pairs.length === 1) subjectIdx = 0;
			if (subjectIdx < 0) subjectIdx = pairs.findIndex((p) => !p.key);
			const target = this.fnRef(name, this.lex.display(to));
			if (subjectIdx >= 0) {
				const subj = pairs[subjectIdx]!;
				const rest =
					args.length && unwrap(args[0]).type === "ObjectExpression"
						? this.argItems(args, new Set([subj.key!]))
						: this.argItems(args.filter((a) => unwrap(a) !== subj.node));
				const given = rest.items.length && rest.inline ? rest.joined : null;
				return D(c.convert({ target, subject: subj.text.t, owner: via, given }), [
					...subj.text.kids,
					...(given === null ? rest.items.flatMap((i) => this.bullet(i)) : []),
				]);
			}
			const a = this.argList(args);
			return D(c.convertArgs({ target, source: this.fnRef(name, this.lex.display(from)), owner: via, args: a.t }), a.kids);
		}
		if (this.lex.isPredicateName(name))
			return this.wrap(this.predicateCall(name, args, false, owner), (t) =>
				stmt ? c.checkWhether({ condition: t }) : this.say.expressions.whether({ condition: t }),
			);
		const words = this.lex.humanize(name);
		const fn = this.fnRef(name, words);
		const a = this.argList(args);
		const parts = { fn, owner: via, args: a.t };
		if (stmt && name === "main") return D(c.run(parts), a.kids);
		if (this.isActionName(name)) return D(c.action(parts), a.kids);
		if (stmt && this.lex.words(name)[0] === "on") return D(c.trigger(parts), a.kids);
		if (stmt && this.lex.words(name).length > 1) return D(c.action(parts), a.kids);
		if (stmt) return D(c.run(parts), a.kids);
		const lastWord = words.split(" ").at(-1)!;
		if (/^(of|for|from|by|in|on|at)$/.test(lastWord)) {
			const inner = this.argPairs(args).map((p) => p.text.t);
			return D(c.prepositional({ fn, args: this.g.list(inner), owner: via }));
		}
		if (/^[A-Z]/.test(name) || this.lex.words(name).length === 1) return D(c.resultOf(parts), a.kids);
		return D(c.noun({ ...parts, words, plural: this.g.isPlural(lastWord) }), a.kids);
	}

	methodCall(objNode: N, method: string, args: N[], stmt: boolean): Doc {
		const c = this.say.calls;
		const obj = this.noun(objNode);
		const a = this.argList(args);
		const object = this.isAmbient(objNode) ? null : obj.t;
		const kids = [...obj.kids, ...a.kids];
		const verbObject = unwrap(objNode)?.type === "ThisExpression" ? null : object;
		if (this.lex.isPredicateName(method))
			return D(c.methodPredicate({ object, predicate: this.predicatePhrase(method, false), args: a.t, action: stmt }), kids);
		const w = this.lex.words(method);
		const verb = mk("f", this.lex.display(w.slice(0, 1)), "");
		const rest = w.length > 1 ? mk("f", this.lex.display(w.slice(1)), "") : null;
		if (this.lex.startsWithVerb(method)) return D(c.methodVerb({ verb, object: verbObject, rest, args: a.t }), kids);
		if (stmt && w.length > 1 && w[0] !== "on") return D(c.methodVerb({ verb, object: verbObject, rest, args: a.t }), kids);
		const phrase = stmt ? (w[0] === "on" ? c.methodTrigger : c.methodRun) : c.method;
		return D(phrase({ object, method: mk("f", this.lex.humanize(method), ""), args: a.t }), kids);
	}

	newExpr(n: N): Doc {
		const ruled = this.applyRules(this.calls, n, { stmt: false });
		if (ruled) return ruled;
		const name = unwrap(n.callee).type === "Identifier" ? unwrap(n.callee).name : null;
		if (name && this.isErrorCtor(name)) return this.errorDoc(n);
		const callee = name ? this.fnRef(name, this.lex.humanize(name)) : this.noun(n.callee).t;
		const a = this.argList(n.arguments);
		return D(this.say.calls.newInstance({ ctor: callee, args: a.t }), a.kids);
	}

	errorDoc(n: N): Doc {
		const er = this.say.expressions.errors;
		const name = unwrap(n.callee).name as string;
		const words = this.lex.humanize(name);
		const label = this.errorLabels[name] ? this.fnRef(name, this.errorLabels[name]) : name === "Error" ? er.generic : this.fnRef(name, er.label({ words }));
		const first = unwrap(n.arguments[0]);
		let msg: Doc | null = null;
		let code: string | null = null;
		let status: string | null = null;
		if (first?.type === "ObjectExpression") {
			const mp = first.properties.find((p: N) => p.key?.name === "message");
			if (mp) msg = this.noun(mp.value);
			const cp = first.properties.find((p: N) => p.key?.name === "code");
			if (cp) code = this.noun(cp.value).t;
			const sc = first.properties.find((p: N) => p.key?.name === "statusCode");
			if (sc) status = this.noun(sc.value).t;
		} else if (first) msg = this.noun(first);
		const message = msg?.t ?? null;
		if (name === "Error") return D(er.describe({ label: er.generic, message, code: null, status: null }), msg?.kids ?? []);
		return D(er.describe({ label, message, code, status }), msg?.kids ?? []);
	}

	predicateCall(name: string, args: N[], neg: boolean, owner: string | null): Doc {
		const pairs = this.argPairs(args);
		const nameWords = this.lex.words(name);
		let si = pairs.findIndex((p) => {
			const k = p.key ?? (unwrap(p.node).type === "Identifier" ? unwrap(p.node).name : null);
			if (!k) return false;
			const kw = this.lex.words(k).join(" ");
			return nameWords.join(" ").endsWith(kw) || nameWords.slice(1).join(" ").includes(kw);
		});
		if (si < 0 && pairs.length) si = 0;
		const subj = si >= 0 ? pairs[si]! : null;
		let words = nameWords;
		if (subj) {
			const k = subj.key ?? (unwrap(subj.node).type === "Identifier" ? unwrap(subj.node).name : null);
			if (k) {
				const kw = this.lex.words(k);
				const tail = words.slice(-kw.length).join(" ");
				if (tail === kw.join(" ") && words.length - kw.length >= 2) words = words.slice(0, -kw.length);
			}
		}
		const head = words[0]!;
		const phrase = this.predicatePhrase(
			head +
				words
					.slice(1)
					.map((w) => w[0]!.toUpperCase() + w.slice(1))
					.join(""),
			neg,
		);
		const rest = pairs.filter((_, i) => i !== si);
		const given = rest.length
			? this.g.list(
					rest.map((r) =>
						r.key && plain(r.text.t) !== this.lex.humanize(r.key)
							? this.say.expressions.labeled({ key: mk("v", this.lex.humanize(r.key), r.key), value: r.text.t })
							: r.text.t,
					),
				)
			: null;
		const via = owner ? mk("c", `[${owner}]`) : "";
		return D(this.say.calls.predicate({ subject: subj ? subj.text.t : null, predicate: this.fnRef(name, phrase), owner: via, given }), [
			...(subj?.text.kids ?? []),
			...rest.flatMap((r) => r.text.kids),
		]);
	}

	// ---------- conditions ----------

	cond(node: N, neg = false): Doc {
		const k = this.say.conditions;
		const n = unwrap(node);
		if (!n) return D(k.bool({ value: !neg }));
		if (n.type === "UnaryExpression" && n.operator === "!") return this.cond(n.argument, !neg);
		if (n.type === "ConditionalExpression") {
			const t = this.cond(n.test);
			const a = this.cond(n.consequent, neg);
			if (isNullish(n.alternate)) return D(k.onlyCheckedWhen({ condition: a.t, when: t.t }), [...t.kids, ...a.kids]);
			const b = this.cond(n.alternate, neg);
			return D(k.ifElse({ test: t.t, then: a.t, otherwise: b.t }), [...t.kids, ...a.kids, ...b.kids]);
		}
		if (n.type === "LogicalExpression" && (n.operator === "&&" || n.operator === "||")) return this.logical(n, neg);
		if (n.type === "BinaryExpression") {
			const r = this.compare(n, neg);
			if (r) return r;
		}
		if (n.type === "CallExpression") {
			const ruled = this.applyRules(this.conds, n, { neg });
			if (ruled) return ruled;
			const c = unwrap(n.callee);
			if (c.type === "Identifier" && this.lex.isPredicateName(c.name)) return this.predicateCall(c.name, n.arguments, neg, null);
			if (c.type === "Identifier") {
				const w = this.lex.words(c.name);
				const vi = w.findIndex(
					(x, i) => i > 0 && /^(is|has|have|can|should|was|matches|needs|contains|includes|uses|owns|allows|supports|requires|exceeds)$/.test(x),
				);
				if (vi > 0) {
					const subject = w.slice(0, vi).join(" ");
					const pairs = this.argPairs(n.arguments);
					const rest = pairs.filter((p) => plain(p.text.t) !== this.lex.humanize(subject) && this.lex.words(p.key ?? "").join(" ") !== subject);
					const verb = this.predicatePhrase(
						w
							.slice(vi)
							.map((x, i) => (i ? x[0]!.toUpperCase() + x.slice(1) : x))
							.join(""),
						neg,
					);
					return D(
						this.say.calls.predicate({
							subject: this.lex.display(w.slice(0, vi)),
							predicate: this.fnRef(c.name, verb),
							owner: "",
							given: rest.length ? this.g.list(rest.map((r) => r.text.t)) : null,
						}),
					);
				}
			}
			if (c.type === "MemberExpression" && !c.computed && this.lex.isPredicateName(c.property.name)) {
				const obj = unwrap(c.object);
				if (obj.type === "Identifier" && /^[A-Z]/.test(obj.name)) return this.predicateCall(c.property.name, n.arguments, neg, obj.name);
				const o = this.noun(c.object);
				const a = this.argList(n.arguments);
				return D(
					k.methodPredicate({
						object: this.isAmbient(c.object) ? null : o.t,
						predicate: this.fnRef(c.property.name, this.predicatePhrase(c.property.name, neg)),
						args: a.t,
					}),
					[...o.kids, ...a.kids],
				);
			}
			const call = this.call(n, false);
			return D(k.fromCall({ call: call.t, neg }), call.kids);
		}
		if (n.type === "Identifier") {
			if (this.isBoolName(n.name)) {
				const aux = /^(is|has|have|can|should|was|were|did|does|will|needs|must|are|had)$/.test(this.lex.words(n.name)[0]!);
				if (this.lex.isPredicateName(n.name) && aux) {
					const alias = this.aliases.get(n.name);
					return D(alias ?? k.subjectPredicate({ subject: k.it, predicate: mk("v", this.predicatePhrase(n.name, neg), n.name) }));
				}
				return D(k.flag({ subject: this.ref(n.name), neg }));
			}
			if (this.lex.isFlagName(n.name)) return D(k.flag({ subject: this.ref(n.name), neg }));
			return D(k.isSet({ subject: this.ref(n.name), neg }));
		}
		if (n.type === "MemberExpression") {
			const { root, steps } = this.chain(n);
			const last = steps.at(-1)!;
			if (last.name === "length") {
				const inner = this.memberFrom(root, steps.slice(0, -1));
				return D(k.isEmpty({ subject: inner.t, neg: !neg }), inner.kids);
			}
			if (last.name && this.lex.isPredicateName(last.name)) {
				const inner = steps.length > 1 || !this.isAmbient(root) ? this.memberFrom(root, steps.slice(0, -1)) : D(k.it);
				return D(k.subjectPredicate({ subject: inner.t, predicate: mk("v", this.predicatePhrase(last.name, neg), last.name) }), inner.kids);
			}
			const m = this.member(n);
			if (last.name && (this.bools.has(last.name) || this.lex.isFlagName(last.name))) return D(k.flag({ subject: m.t, neg }), m.kids);
			return D(k.isSet({ subject: m.t, neg }), m.kids);
		}
		if (n.type === "Literal" && typeof n.value === "boolean") return D(k.bool({ value: n.value !== neg }));
		if (n.type === "MetaProperty" && n.meta?.name === "new") return D(k.calledWithNew({ neg }));
		if (n.type === "AssignmentExpression") {
			const a = this.assign(n);
			return D(k.afterAssign({ action: a.t, neg }), a.kids);
		}
		const v = this.noun(n);
		return D(k.isSet({ subject: v.t, neg }), v.kids);
	}

	logical(n: N, neg: boolean): Doc {
		const op = n.operator;
		const flat: N[] = [];
		const collect = (x: N) => {
			const u = unwrap(x);
			if (u.type === "LogicalExpression" && u.operator === op) {
				collect(u.left);
				collect(u.right);
			} else flat.push(u);
		};
		collect(n);
		const isAnd = (op === "&&") !== neg;
		const items = flat.map((x) => this.cond(x, neg));
		const nested = flat.some((x) => {
			let u = unwrap(x);
			while (u.type === "UnaryExpression" && u.operator === "!") u = unwrap(u.argument);
			return u.type === "LogicalExpression" && u.operator !== "??";
		});
		const joined = this.g.list(
			items.map((i) => i.t),
			isAnd ? "and" : "or",
		);
		if (!nested && items.length <= 3 && vlen(joined) <= 95 && items.every((i) => !i.kids.length)) return D(joined);
		return D(
			`${isAnd ? this.say.conditions.allOf : this.say.conditions.anyOf}:`,
			items.flatMap((i) => this.bullet(i)),
		);
	}

	compare(n: N, neg: boolean): Doc | null {
		const k = this.say.conditions;
		let op: string = n.operator;
		let L = unwrap(n.left);
		let R = unwrap(n.right);
		if (isNullish(L) && !isNullish(R)) [L, R] = [R, L];
		const eqOps: Record<string, string> = { "===": "==", "==": "==", "!==": "!=", "!=": "!=" };
		if (eqOps[op]) {
			let eq = eqOps[op] === "==";
			if (neg) eq = !eq;
			if (isNullish(R)) return this.wrap(this.noun(L), (t) => k.isSet({ subject: t, neg: eq }));
			if (L.type === "UnaryExpression" && L.operator === "typeof" && R.type === "Literal")
				return this.wrap(this.noun(L.argument), (t) => k.isType({ subject: t, type: k.typeofNames[R.value] ?? String(R.value), neg: !eq }));
			if (L.type === "MemberExpression" && !L.computed && L.property.name === "length" && R.type === "Literal" && R.value === 0) {
				const inner = this.noun(L.object);
				return D(k.isEmpty({ subject: inner.t, neg: !eq }), inner.kids);
			}
			if (R.type === "Literal" && typeof R.value === "boolean") {
				const isFalse = eq ? !R.value : R.value;
				if (this.looksBoolean(L)) return this.cond(L, isFalse);
				return this.wrap(this.noun(L), (t) => k.flag({ subject: t, neg: isFalse }));
			}
			if (this.looksBoolean(L) && this.looksBoolean(R)) {
				const lc = this.cond(L);
				const rc = this.cond(R);
				return D(k.sameAs({ left: lc.t, right: rc.t, neg: !eq }), [...lc.kids, ...rc.kids]);
			}
			const l = this.noun(L);
			const r = this.noun(R);
			return D(k.equals({ left: l.t, right: r.t, neg: !eq }), [...l.kids, ...r.kids]);
		}
		const flipped: Record<string, RelOp> = { "<": ">=", ">": "<=", "<=": ">", ">=": "<" };
		if (flipped[op]) {
			if (neg) op = flipped[op]!;
			const rel = op as RelOp;
			if (L.type === "MemberExpression" && !L.computed && L.property.name === "length" && R.type === "Literal") {
				const inner = this.noun(L.object);
				if ((rel === ">" && R.value === 0) || (rel === ">=" && R.value === 1)) return D(k.isEmpty({ subject: inner.t, neg: true }), inner.kids);
				if ((rel === "<" && R.value === 1) || (rel === "<=" && R.value === 0)) return D(k.isEmpty({ subject: inner.t, neg: false }), inner.kids);
				return D(k.countCompare[rel]({ subject: inner.t, count: R.value }), inner.kids);
			}
			const l = this.noun(L);
			const r = this.noun(R);
			// A difference of two moments (or its absolute value) is a duration, not a moment.
			const isSpan = (x: N) => (x.type === "BinaryExpression" && x.operator === "-") || (x.type === "CallExpression" && this.code(x.callee) === "Math.abs");
			const time = !isSpan(L) && !isSpan(R) && (this.g.isTimeLike(plain(l.t)) || this.g.isTimeLike(plain(r.t)));
			if (!time && R.type === "Literal" && R.value === 0) return D(k.sign[rel]({ subject: l.t }), l.kids);
			return D(k.compare[rel]({ left: l.t, right: r.t, time }), [...l.kids, ...r.kids]);
		}
		if (op === "instanceof") {
			const l = this.noun(L);
			const name = R.type === "Identifier" ? R.name : this.code(R);
			const typeWords = this.lex.humanize(name);
			return D(k.instanceOf({ subject: l.t, type: this.fnRef(name, typeWords), typeWords, neg }), l.kids);
		}
		if (op === "in") {
			const key = this.noun(L);
			const o = this.noun(R);
			return D(k.hasKey({ object: o.t, key: key.t, neg }), [...key.kids, ...o.kids]);
		}
		return null;
	}

	// ---------- statements ----------

	lines: Line[] = [];

	emit(d: number, text: string, n: N | null, kind: LineKind = "stmt") {
		this.lines.push({ d, text, start: n?.start ?? -1, end: n?.end ?? -1, kind });
	}

	/** Emits a declaration heading and remembers its short `title` for unit names. */
	emitHead(d: number, text: string, title: string, n: N) {
		this.headTitles.set(`${text}:`, title);
		this.emit(d, `${text}:`, n, "head");
	}

	emitDoc(d: number, doc: Doc, n: N | null, end = ".", kind: LineKind = "stmt") {
		const t = doc.t.endsWith(":") ? doc.t : doc.t + (doc.kids.length ? ":" : end);
		this.emit(d, capFirst(t), n, kind);
		for (const k of doc.kids)
			this.lines.push({ ...k, d: k.d + d + 1, start: k.start < 0 ? (n?.start ?? -1) : k.start, end: k.end < 0 ? (n?.end ?? -1) : k.end });
	}

	/** Renders statements into a detached Line[] at relative depth `d`. */
	body(n: N, d: number): Line[] {
		const saved = this.lines;
		this.lines = [];
		try {
			const stmts = n.type === "BlockStatement" ? n.body : [n];
			for (const s of stmts) this.stmt(s, d);
			return this.lines;
		} finally {
			this.lines = saved;
		}
	}

	block(n: N, d: number) {
		if (!n) return;
		const stmts = n.type === "BlockStatement" ? n.body : [n];
		if (!stmts.length) this.emit(d, `${this.say.statements.doNothing}.`, n, "note");
		for (const s of stmts) this.stmt(s, d);
	}

	leadingComments(n: N, d: number) {
		let i = this.comments.findLastIndex((c) => c.end <= n.start);
		if (i < 0 || this.usedComments.has(i) || !/^\s*$/.test(this.src.slice(this.comments[i]!.end, n.start))) return;
		const group = [i];
		while (
			i > 0 &&
			!this.usedComments.has(i - 1) &&
			/^\s*$/.test(this.src.slice(this.comments[i - 1]!.end, this.comments[i]!.start)) &&
			!/\n\s*\n/.test(this.src.slice(this.comments[i - 1]!.end, this.comments[i]!.start))
		)
			group.unshift(--i);
		for (const g of group) this.usedComments.add(g);
		const text = group
			.map((g) => this.comments[g]!.value)
			.join("\n")
			.split("\n")
			.map((l) => l.replace(/^\s*\*+\s?/, "").trim())
			.filter((l) => l && !l.startsWith("@") && !/^(biome-ignore|eslint|prettier|ts-|@ts-)/.test(l) && !/^[-=*#]{3,}$/.test(l))
			.join(" ")
			.trim();
		if (text.length < 3) return;
		const c0 = this.comments[group[0]!]!;
		this.lines.push({ d, text: this.say.statements.comment({ text }), start: c0.start, end: this.comments[group.at(-1)!]!.end, kind: "note" });
	}

	stmt(n: N, d: number): void {
		const s = this.say.statements;
		const dc = this.say.declarations;
		this.leadingComments(n, d);
		for (const r of this.stmtRules) if (r({ node: n, e: this, d })) return;
		switch (n.type) {
			case "ExportNamedDeclaration":
				if (n.declaration) return this.stmt(n.declaration, d);
				return;
			case "ExportDefaultDeclaration": {
				const decl = n.declaration;
				if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") return this.stmt(decl, d);
				if (isFn(decl)) return this.fnDecl(decl.id?.name ?? dc.names.defaultExport, decl, n, d);
				return this.emitDoc(
					d,
					this.wrap(this.noun(decl), (t) => s.exportDefault({ value: t })),
					n,
				);
			}
			case "ExportAllDeclaration":
			case "ImportDeclaration":
			case "TSImportEqualsDeclaration":
			case "EmptyStatement":
			case "DebuggerStatement":
			case "TSDeclareFunction":
			case "TSModuleDeclaration":
				return;
			case "TSTypeAliasDeclaration":
				return this.emit(d, `${dc.type({ name: mk("t", n.id.name, n.id.name), shape: this.typeText(n.typeAnnotation, true) })}.`, n, "note");
			case "TSInterfaceDeclaration":
				return this.emit(d, `${dc.type({ name: mk("t", n.id.name, n.id.name), shape: this.typeMembers(n.body.body) })}.`, n, "note");
			case "TSEnumDeclaration": {
				const members = (n.body?.members ?? n.members ?? []).map((m: N) => m.id.name ?? m.id.value);
				return this.emit(d, `${dc.enum({ name: mk("f", n.id.name, n.id.name), members: this.g.list(members) })}.`, n, "note");
			}
			case "FunctionDeclaration":
				return this.fnDecl(n.id?.name ?? dc.names.anonymous, n, n, d);
			case "ClassDeclaration":
				return this.classDecl(n, d);
			case "VariableDeclaration":
				for (const v of n.declarations) this.declarator(v, n.kind, d, n.declarations.length === 1 ? n : v);
				return;
			case "ExpressionStatement":
				return this.exprStmt(n.expression, d, n);
			case "IfStatement":
				return this.ifStmt(n, d);
			case "ReturnStatement":
				return this.returnStmt(n, d);
			case "ThrowStatement":
				return this.throwStmt(n, d);
			case "ForOfStatement":
				return this.forOf(n, d);
			case "ForInStatement": {
				const v = this.patternNames(n.left.declarations?.[0]?.id ?? n.left);
				const o = this.noun(n.right);
				const label = s.loopItem.key({ key: this.g.list(v), value: null });
				this.emitDoc(d, D(`${s.forOf({ label, collection: o.t, async: false })}:`, o.kids), n);
				return this.block(n.body, d + 1);
			}
			case "ForStatement":
				return this.forStmt(n, d);
			case "WhileStatement": {
				const u = unwrap(n.test);
				if (u.type === "Literal" && u.value === true) this.emit(d, `${s.loopForever}:`, n);
				else {
					const c = this.cond(n.test);
					this.emitDoc(d, D(c.kids.length ? `${s.whileBlock}:` : `${s.while({ condition: c.t })}:`, c.kids), n);
				}
				return this.block(n.body, d + 1);
			}
			case "DoWhileStatement": {
				const c = this.cond(n.test);
				this.emit(d, `${s.doOnce}:`, n);
				this.block(n.body, d + 1);
				return this.emitDoc(d, D(s.doWhileTail({ condition: c.t }), c.kids), n.test);
			}
			case "TryStatement":
				return this.tryStmt(n, d);
			case "SwitchStatement":
				return this.switchStmt(n, d);
			case "BlockStatement":
				return this.block(n, d);
			case "LabeledStatement":
				return this.stmt(n.body, d);
			case "ContinueStatement":
				return this.emit(d, `${s.continue}.`, n);
			case "BreakStatement":
				return this.emit(d, `${s.break}.`, n);
			default:
				return this.emit(d, `${this.raw(n)}`, n, "raw");
		}
	}

	exprStmt(expr: N, d: number, n: N): void {
		const s = this.say.statements;
		const u = unwrap(expr);
		if (u.type === "CallExpression") {
			const name = calleeName(u);
			const c = unwrap(u.callee);
			if (name === "forEach" && c.type === "MemberExpression" && isFn(u.arguments[0])) {
				const fn = unwrap(u.arguments[0]);
				const coll = this.noun(c.object);
				const label = s.loopItem.each({ item: this.g.list(fn.params.slice(0, 1).flatMap((p: N) => this.patternNames(p))) });
				this.emitDoc(d, D(`${s.forOf({ label, collection: coll.t, async: false })}:`, coll.kids), n);
				const ex = fn.body.type === "BlockStatement" ? null : fn.body;
				if (ex) return this.exprStmt(ex, d + 1, ex);
				return this.block(fn.body, d + 1);
			}
			return this.emitDoc(d, this.call(u, true), n);
		}
		if (u.type === "TaggedTemplateExpression" && this.isBunShell(u))
			return this.emitDoc(
				d,
				this.wrap(this.template(u.quasi), (t) => this.say.expressions.shell({ command: t, stmt: true })),
				n,
			);
		if (u.type === "NewExpression") {
			const ruled = this.applyRules(this.calls, u, { stmt: true });
			if (ruled) return this.emitDoc(d, ruled, n);
		}
		if (u.type === "AssignmentExpression") return this.emitDoc(d, this.assign(u), n);
		if (u.type === "UpdateExpression") return this.emitDoc(d, this.noun(u), n);
		if (u.type === "LogicalExpression" && u.operator === "&&") {
			const c = this.cond(u.left);
			const r = unwrap(u.right).type === "CallExpression" ? this.call(unwrap(u.right), true) : this.noun(u.right);
			return this.emitDoc(d, D(s.ifThen({ condition: c.t, action: r.t }), [...c.kids, ...r.kids]), n);
		}
		if (u.type === "Literal" && typeof u.value === "string") return;
		if (u.type === "UnaryExpression" && u.operator === "void" && unwrap(u.argument)?.type === "CallExpression") {
			const call = this.call(unwrap(u.argument), true);
			return this.emitDoc(
				d,
				this.wrap(call, (t) => s.startWithoutWaiting({ action: t })),
				n,
			);
		}
		if (unwrapsAwait(expr) && (u.type === "Identifier" || u.type === "MemberExpression"))
			return this.emitDoc(
				d,
				this.wrap(this.noun(u), (t) => s.waitFor({ value: t })),
				n,
			);
		return this.emitDoc(d, this.noun(u), n);
	}

	declarator(v: N, kind: string, d: number, n: N) {
		const dc = this.say.declarations;
		const init = v.init ? unwrap(v.init) : null;
		const id = v.id;
		if (init && isFn(init) && id.type === "Identifier") return this.fnDecl(id.name, init, n, d);
		if (init?.type === "ClassExpression" && id.type === "Identifier") return this.classDecl({ ...init, id }, d);
		if (id.type === "Identifier") {
			const ann = typeRefName(id.typeAnnotation?.typeAnnotation, (x) => this.code(x));
			if (ann) this.varTypes.set(id.name, ann);
			else if (init?.type === "CallExpression" && this.typeOfCall) {
				const fname = calleeName(init);
				const t = fname ? this.typeOfCall(fname) : null;
				if (t) this.varTypes.set(id.name, t);
			}
			const name = this.ref(id.name);
			if (!init) return this.emit(d, `${dc.uninitialized({ name })}.`, n);
			if (kind === "let" && isBoolLit(init)) {
				this.bools.add(id.name);
				return this.emit(d, `${capFirst(dc.letStart({ name, value: this.literal(init) }))}.`, n);
			}
			if (this.looksBoolean(init) || (init.type === "LogicalExpression" && this.isBoolName(id.name))) {
				this.bools.add(id.name);
				const c = this.cond(init);
				return this.emitDoc(d, D(dc.letMean({ name, condition: c.t }), c.kids), n);
			}
			if (init.type === "CallExpression") {
				const fname = calleeName(init);
				const verbal = fname && this.isActionName(fname) && !this.lex.converterParts(fname) && !this.applyRulesQuiet(init);
				if (verbal) {
					const call = this.call(init, true);
					const { text, colon } = colonSplit(call.t);
					const phrase = this.namesItsResult(fname, id.name) ? dc.callInto : dc.callAs;
					return this.emitDoc(d, D(`${phrase({ call: text, name })}${colon}`, call.kids), n);
				}
			}
			const val = this.noun(init);
			if (kind === "let") return this.emitDoc(d, D(dc.letStart({ name, value: val.t }), val.kids), n);
			if (plain(val.t) === this.lex.humanize(id.name)) return;
			return this.emitDoc(d, D(dc.let({ name, value: val.t }), val.kids), n);
		}
		if (id.type === "ObjectPattern") {
			const names = this.patternNames(id);
			if (!names.length) return;
			const list = this.g.list(names);
			if (!init) return this.emit(d, `${dc.declare({ names: list })}.`, n);
			const fname = init.type === "CallExpression" ? calleeName(init) : null;
			if (fname && this.lex.startsWithVerb(fname) && !this.lex.converterParts(fname) && !this.applyRulesQuiet(init)) {
				const call = this.call(init, true);
				const { text, colon } = colonSplit(call.t);
				return this.emitDoc(d, D(`${dc.callTake({ call: text, names: list })}${colon}`, call.kids), n);
			}
			const val = this.noun(init);
			const { text, colon } = colonSplit(val.t);
			return this.emitDoc(d, D(`${dc.takeFrom({ source: text, names: list })}${colon}`, val.kids), n);
		}
		if (id.type === "ArrayPattern") {
			const names: (string | null)[] = id.elements.map((e: N) => (e ? this.g.list(this.patternNames(e)) : null));
			if (init?.type === "CallExpression" && calleeName(init) === "all" && unwrap(init.arguments[0])?.type === "ArrayExpression") {
				this.emit(d, `${dc.parallel}:`, n);
				unwrap(init.arguments[0]).elements.forEach((el: N, i: number) => {
					const x = unwrap(el).type === "CallExpression" ? this.call(unwrap(el), true) : this.noun(el);
					const { text, colon } = colonSplit(x.t);
					const name = names[i];
					const local = id.elements[i]?.type === "Identifier" ? id.elements[i].name : null;
					const fn = unwrap(el).type === "CallExpression" ? calleeName(unwrap(el)) : null;
					const phrase = fn && local && this.namesItsResult(fn, local) ? dc.callInto : dc.callAs;
					this.emitDoc(d + 1, D(`• ${name ? phrase({ call: text, name }) : text}${colon}`, x.kids), el, "", "bullet");
				});
				return;
			}
			if (names.length === 1 && names[0] !== null && init?.type === "CallExpression") {
				const call = this.call(init, true);
				return this.emitDoc(d, D(dc.callTakeFirst({ call: call.t, name: names[0]! }), call.kids), n);
			}
			const shown = names.map((x) => x ?? dc.skipped);
			const val = init ? this.noun(init) : D(this.say.expressions.nothing);
			if (shown.length === 1) return this.emitDoc(d, D(dc.letFirst({ name: shown[0]!, value: val.t }), val.kids), n);
			return this.emitDoc(d, D(dc.split({ value: val.t, names: this.g.list(shown) }), val.kids), n);
		}
		this.emit(d, this.raw(n), n, "raw");
	}

	fnTitle(name: string, fn: N): string {
		const t = this.say.declarations.title;
		const conv = this.lex.converterParts(name);
		const words = this.lex.words(name);
		if (conv) return capFirst(t.converter({ from: this.lex.display(conv[0]), to: this.lex.display(conv[1]) }));
		if (this.lex.isPredicateName(name)) return capFirst(t.predicate({ words: this.lex.display(words) }));
		if (/^[A-Z]/.test(name) && this.returnsJsx(fn)) return capFirst(t.component({ name: this.lex.humanize(name) }));
		if (/^to[A-Z]/.test(name)) return t.toType({ target: this.lex.humanize(name.slice(2)) });
		if (this.lex.startsWithVerb(name) || this.localFns.has(name)) return t.action({ action: this.lex.humanize(name) });
		return capFirst(this.lex.humanize(name));
	}

	returnsJsx(fn: N): boolean {
		const b = unwrap(fn.body);
		if (b?.type?.startsWith("JSX")) return true;
		return !!b?.body?.some?.((st: N) => st.type === "ReturnStatement" && unwrap(st.argument)?.type?.startsWith("JSX"));
	}

	recordParamTypes(params: N[]) {
		const code = (x: N) => this.code(x);
		for (let p of params) {
			if (p.type === "AssignmentPattern") p = p.left;
			if (p.type === "TSParameterProperty") p = p.parameter;
			const ann = p.typeAnnotation?.typeAnnotation;
			if (!ann) continue;
			if (p.type === "Identifier") {
				const t = typeRefName(ann, code);
				if (t) this.varTypes.set(p.name, t);
				continue;
			}
			if (p.type !== "ObjectPattern") continue;
			const fieldTypes = new Map<string, N>();
			if (ann.type === "TSTypeLiteral") for (const m of ann.members) if (m.key?.name) fieldTypes.set(m.key.name, m.typeAnnotation?.typeAnnotation);
			const owner = ann.type === "TSTypeReference" ? typeRefName(ann, code) : null;
			for (const prop of p.properties) {
				if (prop.type !== "Property" || !prop.key?.name) continue;
				const local = prop.value?.type === "AssignmentPattern" ? prop.value.left : prop.value;
				if (local?.type !== "Identifier") continue;
				const t = owner ? `@${owner}.${prop.key.name}` : typeRefName(fieldTypes.get(prop.key.name), code);
				if (t) this.varTypes.set(local.name, t);
			}
		}
	}

	fnDecl(name: string, fn: N, n: N, d: number) {
		this.recordParamTypes(fn.params);
		const title = mk("f", this.fnTitle(name, fn), name);
		const given = fn.params.flatMap((p: N) => this.patternNames(p, true));
		const ret = fn.returnType ? this.typeText(fn.returnType.typeAnnotation, true) : null;
		const params = given.length ? this.g.list(given) : null;
		const returns = ret && ret !== this.say.types.nothing ? ret : null;
		this.collectTypes(fn);
		const said = this.say.declarations.signature({ title, params, returns, async: !!fn.async });
		const text = params !== null || returns !== null ? markDetails(said, title) : said;
		this.emitHead(d, text, params === null && returns === null ? text : title, n);
		const ex = fn.body.type === "BlockStatement" ? null : fn.body;
		if (ex) this.returnLike(ex, d + 1, ex);
		else this.block(fn.body, d + 1);
	}

	classDecl(n: N, d: number) {
		const dc = this.say.declarations;
		const name = n.id?.name ?? dc.names.anonymousClass;
		const base = n.superClass ? this.noun(n.superClass).t : null;
		const head = dc.class({ name: mk("f", capFirst(this.lex.humanize(name)), name), base });
		this.emitHead(d, head, head, n);
		for (const m of n.body.body) {
			this.leadingComments(m, d + 1);
			if (m.type === "MethodDefinition" || m.type === "TSAbstractMethodDefinition") {
				if (!m.value?.body) continue;
				if (m.kind === "constructor") {
					const given = m.value.params.flatMap((p: N) => this.patternNames(p));
					this.emitHead(d + 1, dc.constructorHead({ params: given.length ? this.g.list(given) : null }), dc.constructorHead({ params: null }), m);
					const kept = m.value.params.filter((p: N) => p.type === "TSParameterProperty");
					const names = kept.flatMap((p: N) => this.patternNames(p.parameter));
					if (names.length) this.emit(d + 2, `${dc.keepParams({ names: this.g.list(names), count: names.length })}.`, kept[0]);
					if (!names.length || m.value.body.body.length) this.block(m.value.body, d + 2);
				} else this.fnDecl(m.key.name ?? this.code(m.key), m.value, m, d + 1);
			} else if (m.type === "PropertyDefinition") {
				const k = m.key.name ?? this.code(m.key);
				const field = mk("v", this.lex.humanize(k), k);
				if (m.value && isFn(m.value)) this.fnDecl(k, unwrap(m.value), m, d + 1);
				else if (m.value)
					this.emitDoc(
						d + 1,
						this.wrap(this.noun(m.value), (t) => dc.fieldInit({ field, value: t })),
						m,
					);
				else this.emit(d + 1, `${dc.field({ field })}.`, m, "note");
			}
		}
	}

	returnLike(ex: N, d: number, n: N): void {
		const s = this.say.statements;
		const u = unwrap(ex);
		if (isNullish(u)) return this.emit(d, `${s.returnNothing}.`, n);
		if (this.looksBoolean(u) && !isBoolLit(u)) {
			const c = this.cond(u);
			return this.emitDoc(d, D(s.returnWhether({ condition: c.t }), c.kids), n);
		}
		if (u.type === "CallExpression") {
			const name = calleeName(u);
			if (name && this.isActionName(name) && !this.lex.converterParts(name) && !this.applyRulesQuiet(u)) {
				const call = this.call(u, true);
				const { text, colon } = colonSplit(call.t);
				return this.emitDoc(d, D(`${s.returnCall({ call: text })}${colon}`, call.kids), n);
			}
		}
		if (u.type === "ConditionalExpression") {
			const c = this.cond(u.test);
			const a = this.noun(u.consequent);
			const b = this.noun(u.alternate);
			const inline = s.returnEither({ value: a.t, condition: c.t, otherwise: b.t });
			if (vlen(inline) <= 100 && !a.kids.length && !b.kids.length && !c.kids.length) return this.emit(d, `${inline}.`, n);
			this.emitDoc(d, D(c.kids.length ? `${s.ifBlock}:` : `${s.if({ condition: c.t })}:`, c.kids), u.test);
			this.returnLike(u.consequent, d + 1, u.consequent);
			this.emit(d, `${s.otherwise}:`, u.alternate);
			return this.returnLike(u.alternate, d + 1, u.alternate);
		}
		this.emitDoc(
			d,
			this.wrap(this.noun(u), (t) => s.return({ value: t })),
			n,
		);
	}

	returnStmt(n: N, d: number) {
		if (!n.argument) return this.emit(d, `${this.say.statements.stop}.`, n);
		return this.returnLike(n.argument, d, n);
	}

	throwStmt(n: N, d: number) {
		const a = unwrap(n.argument);
		const err = a.type === "NewExpression" ? this.newExpr(a) : this.noun(a);
		return this.emitDoc(
			d,
			this.wrap(err, (t) => this.say.statements.throw({ error: t })),
			n,
		);
	}

	/** The single line a simple statement renders to, for guard clauses. */
	inlineLine(s: N, d: number): Line | null {
		const lines = this.body(s, d);
		if (lines.length !== 1 || lines[0]!.text.endsWith(":")) return null;
		return lines[0]!;
	}

	/** One-liner form of a simple statement, for guard clauses. */
	inlineStmt(s: N, d: number): string | null {
		const line = this.inlineLine(s, d);
		return line && lowerFirst(line.text);
	}

	isCommentLine(line: Line): boolean {
		return line.kind === "note" && this.comments.some((c) => c.start === line.start);
	}

	ifStmt(n: N, d: number) {
		const s = this.say.statements;
		const c = this.cond(n.test);
		const only = n.consequent.type === "BlockStatement" ? (n.consequent.body.length === 1 ? n.consequent.body[0] : null) : n.consequent;
		if (!n.alternate && only && !c.kids.length) {
			if (only.type === "ContinueStatement") return this.emit(d, capFirst(`${s.skipIf({ condition: c.t })}.`), n);
			if (only.type === "BreakStatement") return this.emit(d, capFirst(`${s.breakIf({ condition: c.t })}.`), n);
			const line = this.inlineLine(only, d);
			const inline = line && lowerFirst(line.text);
			if (line && inline && vlen(inline) + vlen(c.t) < 120)
				return this.emit(d, capFirst(s.ifThen({ condition: c.t, action: this.isCommentLine(line) ? "" : inline })), n);
		}
		if (c.kids.length) {
			this.emitDoc(d, D(s.if({ condition: c.t }), c.kids), n.test);
			this.emit(d, `${s.then}:`, n.consequent);
		} else this.emit(d, `${s.if({ condition: c.t })}:`, n.test);
		this.block(n.consequent, d + 1);
		let alt = n.alternate;
		while (alt?.type === "IfStatement") {
			const c2 = this.cond(alt.test);
			if (c2.kids.length) {
				this.emitDoc(d, D(s.elseIf({ condition: c2.t }), c2.kids), alt.test);
				this.emit(d, `${s.then}:`, alt.consequent);
			} else this.emit(d, `${s.elseIf({ condition: c2.t })}:`, alt.test);
			this.block(alt.consequent, d + 1);
			alt = alt.alternate;
		}
		if (alt) {
			this.emit(d, `${s.otherwise}:`, alt);
			this.block(alt, d + 1);
		}
	}

	forOf(n: N, d: number) {
		const s = this.say.statements;
		const pat = n.left.declarations?.[0]?.id ?? n.left;
		const right = unwrap(n.right);
		let label: string;
		let coll: Doc;
		if (pat.type === "ArrayPattern" && right.type === "CallExpression" && calleeName(right) === "entries") {
			const [k, v] = pat.elements.map((e: N) => (e ? this.g.list(this.patternNames(e)) : null));
			const objNode = unwrap(right.callee).object;
			const isObjectEntries = unwrap(objNode)?.name === "Object";
			coll = this.noun(isObjectEntries ? right.arguments[0] : objNode);
			label = isObjectEntries
				? s.loopItem.key({ key: String(k), value: v ?? null })
				: s.loopItem.indexed({ item: v ?? this.say.expressions.item, position: k ?? null });
		} else {
			coll = this.noun(n.right);
			label = s.loopItem.each({ item: this.g.list(this.patternNames(pat)) });
		}
		this.emitDoc(d, D(`${s.forOf({ label, collection: coll.t, async: !!n.await })}:`, coll.kids), n);
		this.block(n.body, d + 1);
	}

	forStmt(n: N, d: number) {
		const s = this.say.statements;
		const init = n.init?.declarations?.[0];
		const test = unwrap(n.test);
		const upd = unwrap(n.update);
		if (init?.id?.type === "Identifier" && test?.type === "BinaryExpression" && upd?.type === "UpdateExpression" && upd.operator === "++") {
			const i = this.ref(init.id.name);
			const start = this.noun(init.init);
			const R = unwrap(test.right);
			const from = unwrap(init.init);
			if (R.type === "MemberExpression" && !R.computed && R.property.name === "length" && from?.type === "Literal" && from.value === 0) {
				this.emit(d, `${s.forIndex({ index: i, collection: this.noun(R.object).t })}:`, n);
				return this.block(n.body, d + 1);
			}
			this.emit(d, `${s.countFrom({ index: i, start: start.t, condition: this.cond(test).t })}:`, n);
			return this.block(n.body, d + 1);
		}
		const parts = {
			init: n.init ? (unwrap(n.init).type === "VariableDeclaration" ? this.code(n.init) : this.noun(n.init).t) : null,
			test: n.test ? this.cond(n.test).t : null,
			update: n.update ? this.noun(n.update).t : null,
		};
		this.emit(d, `${capFirst(s.forParts(parts))}:`, n);
		this.block(n.body, d + 1);
	}

	tryStmt(n: N, d: number) {
		const s = this.say.statements;
		this.emit(d, `${s.try}:`, n);
		this.block(n.block, d + 1);
		if (n.handler) {
			const p = n.handler.param ? this.g.list(this.patternNames(n.handler.param)) : null;
			if (!n.handler.body.body.length) this.emit(d, `${s.catchIgnore}.`, n.handler);
			else {
				this.emit(d, `${s.catch({ error: p })}:`, n.handler);
				this.block(n.handler.body, d + 1);
			}
		}
		if (n.finalizer) {
			this.emit(d, `${s.finally}:`, n.finalizer);
			this.block(n.finalizer, d + 1);
		}
	}

	switchStmt(n: N, d: number) {
		const s = this.say.statements;
		const disc = this.noun(n.discriminant);
		this.emitDoc(d, D(`${s.switch({ value: disc.t })}:`, disc.kids), n);
		let pending: string[] = [];
		for (const c of n.consequent ?? n.cases) {
			if (c.test) pending.push(this.noun(c.test).t);
			if (!c.consequent.length) continue;
			const values = this.g.list(pending, "or");
			const label = c.test ? s.case({ values }) : pending.length ? s.caseOrDefault({ values }) : s.default;
			pending = [];
			this.emit(d + 1, `• ${label}:`, c, "bullet");
			const stmts = c.consequent.length === 1 && c.consequent[0].type === "BlockStatement" ? c.consequent[0].body : c.consequent;
			for (const st of stmts) {
				if (st.type === "BreakStatement" && !st.label) continue;
				this.stmt(st, d + 2);
			}
		}
	}

	// ---------- types ----------

	typeText(t: N, top = false): string {
		const y = this.say.types;
		if (!t) return y.unknown;
		switch (t.type) {
			case "TSStringKeyword":
				return y.string;
			case "TSNumberKeyword":
				return y.number;
			case "TSBooleanKeyword":
				return y.boolean;
			case "TSVoidKeyword":
			case "TSUndefinedKeyword":
			case "TSNullKeyword":
			case "TSNeverKeyword":
				return y.nothing;
			case "TSAnyKeyword":
			case "TSUnknownKeyword":
				return y.any;
			case "TSArrayType":
				return y.listOf({ item: this.typeName(t.elementType) });
			case "TSTypeReference": {
				const name = this.code(t.typeName);
				const args = t.typeArguments?.params ?? t.typeParameters?.params ?? [];
				if (name === "Promise" && args[0]) return this.typeText(args[0], top);
				if (name === "Array" && args[0]) return y.listOf({ item: this.typeName(args[0]) });
				if (name === "Record" && args[1]) return y.lookup({ key: this.typeName(args[0]), value: this.typeName(args[1]) });
				if (name === "Map" && args[1]) return y.map({ key: this.typeName(args[0]), value: this.typeName(args[1]) });
				if (name === "Set" && args[0]) return y.set({ item: this.typeName(args[0]) });
				if ((name === "Pick" || name === "Omit") && args[1]) {
					const keys = args[1].type === "TSUnionType" ? args[1].types : [args[1]];
					const fields = this.g.list(
						keys.map((k: N) => (k.type === "TSLiteralType" && typeof k.literal?.value === "string" ? this.prop(k.literal.value) : this.typeText(k))),
					);
					return (name === "Pick" ? y.pick : y.omit)({ type: this.typeText(args[0], top), fields });
				}
				if ((name === "Partial" || name === "Readonly" || name === "Required" || name === "Awaited" || name === "NonNullable") && args[0])
					return this.typeText(args[0], top);
				const shape = /^(z\.)?(infer|input|output|Infer)$/.exec(name);
				if (shape && args[0]?.type === "TSTypeQuery") {
					const schema = this.code(args[0].exprName);
					return y.schemaShape({ schema: mk("t", schema, schema), side: shape[2] === "input" || shape[2] === "output" ? shape[2] : "data" });
				}
				if (name === "ReturnType" && args[0]) return y.returnOf({ fn: this.typeSubject(args[0]) });
				if (name === "Parameters" && args[0]) return y.paramsOf({ fn: this.typeSubject(args[0]), index: null });
				return y.reference({ type: mk("t", name, name), name });
			}
			case "TSUnionType": {
				const parts = t.types.filter((x: N) => !/TSNullKeyword|TSUndefinedKeyword/.test(x.type));
				const optional = parts.length < t.types.length;
				if (parts.every((x: N) => x.type === "TSLiteralType"))
					return y.oneOf({
						options: this.g.list(
							parts.map((x: N) => this.code(x)),
							"or",
						),
						optional,
					});
				return y.union({
					options: this.g.list(
						parts.map((x: N) => this.typeText(x, top)),
						"or",
					),
					optional,
				});
			}
			case "TSLiteralType":
				return this.code(t);
			case "TSTypeLiteral":
				return top ? y.objectWith({ members: this.typeMembers(t.members) }) : y.object;
			case "TSFunctionType":
				return y.function;
			case "TSTupleType":
				return y.tuple({ items: this.g.list(t.elementTypes.map((x: N) => this.typeName(x))) });
			case "TSParenthesizedType":
				return this.typeText(t.typeAnnotation, top);
			case "TSTypePredicate":
				return t.typeAnnotation ? y.predicate({ subject: this.code(t.parameterName), type: this.typeText(t.typeAnnotation.typeAnnotation) }) : y.boolean;
			case "TSIntersectionType":
				return y.intersection({ parts: t.types.map((x: N) => this.typeText(x, true)) });
			case "TSIndexedAccessType": {
				const k = t.indexType;
				const obj = t.objectType.type === "TSParenthesizedType" ? t.objectType.typeAnnotation : t.objectType;
				if (k.type === "TSNumberKeyword") return y.itemOf({ type: this.typeSubject(obj) });
				const fnArg =
					obj.type === "TSTypeReference" && this.code(obj.typeName) === "Parameters" ? (obj.typeArguments ?? obj.typeParameters)?.params?.[0] : null;
				if (fnArg && k.type === "TSLiteralType" && typeof k.literal?.value === "number")
					return y.paramsOf({ fn: this.typeSubject(fnArg), index: k.literal.value });
				const key = k.type === "TSLiteralType" && typeof k.literal?.value === "string" ? this.lex.humanize(k.literal.value) : this.typeText(k);
				return y.indexed({ type: this.typeSubject(t.objectType), key });
			}
			case "TSTypeQuery":
				return y.typeOf({ value: this.qualifiedName(t.exprName) });
			case "TSTypeOperator":
				return t.operator === "keyof" ? y.keyOf({ type: this.typeText(t.typeAnnotation) }) : this.typeText(t.typeAnnotation, top);
			case "TSBigIntKeyword":
				return y.bigint;
			case "TSObjectKeyword":
				return y.object;
			default:
				return mk(
					"c",
					this.code(t)
						.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")
						.replace(/\s+/g, " ")
						.trim(),
				);
		}
	}

	/** `a.b.c` in type position (`typeof a.b`) -> "a's b's c". */
	qualifiedName(q: N): string {
		if (q.type !== "TSQualifiedName") return this.ref(this.code(q));
		const path: string[] = [];
		let cur = q;
		while (cur.type === "TSQualifiedName") {
			path.unshift(this.prop(cur.right.name));
			cur = cur.left;
		}
		return this.say.expressions.member.chain({ path: [this.ref(this.code(cur)), ...path] });
	}

	/** A type named as the thing it describes: `typeof f` -> "f", `Api["send"]` -> "Api's send". */
	typeSubject(t: N): string {
		if (t.type === "TSTypeQuery") return this.qualifiedName(t.exprName);
		const k = t.indexType;
		if (t.type === "TSIndexedAccessType" && k.type === "TSLiteralType" && typeof k.literal?.value === "string")
			return this.say.expressions.member.chain({ path: [this.typeSubject(t.objectType), this.prop(k.literal.value)] });
		if (t.type === "TSTypeReference") return this.typeName(t);
		return this.typeText(t);
	}

	typeName(t: N): string {
		if (t?.type === "TSTypeReference") {
			const n = this.code(t.typeName);
			return mk("t", n, n);
		}
		return this.g.bareNoun(this.typeText(t));
	}

	typeMembers(members: N[]): string {
		const names = members
			.filter((m: N) => m.key)
			.map((m: N) => this.say.types.member({ name: this.lex.humanize(m.key.name ?? String(m.key.value)), optional: !!m.optional }));
		if (!names.length) return this.say.types.object;
		return this.g.list(names);
	}

	collectTypes(root: N) {
		const walk = (x: N) => {
			if (!x || typeof x !== "object") return;
			if (Array.isArray(x)) return x.forEach(walk);
			if (x.type === "FunctionDeclaration" && x.id?.name) this.localFns.add(x.id.name);
			if (x.type === "VariableDeclarator" && x.id?.type === "Identifier" && isFn(unwrap(x.init))) this.localFns.add(x.id.name);
			if ((x.type === "TSPropertySignature" || x.type === "PropertyDefinition") && x.key?.name && x.typeAnnotation?.typeAnnotation?.type === "TSBooleanKeyword")
				this.bools.add(x.key.name);
			if (x.type === "Identifier" && x.typeAnnotation?.typeAnnotation?.type === "TSBooleanKeyword") this.bools.add(x.name);
			if (x.type === "AssignmentPattern" && x.left?.type === "Identifier" && isBoolLit(x.right)) this.bools.add(x.left.name);
			if (x.type === "Property" && x.value?.type === "AssignmentPattern" && isBoolLit(x.value.right) && x.key?.name) this.bools.add(x.key.name);
			for (const k in x) if (typeof x[k] === "object") walk(x[k]);
		};
		walk(root);
	}

	// ---------- entry ----------

	narrate(src: string, filename = "input.ts"): { lines: Line[]; errors: number } {
		this.src = src;
		this.path = filename;
		this.lines = [];
		this.bools = new Set();
		this.aliases = new Map();
		this.varTypes = new Map();
		this.localFns = new Set();
		this.usedComments = new Set();
		this.headTitles = new Map();
		const lang = /\.(tsx|jsx)$/.test(filename) ? filename : filename.replace(/\.(m|c)?js$/, ".ts");
		const { program, errors, comments, gaps } = this.parseReadable(lang, src);
		this.parseErrors = errors;
		this.program = program;
		this.imports = importsOf(program);
		this.comments = comments ?? [];
		this.collectTypes(program);
		let prevTop = false;
		for (const s of program.body) {
			const before = this.lines.length;
			this.stmt(s, 0);
			const isBig = this.lines.length - before > 1;
			if (this.lines.length > before && (isBig || prevTop) && before > 0) this.lines.splice(before, 0, { d: 0, text: "", start: -1, end: -1, kind: "blank" });
			prevTop = isBig;
		}
		const lineOf = (offset: number) => src.slice(0, offset).split("\n").length;
		for (const g of gaps) {
			const at = this.lines.findIndex((l) => l.start >= g.start);
			const to = lineOf(g.start + src.slice(g.start, g.end).trimEnd().length);
			const note: Line = {
				d: at < 0 ? 0 : this.lines[at]!.d,
				text: this.say.statements.unreadable({ from: lineOf(g.start), to }),
				start: g.start,
				end: g.end,
				kind: "note",
			};
			this.lines.splice(at < 0 ? this.lines.length : at, 0, note);
		}
		return { lines: this.lines, errors: errors.length };
	}

	/** Parses `src`. oxc recovers from some errors itself; when one stops it cold (an empty program), the unreadable stretches are
	 * blanked out (whole lines, offsets kept) so the rest still narrates. */
	parseReadable(lang: string, src: string): ReturnType<Parser> & { gaps: { start: number; end: number }[] } {
		type Gap = { start: number; end: number };
		const readable = (r: ReturnType<Parser>) => !r.errors.length || r.program.body.length > 0;
		const first = this.parse(lang, src);
		if (readable(first)) return { ...first, gaps: [] };
		const blank = (text: string, start: number, end: number) => text.slice(0, start) + text.slice(start, end).replace(/[^\r\n]/g, " ") + text.slice(end);
		// The error that stopped the parser is the last one reported.
		const stoppedAt = (r: ReturnType<Parser>) => {
			const e = r.errors.at(-1) as { labels?: { start: number }[]; start?: number } | undefined;
			return Math.min(e?.labels?.[0]?.start ?? e?.start ?? src.length, src.length);
		};
		const lineStarts = [0, ...[...src.matchAll(/\n/g)].map((m) => m.index + 1), src.length];
		const lineAt = (offset: number) => lineStarts.findLastIndex((x) => x <= offset);
		// Top-level statements usually start at column 0, so wide cuts are only tried there.
		const topStarts = [0, ...[...src.matchAll(/\n(?=[^\s})\],.])/g)].map((m) => m.index + 1), src.length];
		// Each try is a parse, hence the budget.
		let budget = 80;
		const tryParse = (text: string) => {
			budget--;
			return this.parse(lang, text);
		};
		/** Whether blanking [cut, resume) lets the parser read on to at least `past`. */
		const getsPast = (text: string, cut: number, resume: number, past: number) => {
			const next = tryParse(blank(text, cut, resume));
			return readable(next) || stoppedAt(next) >= past;
		};
		/** The fewest whole lines near `at` (within three lines) whose removal lets parsing get well past them. */
		const smallGap = (text: string, at: number, floor: number): Gap | null => {
			const line = lineAt(at);
			const last = lineStarts.length - 1;
			for (let size = 1; size <= 4; size++)
				for (const offset of [0, -1, 1, -2, 2, -3, 3]) {
					const from = line + offset;
					const start = lineStarts[from];
					if (start === undefined || from + size > last || start < floor || budget <= 0) continue;
					const end = lineStarts[from + size]!;
					if (getsPast(text, start, end, lineStarts[Math.min(from + size + 2, last)]!)) return { start, end };
				}
			return null;
		};
		/** From the last top-level statement that parses on its own up to the first top-level statement after which parsing goes on. */
		const wideGap = (text: string, at: number, floor: number): Gap => {
			let start = floor;
			for (const s of topStarts.filter((x) => x <= at && x > floor).reverse()) {
				if (budget <= 0) break;
				if (readable(tryParse(text.slice(0, s)))) {
					start = s;
					break;
				}
			}
			const end = topStarts.find((s) => s > at && budget > 0 && getsPast(text, start, s, s)) ?? src.length;
			return { start, end };
		};
		const recover = (small: boolean) => {
			let text = src;
			let r = first;
			const gaps: Gap[] = [];
			for (let round = 0; !readable(r) && round < 8 && budget > 0; round++) {
				const at = stoppedAt(r);
				const floor = gaps.at(-1)?.end ?? 0;
				const gap = (small && smallGap(text, at, floor)) || wideGap(text, at, floor);
				const prev = gaps.at(-1);
				if (prev && !text.slice(prev.end, gap.start).trim()) prev.end = gap.end;
				else gaps.push(gap);
				text = blank(text, gap.start, gap.end);
				r = tryParse(text);
			}
			return readable(r) ? { ...r, errors: first.errors, gaps } : null;
		};
		const done = recover(true) ?? recover(false);
		if (done) return done;
		const at = stoppedAt(first);
		const start = topStarts.filter((x) => x <= at).findLast((s) => readable(this.parse(lang, src.slice(0, s)))) ?? 0;
		return { ...this.parse(lang, blank(src, start, src.length)), errors: first.errors, gaps: [{ start, end: src.length }] };
	}
}
