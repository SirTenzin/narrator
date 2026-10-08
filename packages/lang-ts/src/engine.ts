import {
	type CorePhrases,
	capFirst,
	D,
	type Doc,
	type Grammar,
	Lexicon,
	type Line,
	type LineKind,
	type Locale,
	lowerFirst,
	mk,
	plain,
	vlen,
} from "@narrate/core";
import type { Parser } from "./parser";
import type { CallRule, CondRule, StmtRule, TsPlugin } from "./plugin";

export type N = any;

/** A rule after the engine has bound its plugin's phrasebook in. */
type Bound<R extends (ctx: any) => any> = (ctx: Omit<Parameters<R>[0], "say">) => ReturnType<R>;

const asDoc = (x: Doc | string) => (typeof x === "string" ? D(x) : x);

export const listJoin = (xs: string[], conj = "and") =>
	xs.length <= 1 ? (xs[0] ?? "") : xs.length === 2 ? `${xs[0]} ${conj} ${xs[1]}` : `${xs.slice(0, -1).join(", ")}, ${conj} ${xs.at(-1)}`;

const INLINE_MAX = 110;

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
const isBoolLit = (n: N) => unwrap(n)?.type === "Literal" && typeof unwrap(n).value === "boolean";
const calleeName = (n: N): string | null => {
	const c = unwrap(n?.callee);
	if (!c) return null;
	if (c.type === "Identifier") return c.name;
	if (c.type === "MemberExpression" && !c.computed) return c.property.name;
	return null;
};

const WRAPPERS = new Set(["Promise", "Array", "Partial", "Readonly", "Required", "NonNullable", "Awaited", "ReadonlyArray", "Pick", "Omit"]);

/** The named type behind an annotation (`Promise<Foo[]> | null` -> "Foo"), or null for primitives/inline shapes. */
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
	errorLabels: Record<string, string> = {};
	constants: Record<string, string> = {};
	errorPattern: RegExp | null = null;
	calls: Record<string, Bound<CallRule>[]> = {};
	conds: Record<string, Bound<CondRule>[]> = {};
	stmtRules: Bound<StmtRule>[] = [];
	aliases = new Map<string, string>();
	/** variable -> type spec: `Type` or `@Type.field`. */
	varTypes = new Map<string, string>();
	localFns = new Set<string>();
	/** Optional cross-file hook: declared return type name of a called function. */
	typeOfCall: ((fnName: string) => string | null) | null = null;
	bools = new Set<string>();
	comments: { start: number; end: number; value: string; type: string }[] = [];
	usedComments = new Set<number>();
	stats = { nodes: 0, fallbacks: 0, fallbackTypes: {} as Record<string, number> };

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
		const say = this.phrasesFor(d);
		const bind =
			<R extends (ctx: any) => any>(r: R): Bound<R> =>
			(ctx) =>
				r({ ...ctx, say });
		if (d.vocabulary) this.lex.extend(d.vocabulary);
		for (const a of d.ambient ?? []) this.ambient.add(a);
		Object.assign(this.errorLabels, d.errorLabels ?? {});
		Object.assign(this.constants, d.constants ?? {});
		if (d.errors instanceof RegExp) this.errorPattern = d.errors;
		else for (const x of d.errors ?? []) this.errorNames.add(x);
		for (const [k, r] of Object.entries(d.calls ?? {})) (this.calls[k] ??= []).unshift(bind(r));
		for (const [k, r] of Object.entries(d.conditions ?? {})) (this.conds[k] ??= []).unshift(bind(r));
		this.stmtRules.push(...(d.statements ?? []).map(bind));
		return this;
	}

	/** A plugin's phrasebook for this locale: locale override, then the plugin's own translation, then English. */
	phrasesFor(d: TsPlugin): unknown {
		return this.locale.plugins?.[d.name] ?? d.phrases?.[this.locale.id] ?? d.phrases?.en;
	}

	/** `isUpgrade` -> "is upgrade" / "is not upgrade". */
	predicatePhrase(id: string, negated: boolean): string {
		const w = this.lex.words(id);
		return `${negated ? this.g.negatePredicateHead(w[0]!) : w[0]!} ${this.lex.display(w.slice(1))}`.trim();
	}

	/** A property or key name as linked display text: `cusId` -> "customer ID". */
	prop(key: string): string {
		return mk("v", this.lex.humanize(key), key);
	}

	schemaText(n: N): string | null {
		for (const d of this.dialects) {
			const t = d.describeSchema?.(this, n, this.phrasesFor(d));
			if (t) return t;
		}
		return null;
	}

	// ---------- basics ----------

	raw(n: N, reason = n?.type): string {
		this.stats.fallbacks++;
		this.stats.fallbackTypes[reason] = (this.stats.fallbackTypes[reason] ?? 0) + 1;
		let code = this.src.slice(n.start, n.end).replace(/\s+/g, " ");
		if (code.length > 160) code = `${code.slice(0, 157)}…`;
		return mk("c", code);
	}

	code(n: N) {
		return this.src.slice(n.start, n.end);
	}

	ref(name: string): string {
		const alias = this.aliases.get(name);
		if (alias) return alias;
		const t = this.varTypes.get(name);
		return mk("v", this.lex.humanize(name), t ? `${name}|${t}` : name);
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
						if (!this.isAmbient(p.argument)) out.push({ key: null, node: p, text: D(`everything in ${this.noun(p.argument).t}`, this.noun(p.argument).kids) });
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

	argList(args: N[], skip?: Set<string>): Doc {
		const pairs = this.argPairs(args, skip);
		if (!pairs.length) return D("");
		const items = pairs.map(({ key, node, text }) => {
			if (!key) return text;
			const sameWords =
				plain(text.t) === this.lex.humanize(key) || (unwrap(node)?.type === "Identifier" && this.lex.humanize(unwrap(node).name) === this.lex.humanize(key));
			if (sameWords) return text;
			if (isBoolLit(node)) return D(unwrap(node).value ? mk("v", this.lex.humanize(key), key) : `no ${mk("v", this.lex.humanize(key), key)}`);
			return D(`${mk("v", this.lex.humanize(key), key)}: ${text.t}`, text.kids);
		});
		const joined = listJoin(items.map((i) => i.t));
		const kidsInline = items.filter((i) => i.kids.length).length;
		if (items.length <= 3 && vlen(joined) <= 70 && kidsInline === 0) return D(` (${joined})`);
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
		if (!n) return D("nothing");
		if ((n.type === "MemberExpression" || n.type === "Identifier") && Object.keys(this.constants).length) {
			const k = this.code(n).replace(/\?\./g, ".");
			if (this.constants[k]) return D(mk("l", this.constants[k]!));
			const meta = /^import\.meta\.(\w+)(?:\.(\w+))?$/.exec(k);
			if (meta) {
				const M: Record<string, string> = {
					main: "this file is being run directly",
					dir: "this file's folder",
					dirname: "this file's folder",
					url: "this file's URL",
					filename: "this file's path",
					path: "this file's path",
				};
				if (meta[1] === "env" && meta[2]) return D(`the ${mk("l", meta[2])} environment variable`);
				if (M[meta[1]!]) return D(M[meta[1]!]!);
			}
			const env = /^process\.env\.(\w+)$/.exec(k) ?? /^Bun\.env\.(\w+)$/.exec(k);
			if (env) return D(`the ${mk("l", env[1]!)} environment variable`);
		}
		switch (n.type) {
			case "Identifier":
				if (n.name === "undefined") return D("nothing");
				return D(this.ref(n.name));
			case "PrivateIdentifier":
				return D(this.ref(n.name));
			case "Literal":
				return D(this.literal(n));
			case "TemplateLiteral":
				return this.template(n);
			case "ThisExpression":
				return D("this");
			case "Super":
				return D("the parent class");
			case "MemberExpression":
				return this.member(n);
			case "CallExpression":
				return this.call(n, false);
			case "NewExpression":
				return this.newExpr(n);
			case "ArrayExpression":
				return this.array(n);
			case "ObjectExpression":
				return this.object(n);
			case "SpreadElement":
				return this.wrap(this.noun(n.argument), (t) => `all of ${t}`);
			case "UnaryExpression":
				if (n.operator === "!") return this.wrap(this.cond(n.argument, true), (t) => `whether ${t}`);
				if (n.operator === "typeof") return this.wrap(this.noun(n.argument), (t) => `the type of ${t}`);
				if (n.operator === "-") return this.wrap(this.noun(n.argument), (t) => `negative ${t}`);
				if (n.operator === "void") return D("nothing");
				if (n.operator === "+") return this.wrap(this.noun(n.argument), (t) => `${t} as a number`);
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
				return D(`${n.operator === "++" ? "increase" : "decrease"} ${this.noun(n.argument).t} by 1`);
			case "SequenceExpression":
				return D(n.expressions.map((x: N) => this.noun(x).t).join("; then "));
			case "YieldExpression":
				return this.wrap(this.noun(n.argument), (t) => `${n.delegate ? "everything yielded by" : "yield"} ${t}`);
			case "ImportExpression":
				return this.wrap(this.noun(n.source), (t) => `the module at ${t}`);
			case "TaggedTemplateExpression": {
				const tag = this.code(n.tag);
				const text = n.quasi.quasis
					.map((q: N) => q.value.cooked)
					.join("{…}")
					.replace(/\s+/g, " ")
					.trim();
				if (/sql/i.test(tag)) return D(`the SQL ${mk("c", text)}`);
				return D(this.raw(n));
			}
			case "ClassExpression":
				return D(`a class${n.id ? ` ${n.id.name}` : ""}`);
			case "JSXElement":
			case "JSXFragment":
				return this.jsx(n);
			case "MetaProperty":
				return D("this module's info");
			default:
				return D(this.raw(n));
		}
	}

	wrap(d: Doc, f: (t: string) => string): Doc {
		return D(f(d.t.replace(/:$/, "")), d.kids);
	}

	literal(n: N): string {
		if (n.regex) return mk("c", n.raw);
		if (n.value === null) return "nothing";
		if (typeof n.value === "string") return mk("l", `"${n.value}"`);
		if (typeof n.value === "number") {
			const v = n.value;
			if (Number.isInteger(v) && Math.abs(v) >= 10000) return mk("l", v.toLocaleString("en-US"));
			return mk("l", String(v));
		}
		return mk("l", String(n.value));
	}

	template(n: N): Doc {
		if (n.expressions.length === 1 && n.quasis.every((q: N) => !q.value.cooked)) return this.noun(n.expressions[0]);
		if (!n.expressions.length) return D(mk("l", `"${n.quasis[0].value.cooked}"`));
		let t = mk("l", `"${n.quasis[0].value.cooked}`);
		n.expressions.forEach((ex: N, i: number) => {
			t += `{${this.noun(ex).t}}`;
			t += mk("l", `${n.quasis[i + 1].value.cooked}${i === n.expressions.length - 1 ? '"' : ""}`);
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

	member(n: N): Doc {
		const { root, steps } = this.chain(n);
		const last = steps.at(-1)!;
		const prefix = { type: "MemberExpression", ...n };
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
				return D(`the number of ${coll.t} ${this.isDestructured(fn) ? "whose" : "where"} ${c.t}`, [...coll.kids, ...c.kids]);
			}
		}
		if (last.name === "length" && steps.length >= 1) {
			const inner = this.memberFrom(root, steps.slice(0, -1));
			return this.wrap(inner, (t) => `the number of ${t}`);
		}
		if (last.index) {
			const idx = unwrap(last.index);
			const inner = this.memberFrom(root, steps.slice(0, -1));
			if (idx.type === "Literal" && idx.value === 0) return this.wrap(inner, (t) => `the first of ${t}`);
			if (idx.type === "Literal" && typeof idx.value === "number") return this.wrap(inner, (t) => `item #${idx.value + 1} of ${t}`);
			if (
				idx.type === "BinaryExpression" &&
				idx.operator === "-" &&
				unwrap(idx.left).type === "MemberExpression" &&
				unwrap(idx.left).property?.name === "length" &&
				unwrap(idx.right).value === 1
			)
				return this.wrap(inner, (t) => `the last of ${t}`);
			const k = this.noun(idx);
			return D(`${this.g.possessive(inner.t)} entry for ${k.t}`, [...inner.kids, ...k.kids]);
		}
		void prefix;
		return this.memberFrom(root, steps);
	}

	memberFrom(root: N, steps: { name?: string; index?: N }[]): Doc {
		const rootAmbient = this.isAmbient(root);
		let base: Doc | null = rootAmbient ? null : this.noun(root);
		const firstBase = base;
		const names: string[] = [];
		const words: string[] = [];
		for (let i = 0; i < steps.length; i++) {
			const s = steps[i]!;
			if (s.index) {
				const idx = unwrap(s.index);
				const firstOrLast = idx.type === "Literal" && idx.value === 0 ? "first" : null;
				if (firstOrLast && names.length && this.g.isPlural(this.lex.humanize(names.at(-1)!))) {
					const n = names.pop()!;
					words.pop();
					words.push(`${firstOrLast} ${mk("v", this.g.singular(this.lex.humanize(n)), n)}`);
					names.push(n);
					continue;
				}
				const cur = this.joinPossessive(base, words);
				const k = this.noun(s.index);
				base = firstOrLast ? D(`the first of ${cur.t}`, cur.kids) : D(`${this.g.possessive(cur.t)} entry for ${k.t}`, [...cur.kids, ...k.kids]);
				names.length = 0;
				words.length = 0;
				continue;
			}
			if (rootAmbient && !names.length && !base && this.ambient.has(s.name!)) continue;
			const rootType = i === 0 && root?.type === "Identifier" ? this.varTypes.get(root.name) : undefined;
			const ownerType = rootType && !rootType.startsWith("@") ? rootType : null;
			names.push(s.name!);
			words.push(mk("v", this.lex.humanize(s.name!), ownerType ? `${s.name}|@${ownerType}.${s.name}` : s.name!));
		}
		return this.joinPossessive(base, words, root?.type === "CallExpression" && !!base && base === firstBase);
	}

	joinPossessive(base: Doc | null, words: string[], fromCall = false): Doc {
		if (fromCall && base && words.length)
			return D(`the ${words.map((w, i) => (i < words.length - 1 ? this.g.possessive(w) : w)).join(" ")} from ${base.t}`, base.kids);
		if (!base) {
			if (!words.length) return D("the context");
			const chain = words.map((w, i) => (i < words.length - 1 ? this.g.possessive(w) : w)).join(" ");
			return D(`the ${chain}`);
		}
		if (!words.length) return base;
		const all = [base.t, ...words];
		if (all.length <= 4) return D(all.map((w, i) => (i < all.length - 1 ? this.g.possessive(w) : w)).join(" "), base.kids);
		const head = all
			.slice(0, -1)
			.map((w, i, a) => (i < a.length - 1 ? this.g.possessive(w) : w))
			.join(" ");
		return D(`the ${all.at(-1)} of ${head}`, base.kids);
	}

	array(n: N): Doc {
		const els = n.elements.filter(Boolean);
		if (!els.length) return D("an empty list");
		if (els.length === 1 && els[0].type === "SpreadElement") {
			const inner = unwrap(els[0].argument);
			if (inner.type === "NewExpression" && inner.callee.name === "Set") return this.wrap(this.noun(inner.arguments[0]), (t) => `${t} without duplicates`);
			return this.wrap(this.noun(inner), (t) => `a copy of ${t}`);
		}
		if (els.every((e: N) => e.type === "SpreadElement")) {
			const parts: Doc[] = els.map((e: N) => this.noun(e.argument));
			const joined = parts.map((p) => p.t).join(", plus ");
			if (vlen(joined) <= 80 && parts.every((p) => !p.kids.length)) return D(joined);
			return D(
				"one list combining:",
				parts.flatMap((p) => this.bullet(p)),
			);
		}
		const parts = els.map((e: N) => (e.type === "SpreadElement" ? this.wrap(this.noun(e.argument), (t) => `everything in ${t}`) : this.noun(e)));
		const joined = listJoin(parts.map((p: Doc) => p.t));
		if (parts.length <= 4 && vlen(joined) < 70 && parts.every((p: Doc) => !p.kids.length)) return D(`a list of ${joined}`);
		return D(
			"a list of:",
			parts.flatMap((p: Doc) => this.bullet(p)),
		);
	}

	object(n: N): Doc {
		if (!n.properties.length) return D("an empty object");
		const [first, ...rest] = n.properties;
		if (first.type === "SpreadElement" && rest.length && rest.every((p: N) => p.type !== "SpreadElement" && !p.method)) {
			const base = this.noun(first.argument);
			const overrides: Doc[] = rest.map((p: N) => {
				const k = p.computed ? `[${this.noun(p.key).t}]` : mk("v", this.lex.humanize(p.key.name ?? String(p.key.value)), p.key.name ?? String(p.key.value));
				const v = p.shorthand ? D(this.ref(p.key.name)) : this.noun(p.value);
				return D(`${k} set to ${v.t}`, v.kids);
			});
			const joined = listJoin(overrides.map((o) => o.t));
			if (vlen(joined) < 70 && overrides.every((o) => !o.kids.length)) return D(`${base.t}, but with ${joined}`, base.kids);
			return D(`${base.t}, but with:`, [...base.kids, ...overrides.flatMap((o) => this.bullet(o))]);
		}
		const items: Doc[] = n.properties.flatMap((p: N): Doc[] => {
			if (p.type === "SpreadElement") {
				const cs = this.conditionalSpread(p.argument);
				if (cs) return cs;
				return [this.wrap(this.noun(p.argument), (t) => `everything in ${t}`)];
			}
			return [this.objectProp(p)];
		});
		return this.objectFromItems(items);
	}

	/** `...(cond ? { a } : {})` / `...(cond && { a })` -> each prop tagged "(only if cond)". */
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
		return obj.properties.map((p: N) => this.wrap(this.objectProp(p), (t) => `${t} (only if ${c.t})`));
	}

	objectProp(p: N): Doc {
		{
			const keyText = p.computed
				? `[${this.noun(p.key).t}]`
				: p.key.type === "Identifier"
					? mk("v", this.lex.humanize(p.key.name), p.key.name)
					: this.literal(p.key);
			if (p.shorthand && p.key.type === "Identifier") return D(this.ref(p.key.name));
			if (p.kind === "get") return D(`${keyText} (computed)`);
			if (p.method || (isFn(p.value) && unwrap(p.value).body.type === "BlockStatement")) {
				const f = p.method ? p.value : unwrap(p.value);
				return D(`${keyText}, a function${this.givenText(f.params)} that:`, this.body(f.body, 0));
			}
			const v = this.noun(p.value);
			return D(`${keyText}: ${v.t}`, v.kids);
		}
	}

	objectFromItems(items: Doc[]): Doc {
		const joined = listJoin(items.map((i) => i.t));
		if (items.length <= 3 && vlen(joined) < 70 && items.every((i) => !i.kids.length)) return D(`an object with ${joined}`);
		return D(
			"an object with:",
			items.flatMap((i) => this.bullet(i)),
		);
	}

	binaryNoun(n: N): Doc {
		const op = n.operator;
		if (op === "??") {
			const l = this.noun(n.left);
			const r = this.noun(n.right);
			if (unwrap(n.right).type === "ArrayExpression" && !unwrap(n.right).elements.length) return l;
			const parts = { value: l.t, fallback: r.t };
			return D(r.kids.length ? this.say.fallbackBlock(parts) : this.say.fallback(parts), [...l.kids, ...r.kids]);
		}
		if (op === "||" && !this.looksBoolean(n)) {
			const l = this.noun(n.left);
			const r = this.noun(n.right);
			return D(`${l.t}, or ${r.t} if that's empty`, [...l.kids, ...r.kids]);
		}
		if (op === "&&" && !this.looksBoolean(n.right)) {
			const c = this.cond(n.left);
			const r = this.noun(n.right);
			return D(`${r.t} (only if ${c.t})`, [...c.kids, ...r.kids]);
		}
		const opWord = this.say.ops[op as keyof CorePhrases["ops"]];
		if (opWord) {
			const folded = this.fold(n);
			if (folded !== null && /[*/]/.test(op)) return D(`${mk("l", this.locale.grammar.formatNumber(folded))} (${this.code(n).replace(/\s+/g, " ")})`);
			const operand = (x: N): Doc => {
				const u = unwrap(x);
				if (u.type !== "LogicalExpression" || u.operator !== "??") return this.noun(x);
				const a = this.noun(u.left);
				const b = this.noun(u.right);
				return D(this.say.fallbackInline({ value: a.t, fallback: b.t }), [...a.kids, ...b.kids]);
			};
			const l = operand(n.left);
			const r = operand(n.right);
			if (op === "+" && unwrap(n.left).type === "Literal" && typeof unwrap(n.left).value === "string")
				return D(`${l.t} followed by ${r.t}`, [...l.kids, ...r.kids]);
			return D(`${l.t} ${opWord} ${r.t}`, [...l.kids, ...r.kids]);
		}
		if (/^(===|!==|==|!=|<|>|<=|>=|in|instanceof|&&|\|\|)$/.test(op)) return this.wrap(this.cond(n), (t) => `whether ${t}`);
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
		const c = this.cond(n.test);
		const a = this.noun(n.consequent);
		const b = this.noun(n.alternate);
		if (isNullish(n.consequent) && !c.kids.length) return D(`nothing if ${c.t}; otherwise ${b.t}`, b.kids);
		const emptyish = (x: N) => {
			const u = unwrap(x);
			return isNullish(u) || (u.type === "ArrayExpression" && !u.elements.length) || (u.type === "ObjectExpression" && !u.properties.length);
		};
		if (emptyish(n.alternate) && !c.kids.length && a.kids.length) return D(`${a.t} if ${c.t} (otherwise ${b.t})`, a.kids);
		if (isNullish(n.alternate) && !c.kids.length) {
			if (a.kids.length) return D(`(only if ${c.t}) ${a.t}`, a.kids);
			return D(`${a.t} if ${c.t} (otherwise nothing)`, a.kids);
		}
		const inline = `${a.t} if ${c.t}, otherwise ${b.t}`;
		const short = (x: N) => ["Literal", "Identifier", "TemplateLiteral"].includes(unwrap(x)?.type);
		if ((vlen(inline) <= 130 || (short(n.consequent) && short(n.alternate) && vlen(inline) <= 140)) && !c.kids.length && !a.kids.length && !b.kids.length)
			return D(inline);
		const kids: Line[] = [];
		kids.push(...this.bullet(D(`if so: ${a.t}`, a.kids)));
		kids.push(...this.bullet(D(`if not: ${b.t}`, b.kids)));
		if (c.kids.length) return D(`depending on whether ${c.t}`, [...c.kids, ...kids]);
		return D(`depending on whether ${c.t}:`, kids);
	}

	assign(n: N): Doc {
		const target = this.noun(n.left);
		const v = this.noun(n.right);
		const r = unwrap(n.right);
		const fname = r?.type === "CallExpression" ? calleeName(r) : null;
		if (n.operator === "=" && fname && this.lex.startsWithVerb(fname) && !this.lex.converterParts(fname) && !this.applyRulesQuiet(r)) {
			const call = this.call(r, true);
			return D(`${call.t}, and put the result in ${target.t}`, call.kids);
		}
		switch (n.operator) {
			case "=":
				return D(`set ${target.t} to ${v.t}`, v.kids);
			case "+=":
				return D(`add ${v.t} to ${target.t}`, v.kids);
			case "-=":
				return D(`subtract ${v.t} from ${target.t}`, v.kids);
			case "*=":
				return D(`multiply ${target.t} by ${v.t}`, v.kids);
			case "??=":
				return D(`if ${target.t} is missing, set it to ${v.t}`, v.kids);
			case "||=":
				return D(`if ${target.t} is empty, set it to ${v.t}`, v.kids);
			case "&&=":
				return D(`if ${target.t} is set, replace it with ${v.t}`, v.kids);
			default:
				return D(this.raw(n));
		}
	}

	jsx(n: N): Doc {
		if (n.type === "JSXFragment") return this.jsxChildren(n.children, "a group of");
		const name = this.code(n.openingElement.name);
		const tag = mk("f", `<${name}>`, name);
		const attrs: string[] = [];
		const attrKids: Line[] = [];
		for (const a of n.openingElement.attributes) {
			if (a.type === "JSXSpreadAttribute") {
				attrs.push(`everything in ${this.noun(a.argument).t}`);
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
					v = body ? (unwrap(body).type === "CallExpression" ? this.call(unwrap(body), true) : this.noun(body)) : D("these steps", this.body(ex.body, 0));
				} else v = this.noun(ex);
			} else v = this.noun(a.value);
			if (v.kids.length) {
				attrKids.push(...this.bullet(D(`${label}: ${v.t}`, v.kids)));
				continue;
			}
			attrs.push(plain(v.t) === this.lex.humanize(key) ? label : `${label}: ${v.t}`);
		}
		const head = `${tag}${attrs.length ? ` (${attrs.join("; ")})` : ""}`;
		const kids = this.jsxChildren(n.children, head);
		return D(kids.t, [...attrKids, ...kids.kids]);
	}

	jsxChildren(children: N[], head: string): Doc {
		const items: Doc[] = [];
		for (const c of children) {
			if (c.type === "JSXText") {
				const t = c.value.replace(/\s+/g, " ").trim();
				if (t) items.push(D(`the text ${mk("l", `"${t}"`)}`));
				continue;
			}
			if (c.type === "JSXExpressionContainer") {
				const ex = unwrap(c.expression);
				if (!ex || ex.type === "JSXEmptyExpression") continue;
				if (ex.type === "LogicalExpression" && ex.operator === "&&") {
					const cnd = this.cond(ex.left);
					const r = this.noun(ex.right);
					items.push(D(`only if ${cnd.t}: ${r.t}`, [...cnd.kids, ...r.kids]));
					continue;
				}
				items.push(this.noun(ex));
				continue;
			}
			items.push(this.noun(c));
		}
		if (!items.length) return D(head);
		if (items.length === 1 && !items[0]!.kids.length && vlen(items[0]!.t) < 60) return D(`${head} showing ${items[0]!.t}`);
		return D(
			`${head} containing`,
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
		if (!p) return "item";
		const name = this.paramName(p);
		if (name) return this.ref(name);
		return "item";
	}

	isDestructured(fn: N) {
		return fn.params[0]?.type === "ObjectPattern";
	}

	lambdaNoun(n: N): Doc {
		const ex = this.lambdaExpr(n);
		const given = this.givenText(n.params);
		if (ex) {
			const b = this.looksBoolean(ex) ? this.wrap(this.cond(ex), (t) => `whether ${t}`) : this.noun(ex);
			return D(`a function${given} giving back ${b.t}`, b.kids);
		}
		return D(`a function${given} that:`, this.body(n.body, 0));
	}

	givenText(params: N[]): string {
		const ps = params.flatMap((p: N) => this.patternNames(p)).filter((x) => x);
		return ps.length ? ` of ${listJoin(ps)}` : "";
	}

	patternNames(p: N, withTypes = false): string[] {
		if (!p) return [];
		if (p.type === "TSParameterProperty") return this.patternNames(p.parameter, withTypes);
		if (p.type === "Identifier") {
			if (this.ambient.has(p.name)) return [];
			const t = withTypes ? this.varTypes.get(p.name) : undefined;
			const typeName = t?.startsWith("@") ? null : t;
			return [`${this.ref(p.name)}${typeName ? ` ${mk("t", typeName, typeName)}` : ""}`];
		}
		if (p.type === "AssignmentPattern") {
			const inner = this.patternNames(p.left, withTypes);
			const def = unwrap(p.right);
			if (inner.length === 1 && def && !(def.type === "ObjectExpression" && !def.properties.length)) return [`${inner[0]} (default ${this.noun(def).t})`];
			return inner;
		}
		if (p.type === "RestElement") return this.patternNames(p.argument).map((x) => `any other ${x}`);
		if (p.type === "ObjectPattern")
			return p.properties.flatMap((x: N) => {
				if (x.type === "RestElement") return this.patternNames(x.argument).map((y) => `the rest as ${y}`);
				const key = x.key?.name;
				if (key && this.ambient.has(key)) return [];
				const v = x.value;
				if (v?.type === "Identifier" && key && this.lex.humanize(v.name) !== this.lex.humanize(key))
					return [`${mk("v", this.lex.humanize(key), key)} (as ${this.ref(v.name)})`];
				return this.patternNames(v, withTypes);
			});
		if (p.type === "ArrayPattern") return p.elements.filter(Boolean).flatMap((x: N) => this.patternNames(x));
		return [this.raw(p)];
	}

	// ---------- calls ----------

	ruleFor(table: Record<string, any[]>, n: N): { rule: any; obj: N | null }[] {
		const c = unwrap(n.callee);
		const pre = n.type === "NewExpression" ? "new " : "";
		const out: { rule: any; obj: N | null }[] = [];
		const add = (key: string, obj: N | null) => {
			for (const rule of table[key] ?? []) out.push({ rule, obj });
		};
		if (c.type === "Identifier") add(pre + c.name, null);
		else if (c.type === "MemberExpression" && !c.computed) {
			const obj = unwrap(c.object);
			const m = c.property.name;
			if (obj.type === "Identifier") {
				add(`${pre}${obj.name}.${m}`, obj);
				add(`${pre}${obj.name}.*`, obj);
			}
			if (obj.type === "MemberExpression" && !obj.computed) add(`*.${obj.property.name}.${m}`, obj);
			add(`*.${m}`, c.object);
		}
		return out;
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
			return D(`set up the parent class${a.t}`, a.kids);
		}
		const callee = this.noun(c);
		const a = this.argList(n.arguments);
		return D(`${stmt ? "run" : "the result of"} ${callee.t}${a.t}`, [...callee.kids, ...a.kids]);
	}

	/** `cusProductToPrices({ cusProduct })` -> "the prices of customer product". */
	namedCall(name: string, args: N[], stmt: boolean, owner: string | null): Doc {
		const conv = this.lex.converterParts(name);
		const via = owner ? ` ${mk("c", `[${owner}]`)}` : "";
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
						? this.argList(args, new Set([subj.key!]))
						: this.argList(args.filter((a) => unwrap(a) !== subj.node));
				return D(`the ${target} of ${subj.text.t}${via}${rest.t ? (rest.t === ":" ? ", given:" : ` (given ${rest.t.slice(2, -1)})`) : ""}`, [
					...subj.text.kids,
					...rest.kids,
				]);
			}
			const a = this.argList(args);
			return D(`the ${target} of ${this.fnRef(name, this.lex.display(from))}${via}${a.t}`, a.kids);
		}
		if (this.lex.isPredicateName(name)) return this.wrap(this.predicateCall(name, args, false, owner), (t) => (stmt ? `check whether ${t}` : `whether ${t}`));
		const words = this.lex.humanize(name);
		const a = this.argList(args);
		if (this.lex.startsWithVerb(name) || this.localFns.has(name)) return D(`${this.fnRef(name, words)}${via}${a.t}`, a.kids);
		if (stmt && this.lex.words(name)[0] === "on") return D(`trigger ${this.fnRef(name, words)}${via}${a.t}`, a.kids);
		if (stmt && this.lex.words(name).length > 1) return D(`${this.fnRef(name, words)}${via}${a.t}`, a.kids);
		if (stmt) return D(`run ${this.fnRef(name, words)}${via}${a.t}`, a.kids);
		const lastWord = words.split(" ").at(-1)!;
		if (/^(of|for|from|by|in|on|at)$/.test(lastWord) && !stmt) {
			const inner = this.argPairs(args).map((p) => p.text.t);
			return D(`the ${this.fnRef(name, words)} ${listJoin(inner)}${via}`);
		}
		const det = /^[A-Z]/.test(name) || this.lex.words(name).length === 1 ? "the result of " : this.g.isPlural(lastWord) ? "" : `${this.g.article(words)} `;
		return D(`${det}${this.fnRef(name, words)}${via}${a.t}`, a.kids);
	}

	methodCall(objNode: N, method: string, args: N[], stmt: boolean): Doc {
		const obj = this.noun(objNode);
		const a = this.argList(args);
		const objAmb = this.isAmbient(objNode);
		const m = mk("f", this.lex.humanize(method), "");
		if (this.lex.isPredicateName(method)) {
			return D(`${stmt ? "check whether " : "whether "}${objAmb ? "" : `${obj.t} `}${this.predicatePhrase(method, false)}${a.t}`, [...obj.kids, ...a.kids]);
		}
		if (this.lex.startsWithVerb(method)) {
			const w = this.lex.words(method);
			const verb = mk("f", this.lex.display(w.slice(0, 1)), "");
			const rest = w.length > 1 ? ` ${mk("f", this.lex.display(w.slice(1)), "")}` : "";
			const target = objAmb ? "" : ` ${obj.t}`;
			return D(`${verb}${target}${rest}${a.t}`, [...obj.kids, ...a.kids]);
		}
		if (stmt && this.lex.words(method).length > 1 && this.lex.words(method)[0] !== "on") {
			const w = this.lex.words(method);
			return D(`${mk("f", this.lex.display(w.slice(0, 1)), "")}${objAmb ? "" : ` ${obj.t}`} ${mk("f", this.lex.display(w.slice(1)), "")}${a.t}`, [
				...obj.kids,
				...a.kids,
			]);
		}
		return D(`${stmt ? (this.lex.words(method)[0] === "on" ? "trigger " : "run ") : ""}${objAmb ? "" : `${this.g.possessive(obj.t)} `}${m}${a.t}`, [
			...obj.kids,
			...a.kids,
		]);
	}

	newExpr(n: N): Doc {
		const ruled = this.applyRules(this.calls, n, { stmt: false });
		if (ruled) return ruled;
		const name = unwrap(n.callee).type === "Identifier" ? unwrap(n.callee).name : null;
		if (name && this.isErrorCtor(name)) return this.errorDoc(n);
		const callee = name ? this.fnRef(name, this.lex.humanize(name)) : this.noun(n.callee).t;
		const a = this.argList(n.arguments);
		return D(`a new ${callee}${a.t}`, a.kids);
	}

	errorDoc(n: N): Doc {
		const name = unwrap(n.callee).name as string;
		const words = this.lex.humanize(name);
		const label = this.errorLabels[name]
			? this.fnRef(name, this.errorLabels[name])
			: name === "Error"
				? "an error"
				: this.fnRef(name, `${this.g.article(words)} ${words}`);
		const first = unwrap(n.arguments[0]);
		let msg: Doc | null = null;
		let extra = "";
		if (first?.type === "ObjectExpression") {
			const mp = first.properties.find((p: N) => p.key?.name === "message");
			if (mp) msg = this.noun(mp.value);
			const cp = first.properties.find((p: N) => p.key?.name === "code");
			if (cp) extra = ` [${this.noun(cp.value).t}]`;
			const sc = first.properties.find((p: N) => p.key?.name === "statusCode");
			if (sc) extra += ` (status ${this.noun(sc.value).t})`;
		} else if (first) msg = this.noun(first);
		if (name === "Error") return D(msg ? `an error: ${msg.t}` : "an error", msg?.kids ?? []);
		return D(`${label}${msg ? `: ${msg.t}` : ""}${extra}`, msg?.kids ?? []);
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
		const f = this.fnRef(name, phrase);
		const rest = pairs.filter((_, i) => i !== si);
		const restText = rest.length
			? ` (given ${listJoin(rest.map((r) => (r.key && plain(r.text.t) !== this.lex.humanize(r.key) ? `${mk("v", this.lex.humanize(r.key), r.key)}: ${r.text.t}` : r.text.t)))})`
			: "";
		const via = owner ? ` ${mk("c", `[${owner}]`)}` : "";
		return D(`${subj ? `${subj.text.t} ` : ""}${f}${via}${restText}`, [...(subj?.text.kids ?? []), ...rest.flatMap((r) => r.text.kids)]);
	}

	// ---------- conditions ----------

	cond(node: N, neg = false): Doc {
		const n = unwrap(node);
		if (!n) return D(neg ? "false" : "true");
		if (n.type === "UnaryExpression" && n.operator === "!") return this.cond(n.argument, !neg);
		if (n.type === "ConditionalExpression") {
			const t = this.cond(n.test);
			const a = this.cond(n.consequent, neg);
			if (isNullish(n.alternate)) return D(`${a.t} (only checked when ${t.t})`, [...t.kids, ...a.kids]);
			const b = this.cond(n.alternate, neg);
			return D(`if ${t.t}, ${a.t}; otherwise ${b.t}`, [...t.kids, ...a.kids, ...b.kids]);
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
					return D(`${this.lex.display(w.slice(0, vi))} ${this.fnRef(c.name, verb)}${rest.length ? ` (given ${listJoin(rest.map((r) => r.text.t))})` : ""}`);
				}
			}
			if (c.type === "MemberExpression" && !c.computed && this.lex.isPredicateName(c.property.name)) {
				const obj = unwrap(c.object);
				if (obj.type === "Identifier" && /^[A-Z]/.test(obj.name)) return this.predicateCall(c.property.name, n.arguments, neg, obj.name);
				const o = this.noun(c.object);
				const a = this.argList(n.arguments);
				return D(`${this.isAmbient(c.object) ? "" : `${o.t} `}${this.fnRef(c.property.name, this.predicatePhrase(c.property.name, neg))}${a.t}`, [
					...o.kids,
					...a.kids,
				]);
			}
			const call = this.call(n, false);
			if (/^whether /.test(plain(call.t))) return D(neg ? `not ${call.t.replace(/whether /, "")}` : call.t.replace(/whether /, ""), call.kids);
			if (/^(the|a|an) /.test(plain(call.t))) {
				const rest = call.t.replace(/^(the|a|an) /, "");
				return D(neg ? `there is no ${rest}` : `there is ${this.g.article(plain(rest))} ${rest}`, call.kids);
			}
			return D(`${call.t} ${neg ? "gives back nothing" : "gives back something"}`, call.kids);
		}
		if (n.type === "Identifier") {
			if (this.isBoolName(n.name)) {
				const aux = /^(is|has|have|can|should|was|were|did|does|will|needs|must|are|had)$/.test(this.lex.words(n.name)[0]!);
				if (this.lex.isPredicateName(n.name) && aux) return D(this.aliases.get(n.name) ?? mk("v", this.predicatePhrase(n.name, neg), n.name));
				return D(`${this.ref(n.name)} is ${neg ? "false" : "true"}`);
			}
			return D(`${this.ref(n.name)} ${neg ? "is missing" : "is set"}`);
		}
		if (n.type === "MemberExpression") {
			const { root, steps } = this.chain(n);
			const last = steps.at(-1)!;
			if (last.name === "length") {
				const inner = this.memberFrom(root, steps.slice(0, -1));
				return D(`${inner.t} ${neg ? "is empty" : "is not empty"}`, inner.kids);
			}
			if (last.name && this.lex.isPredicateName(last.name)) {
				const inner = steps.length > 1 || !this.isAmbient(root) ? this.memberFrom(root, steps.slice(0, -1)) : D("it");
				return D(`${inner.t} ${mk("v", this.predicatePhrase(last.name, neg), last.name)}`, inner.kids);
			}
			const m = this.member(n);
			if (last.name && this.bools.has(last.name)) return D(`${m.t} is ${neg ? "false" : "true"}`, m.kids);
			return D(`${m.t} ${neg ? "is missing" : "is set"}`, m.kids);
		}
		if (n.type === "Literal" && typeof n.value === "boolean") return D(String(n.value !== neg));
		if (n.type === "AssignmentExpression") {
			const a = this.assign(n);
			return D(`(after we ${a.t}) the result ${neg ? "is missing" : "is set"}`, a.kids);
		}
		const v = this.noun(n);
		return D(`${v.t} ${neg ? "is missing" : "is set"}`, v.kids);
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
		const joined = listJoin(
			items.map((i) => i.t),
			isAnd ? "and" : "or",
		);
		if (!nested && items.length <= 3 && vlen(joined) <= 95 && items.every((i) => !i.kids.length)) return D(joined);
		return D(
			isAnd ? "all of these are true:" : "any of these is true:",
			items.flatMap((i) => this.bullet(i)),
		);
	}

	compare(n: N, neg: boolean): Doc | null {
		let op: string = n.operator;
		let L = unwrap(n.left);
		let R = unwrap(n.right);
		if (isNullish(L) && !isNullish(R)) [L, R] = [R, L];
		const eqOps: Record<string, string> = { "===": "==", "==": "==", "!==": "!=", "!=": "!=" };
		if (eqOps[op]) {
			let eq = eqOps[op] === "==";
			if (neg) eq = !eq;
			if (isNullish(R)) return this.wrap(this.noun(L), (t) => `${t} ${eq ? "is missing" : "is set"}`);
			if (L.type === "UnaryExpression" && L.operator === "typeof" && R.type === "Literal") {
				const typ: Record<string, string> = {
					string: "text",
					number: "a number",
					boolean: "true/false",
					object: "an object",
					function: "a function",
					undefined: "missing",
					bigint: "a big number",
					symbol: "a symbol",
				};
				return this.wrap(this.noun(L.argument), (t) => `${t} ${eq ? "is" : "is not"} ${typ[R.value] ?? R.value}`);
			}
			if (L.type === "MemberExpression" && !L.computed && L.property.name === "length" && R.type === "Literal" && R.value === 0) {
				const inner = this.noun(L.object);
				return D(`${inner.t} ${eq ? "is empty" : "is not empty"}`, inner.kids);
			}
			if (R.type === "Literal" && typeof R.value === "boolean") return this.cond(L, eq ? !R.value : R.value);
			if (this.looksBoolean(L) && this.looksBoolean(R)) {
				const lc = this.cond(L);
				const rc = this.cond(R);
				return D(`(${lc.t}) ${eq ? "is the same as" : "differs from"} (${rc.t})`, [...lc.kids, ...rc.kids]);
			}
			const l = this.noun(L);
			const r = this.noun(R);
			return D(`${l.t} ${eq ? "is" : "is not"} ${r.t}`, [...l.kids, ...r.kids]);
		}
		const rel: Record<string, [string, string, string]> = {
			"<": [">=", "is less than", "is before"],
			">": ["<=", "is more than", "is after"],
			"<=": [">", "is at most", "is at or before"],
			">=": ["<", "is at least", "is at or after"],
		};
		if (rel[op]) {
			if (neg) op = rel[op]![0];
			if (L.type === "MemberExpression" && !L.computed && L.property.name === "length" && R.type === "Literal") {
				const inner = this.noun(L.object);
				if ((op === ">" && R.value === 0) || (op === ">=" && R.value === 1)) return D(`${inner.t} is not empty`, inner.kids);
				if ((op === "<" && R.value === 1) || (op === "<=" && R.value === 0)) return D(`${inner.t} is empty`, inner.kids);
				const word = { "<": "fewer than", ">": "more than", "<=": "at most", ">=": "at least" }[op];
				return D(`${inner.t} has ${word} ${R.value} item${R.value === 1 ? "" : "s"}`, inner.kids);
			}
			const l = this.noun(L);
			const r = this.noun(R);
			const timey = this.lex.looksLikeTime(plain(l.t)) || this.lex.looksLikeTime(plain(r.t));
			if (!timey && R.type === "Literal" && R.value === 0) {
				const z = { ">": "is positive", "<": "is negative", ">=": "is zero or more", "<=": "is zero or less" }[op];
				return D(`${l.t} ${z}`, l.kids);
			}
			return D(`${l.t} ${rel[op]![timey ? 2 : 1]} ${r.t}`, [...l.kids, ...r.kids]);
		}
		if (op === "instanceof") {
			const l = this.noun(L);
			const name = R.type === "Identifier" ? R.name : this.code(R);
			return D(`${l.t} ${neg ? "is not" : "is"} ${this.g.article(this.lex.humanize(name))} ${this.fnRef(name, this.lex.humanize(name))}`, l.kids);
		}
		if (op === "in") {
			const k = this.noun(L);
			const o = this.noun(R);
			return D(`${o.t} ${neg ? "has no" : "has a"} ${k.t} key`, [...k.kids, ...o.kids]);
		}
		return null;
	}

	// ---------- statements ----------

	lines: Line[] = [];

	emit(d: number, text: string, n: N | null, kind: LineKind = "stmt") {
		this.lines.push({ d, text, start: n?.start ?? -1, end: n?.end ?? -1, kind });
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
		if (!stmts.length) this.emit(d, "Do nothing.", n, "note");
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
		this.lines.push({ d, text: `“${text}”`, start: c0.start, end: this.comments[group.at(-1)!]!.end, kind: "note" });
	}

	stmt(n: N, d: number): void {
		this.leadingComments(n, d);
		for (const r of this.stmtRules) if (r({ node: n, e: this, d })) return;
		switch (n.type) {
			case "ExportNamedDeclaration":
				if (n.declaration) return this.stmt(n.declaration, d);
				return;
			case "ExportDefaultDeclaration": {
				const decl = n.declaration;
				if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") return this.stmt(decl, d);
				if (isFn(decl)) return this.fnDecl(decl.id?.name ?? "default export", decl, n, d);
				return this.emitDoc(
					d,
					this.wrap(this.noun(decl), (t) => `export ${t} as the default`),
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
				return this.emit(d, `Type ${mk("t", n.id.name, n.id.name)}: ${this.typeText(n.typeAnnotation, true)}.`, n, "note");
			case "TSInterfaceDeclaration":
				return this.emit(d, `Type ${mk("t", n.id.name, n.id.name)}: ${this.typeMembers(n.body.body)}.`, n, "note");
			case "TSEnumDeclaration": {
				const members = (n.body?.members ?? n.members ?? []).map((m: N) => m.id.name ?? m.id.value);
				return this.emit(d, `Enum ${mk("f", n.id.name, n.id.name)}: ${listJoin(members)}.`, n, "note");
			}
			case "FunctionDeclaration":
				return this.fnDecl(n.id?.name ?? "anonymous", n, n, d);
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
				this.emitDoc(d, D(`For each key ${listJoin(v)} in ${o.t}:`, o.kids), n);
				return this.block(n.body, d + 1);
			}
			case "ForStatement":
				return this.forStmt(n, d);
			case "WhileStatement": {
				const u = unwrap(n.test);
				if (u.type === "Literal" && u.value === true) this.emit(d, "Keep repeating (until something stops it):", n);
				else {
					const c = this.cond(n.test);
					this.emitDoc(d, D(c.kids.length ? "Keep repeating while all of this holds:" : `Keep repeating while ${c.t}:`, c.kids), n);
				}
				return this.block(n.body, d + 1);
			}
			case "DoWhileStatement": {
				const c = this.cond(n.test);
				this.emit(d, "Do the following at least once:", n);
				this.block(n.body, d + 1);
				return this.emitDoc(d, D(`…and keep repeating while ${c.t}`, c.kids), n.test);
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
				return this.emit(d, "Move on to the next one.", n);
			case "BreakStatement":
				return this.emit(d, "Stop the loop.", n);
			default:
				return this.emit(d, `${this.raw(n)}`, n, "raw");
		}
	}

	exprStmt(expr: N, d: number, n: N): void {
		const u = unwrap(expr);
		if (u.type === "CallExpression") {
			const name = calleeName(u);
			const c = unwrap(u.callee);
			if (name === "forEach" && c.type === "MemberExpression" && isFn(u.arguments[0])) {
				const fn = unwrap(u.arguments[0]);
				const coll = this.noun(c.object);
				this.emitDoc(d, D(`For each ${listJoin(fn.params.slice(0, 1).flatMap((p: N) => this.patternNames(p)))} in ${coll.t}:`, coll.kids), n);
				const ex = fn.body.type === "BlockStatement" ? null : fn.body;
				if (ex) return this.exprStmt(ex, d + 1, ex);
				return this.block(fn.body, d + 1);
			}
			return this.emitDoc(d, this.call(u, true), n);
		}
		if (u.type === "AssignmentExpression") return this.emitDoc(d, this.assign(u), n);
		if (u.type === "UpdateExpression") return this.emitDoc(d, this.noun(u), n);
		if (u.type === "LogicalExpression" && u.operator === "&&") {
			const c = this.cond(u.left);
			const r = unwrap(u.right).type === "CallExpression" ? this.call(unwrap(u.right), true) : this.noun(u.right);
			return this.emitDoc(d, D(`If ${c.t}, ${r.t}`, [...c.kids, ...r.kids]), n);
		}
		if (u.type === "Literal" && typeof u.value === "string") return;
		return this.emitDoc(d, this.noun(u), n);
	}

	declarator(v: N, kind: string, d: number, n: N) {
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
			if (!init) return this.emit(d, `Start with no ${name} yet.`, n);
			if (this.looksBoolean(init) || (init.type === "LogicalExpression" && this.isBoolName(id.name))) {
				this.bools.add(id.name);
				const c = this.cond(init);
				if (c.kids.length) return this.emitDoc(d, D(`Let ${name} mean ${c.t}`, c.kids), n);
				return this.emitDoc(d, D(`Let ${name} mean ${c.t}`), n);
			}
			if (init.type === "CallExpression") {
				const fname = calleeName(init);
				const verbal = fname && (this.lex.startsWithVerb(fname) || this.localFns.has(fname)) && !this.lex.converterParts(fname) && !this.applyRulesQuiet(init);
				if (verbal) {
					const call = this.call(init, true);
					const vw = this.lex.words(id.name);
					const fw = this.lex.words(fname);
					const subsumed = vw.length && fw.slice(-vw.length).join(" ") === vw.join(" ");
					if (subsumed) return this.emitDoc(d, D(`${call.t.replace(/:$/, "")} → ${name}${call.t.endsWith(":") ? ":" : ""}`, call.kids), n);
					return this.emitDoc(d, D(`${call.t.replace(/:$/, "")}, and call the result ${name}${call.t.endsWith(":") ? ":" : ""}`, call.kids), n);
				}
			}
			const val = this.noun(init);
			if (kind === "let") return this.emitDoc(d, D(`Let ${name} start as ${val.t}`, val.kids), n);
			if (plain(val.t) === this.lex.humanize(id.name)) return;
			return this.emitDoc(d, D(`Let ${name} be ${val.t}`, val.kids), n);
		}
		if (id.type === "ObjectPattern") {
			const names = this.patternNames(id);
			if (!names.length) return;
			if (!init) return this.emit(d, `Declare ${listJoin(names)}.`, n);
			const fname = init.type === "CallExpression" ? calleeName(init) : null;
			if (fname && this.lex.startsWithVerb(fname) && !this.lex.converterParts(fname) && !this.applyRulesQuiet(init)) {
				const call = this.call(init, true);
				return this.emitDoc(d, D(`${call.t.replace(/:$/, "")}, and take its ${listJoin(names)}${call.t.endsWith(":") ? ":" : ""}`, call.kids), n);
			}
			const val = this.noun(init);
			const colon = val.t.endsWith(":");
			return this.emitDoc(d, D(`From ${val.t.replace(/:$/, "")}, take ${listJoin(names)}${colon ? ":" : ""}`, val.kids), n);
		}
		if (id.type === "ArrayPattern") {
			const names = id.elements.map((e: N) => (e ? listJoin(this.patternNames(e)) : "(skip)"));
			if (init?.type === "CallExpression" && calleeName(init) === "all" && unwrap(init.arguments[0])?.type === "ArrayExpression") {
				this.emit(d, "Do these at the same time:", n);
				unwrap(init.arguments[0]).elements.forEach((el: N, i: number) => {
					const x = unwrap(el).type === "CallExpression" ? this.call(unwrap(el), true) : this.noun(el);
					this.emitDoc(
						d + 1,
						D(`• ${x.t.replace(/:$/, "")}${names[i] && names[i] !== "(skip)" ? ` → ${names[i]}` : ""}${x.t.endsWith(":") ? ":" : ""}`, x.kids),
						el,
						"",
						"bullet",
					);
				});
				return;
			}
			if (names.length === 1 && names[0] !== "(skip)" && init?.type === "CallExpression") {
				const call = this.call(init, true);
				return this.emitDoc(d, D(`${call.t}, and take the first result as ${names[0]}`, call.kids), n);
			}
			const val = init ? this.noun(init) : D("nothing");
			if (names.length === 1) return this.emitDoc(d, D(`Let ${names[0]} be the first of ${val.t}`, val.kids), n);
			return this.emitDoc(d, D(`Split ${val.t} into ${listJoin(names)}`, val.kids), n);
		}
		this.emit(d, this.raw(n), n, "raw");
	}

	fnTitle(name: string, fn: N): string {
		const conv = this.lex.converterParts(name);
		const words = this.lex.words(name);
		if (conv) return `${capFirst(this.lex.display(conv[0]))} → ${this.lex.display(conv[1])}`;
		if (this.lex.isPredicateName(name)) return `${capFirst(this.lex.display(words))}?`;
		if (/^[A-Z]/.test(name) && this.returnsJsx(fn)) return `${capFirst(this.lex.humanize(name))} (component)`;
		if (/^to[A-Z]/.test(name)) return `To turn into ${this.lex.humanize(name.slice(2))}`;
		if (this.lex.startsWithVerb(name) || this.localFns.has(name)) return `To ${this.lex.humanize(name)}`;
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
		const parts = [given.length ? `given ${listJoin(given)}` : null, ret && ret !== "nothing" ? `gives back ${ret}` : null].filter(Boolean);
		this.collectTypes(fn);
		this.emit(d, `${title}${parts.length ? ` — ${parts.join("; ")}` : ""}${fn.async ? " (async)" : ""}:`, n, "head");
		const ex = fn.body.type === "BlockStatement" ? null : fn.body;
		if (ex) this.returnLike(ex, d + 1, ex);
		else this.block(fn.body, d + 1);
	}

	classDecl(n: N, d: number) {
		const name = n.id?.name ?? "anonymous class";
		const ext = n.superClass ? ` (extends ${this.noun(n.superClass).t})` : "";
		this.emit(d, `Class ${mk("f", capFirst(this.lex.humanize(name)), name)}${ext}:`, n, "head");
		for (const m of n.body.body) {
			this.leadingComments(m, d + 1);
			if (m.type === "MethodDefinition" || m.type === "TSAbstractMethodDefinition") {
				if (!m.value?.body) continue;
				const mname = m.kind === "constructor" ? "when created" : (m.key.name ?? this.code(m.key));
				if (m.kind === "constructor") {
					const given = m.value.params.flatMap((p: N) => this.patternNames(p));
					this.emit(d + 1, `When created${given.length ? ` — given ${listJoin(given)}` : ""}:`, m, "head");
					this.block(m.value.body, d + 2);
				} else this.fnDecl(mname, m.value, m, d + 1);
			} else if (m.type === "PropertyDefinition") {
				const k = m.key.name ?? this.code(m.key);
				if (m.value && isFn(m.value)) this.fnDecl(k, unwrap(m.value), m, d + 1);
				else if (m.value)
					this.emitDoc(
						d + 1,
						this.wrap(this.noun(m.value), (t) => `Field ${mk("v", this.lex.humanize(k), k)} starts as ${t}`),
						m,
					);
				else this.emit(d + 1, `Field ${mk("v", this.lex.humanize(k), k)}.`, m, "note");
			}
		}
	}

	returnLike(ex: N, d: number, n: N): void {
		const u = unwrap(ex);
		if (isNullish(u)) return this.emit(d, "Give back nothing.", n);
		if (this.looksBoolean(u)) {
			const c = this.cond(u);
			return this.emitDoc(d, D(c.kids.length ? `Give back whether ${c.t}` : `Give back whether ${c.t}`, c.kids), n);
		}
		if (u.type === "CallExpression") {
			const name = calleeName(u);
			if (name && (this.lex.startsWithVerb(name) || this.localFns.has(name)) && !this.lex.converterParts(name) && !this.applyRulesQuiet(u)) {
				const call = this.call(u, true);
				return this.emitDoc(d, D(`${call.t.replace(/:$/, "")}, and give back the result${call.t.endsWith(":") ? ":" : ""}`, call.kids), n);
			}
		}
		if (u.type === "ConditionalExpression") {
			const c = this.cond(u.test);
			const a = this.noun(u.consequent);
			const b = this.noun(u.alternate);
			const inline = `Give back ${a.t} if ${c.t}, otherwise ${b.t}`;
			if (vlen(inline) <= 100 && !a.kids.length && !b.kids.length && !c.kids.length) return this.emit(d, `${inline}.`, n);
			this.emitDoc(d, D(c.kids.length ? "If all of this holds:" : `If ${c.t}:`, c.kids), u.test);
			this.returnLike(u.consequent, d + 1, u.consequent);
			this.emit(d, "Otherwise:", u.alternate);
			return this.returnLike(u.alternate, d + 1, u.alternate);
		}
		this.emitDoc(
			d,
			this.wrap(this.noun(u), (t) => `Give back ${t}`),
			n,
		);
	}

	returnStmt(n: N, d: number) {
		if (!n.argument) return this.emit(d, "Stop here.", n);
		return this.returnLike(n.argument, d, n);
	}

	throwStmt(n: N, d: number) {
		const a = unwrap(n.argument);
		if (a.type === "NewExpression")
			return this.emitDoc(
				d,
				this.wrap(this.newExpr(a), (t) => `Fail with ${t}`),
				n,
			);
		return this.emitDoc(
			d,
			this.wrap(this.noun(a), (t) => `Fail with ${t}`),
			n,
		);
	}

	/** One-liner form of a simple statement, for guard clauses. */
	inlineStmt(s: N, d: number): string | null {
		const lines = this.body(s, d);
		if (lines.length !== 1 || lines[0]!.text.endsWith(":")) return null;
		return lowerFirst(lines[0]!.text);
	}

	ifStmt(n: N, d: number) {
		const c = this.cond(n.test);
		const only = n.consequent.type === "BlockStatement" ? (n.consequent.body.length === 1 ? n.consequent.body[0] : null) : n.consequent;
		if (!n.alternate && only && !c.kids.length) {
			if (only.type === "ContinueStatement") return this.emit(d, capFirst(`skip it if ${c.t}.`), n);
			if (only.type === "BreakStatement") return this.emit(d, capFirst(`stop the loop if ${c.t}.`), n);
			const inline = this.inlineStmt(only, d);
			if (inline && vlen(inline) + vlen(c.t) < 120) return this.emit(d, `If ${c.t}, ${inline.replace(/^“.*”$/, "")}`, n);
		}
		if (c.kids.length) {
			this.emitDoc(d, D(`If ${c.t}`, c.kids), n.test);
			this.emit(d, "then:", n.consequent);
		} else this.emit(d, `If ${c.t}:`, n.test);
		this.block(n.consequent, d + 1);
		let alt = n.alternate;
		while (alt?.type === "IfStatement") {
			const c2 = this.cond(alt.test);
			if (c2.kids.length) {
				this.emitDoc(d, D(`Otherwise, if ${c2.t}`, c2.kids), alt.test);
				this.emit(d, "then:", alt.consequent);
			} else this.emit(d, `Otherwise, if ${c2.t}:`, alt.test);
			this.block(alt.consequent, d + 1);
			alt = alt.alternate;
		}
		if (alt) {
			this.emit(d, "Otherwise:", alt);
			this.block(alt, d + 1);
		}
	}

	forOf(n: N, d: number) {
		const pat = n.left.declarations?.[0]?.id ?? n.left;
		const right = unwrap(n.right);
		let label: string;
		let coll: Doc;
		if (pat.type === "ArrayPattern" && right.type === "CallExpression" && calleeName(right) === "entries") {
			const [k, v] = pat.elements.map((e: N) => (e ? listJoin(this.patternNames(e)) : null));
			const objNode = unwrap(right.callee).object;
			const isObjectEntries = unwrap(objNode)?.name === "Object";
			coll = this.noun(isObjectEntries ? right.arguments[0] : objNode);
			label = isObjectEntries ? `each key ${k}${v ? ` and value ${v}` : ""}` : `each ${v ?? "item"}${k ? ` (at position ${k})` : ""}`;
		} else {
			coll = this.noun(n.right);
			label = `each ${listJoin(this.patternNames(pat))}`;
		}
		this.emitDoc(d, D(`For ${label} in ${coll.t}${n.await ? " (as they arrive)" : ""}:`, coll.kids), n);
		this.block(n.body, d + 1);
	}

	forStmt(n: N, d: number) {
		const init = n.init?.declarations?.[0];
		const test = unwrap(n.test);
		const upd = unwrap(n.update);
		if (init?.id?.type === "Identifier" && test?.type === "BinaryExpression" && upd?.type === "UpdateExpression" && upd.operator === "++") {
			const i = this.ref(init.id.name);
			const start = this.noun(init.init);
			const R = unwrap(test.right);
			if (R.type === "MemberExpression" && !R.computed && R.property.name === "length" && plain(start.t) === "0") {
				this.emit(d, `For each position ${i} in ${this.noun(R.object).t}:`, n);
				return this.block(n.body, d + 1);
			}
			this.emit(d, `Count ${i} from ${start.t} while ${this.cond(test).t}:`, n);
			return this.block(n.body, d + 1);
		}
		const parts = [
			n.init && `start with ${unwrap(n.init).type === "VariableDeclaration" ? this.code(n.init) : this.noun(n.init).t}`,
			n.test && `repeat while ${this.cond(n.test).t}`,
			n.update && `then ${this.noun(n.update).t} each time`,
		].filter(Boolean);
		this.emit(d, `${capFirst(parts.join(", "))}:`, n);
		this.block(n.body, d + 1);
	}

	tryStmt(n: N, d: number) {
		this.emit(d, "Try the following:", n);
		this.block(n.block, d + 1);
		if (n.handler) {
			const p = n.handler.param ? listJoin(this.patternNames(n.handler.param)) : null;
			if (!n.handler.body.body.length) this.emit(d, "If anything fails, ignore it.", n.handler);
			else {
				this.emit(d, `If anything fails${p ? ` (call the problem ${p})` : ""}:`, n.handler);
				this.block(n.handler.body, d + 1);
			}
		}
		if (n.finalizer) {
			this.emit(d, "Either way, finally:", n.finalizer);
			this.block(n.finalizer, d + 1);
		}
	}

	switchStmt(n: N, d: number) {
		const disc = this.noun(n.discriminant);
		this.emitDoc(d, D(`Depending on ${disc.t}:`, disc.kids), n);
		let pending: string[] = [];
		for (const c of n.consequent ?? n.cases) {
			if (c.test) pending.push(this.noun(c.test).t);
			if (!c.consequent.length) continue;
			const label = c.test
				? `If it is ${listJoin(pending, "or")}:`
				: pending.length
					? `If it is ${listJoin(pending, "or")}, or anything else:`
					: "For anything else:";
			pending = [];
			this.emit(d + 1, `• ${label}`, c, "bullet");
			const stmts = c.consequent.length === 1 && c.consequent[0].type === "BlockStatement" ? c.consequent[0].body : c.consequent;
			for (const s of stmts) {
				if (s.type === "BreakStatement" && !s.label) continue;
				this.stmt(s, d + 2);
			}
		}
	}

	// ---------- types ----------

	typeText(t: N, top = false): string {
		if (!t) return "something";
		switch (t.type) {
			case "TSStringKeyword":
				return "text";
			case "TSNumberKeyword":
				return "a number";
			case "TSBooleanKeyword":
				return "true/false";
			case "TSVoidKeyword":
			case "TSUndefinedKeyword":
			case "TSNullKeyword":
			case "TSNeverKeyword":
				return "nothing";
			case "TSAnyKeyword":
			case "TSUnknownKeyword":
				return "anything";
			case "TSArrayType":
				return `a list of ${this.typeName(t.elementType)}`;
			case "TSTypeReference": {
				const name = this.code(t.typeName);
				const args = t.typeArguments?.params ?? t.typeParameters?.params ?? [];
				if (name === "Promise" && args[0]) return this.typeText(args[0], top);
				if (name === "Array" && args[0]) return `a list of ${this.typeName(args[0])}`;
				if (name === "Record" && args[1]) return `a lookup of ${this.typeName(args[0])} to ${this.typeName(args[1])}`;
				if (name === "Map" && args[1]) return `a map of ${this.typeName(args[0])} to ${this.typeName(args[1])}`;
				if (name === "Set" && args[0]) return `a set of ${this.typeName(args[0])}`;
				if ((name === "Partial" || name === "Pick" || name === "Omit" || name === "Readonly") && args[0]) return this.typeText(args[0]);
				return `${this.g.article(name)} ${mk("t", name, name)}`;
			}
			case "TSUnionType": {
				const parts = t.types.filter((x: N) => !/TSNullKeyword|TSUndefinedKeyword/.test(x.type));
				const optional = parts.length < t.types.length;
				if (parts.every((x: N) => x.type === "TSLiteralType"))
					return `one of ${listJoin(
						parts.map((x: N) => this.code(x)),
						"or",
					)}${optional ? " (or nothing)" : ""}`;
				return `${listJoin(
					parts.map((x: N) => this.typeText(x)),
					"or",
				)}${optional ? " (or nothing)" : ""}`;
			}
			case "TSLiteralType":
				return this.code(t);
			case "TSTypeLiteral":
				return top ? `an object with ${this.typeMembers(t.members)}` : "an object";
			case "TSFunctionType":
				return "a function";
			case "TSTupleType":
				return `a pair of ${listJoin(t.elementTypes.map((x: N) => this.typeName(x)))}`;
			case "TSParenthesizedType":
				return this.typeText(t.typeAnnotation, top);
			case "TSTypePredicate":
				return t.typeAnnotation ? `whether ${this.code(t.parameterName)} is ${this.typeText(t.typeAnnotation.typeAnnotation)}` : "true/false";
			default:
				return mk("c", this.code(t).slice(0, 40));
		}
	}

	typeName(t: N): string {
		if (t?.type === "TSTypeReference") {
			const n = this.code(t.typeName);
			return mk("t", n, n);
		}
		return this.typeText(t).replace(/^an? /, "");
	}

	typeMembers(members: N[]): string {
		const names = members.filter((m: N) => m.key).map((m: N) => `${this.lex.humanize(m.key.name ?? String(m.key.value))}${m.optional ? " (optional)" : ""}`);
		if (!names.length) return "an object";
		return listJoin(names);
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
		this.lines = [];
		this.bools = new Set();
		this.aliases = new Map();
		this.varTypes = new Map();
		this.localFns = new Set();
		this.usedComments = new Set();
		const lang = /\.(tsx|jsx)$/.test(filename) ? filename : filename.replace(/\.(m|c)?js$/, ".ts");
		const { program, errors, comments } = this.parse(lang, src);
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
		return { lines: this.lines, errors: errors.length };
	}
}
