import { D, mk } from "@usenarrator/core";
import { type CallRule, type CondRule, definePlugin, type Engine, type MemberRule, type N, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { en } from "./en";
import type { ValibotPhrases } from "./phrases";

export { en } from "./en";
export type { ValibotPhrases } from "./phrases";

type Say = ValibotPhrases;

/** The Valibot export a callee refers to: `v.string` with `import * as v`, or `string` with `import { string }`. */
function apiName(e: Engine, callee: N): string | null {
	const c = unwrap(callee);
	if (c?.type === "Identifier") {
		const imp = e.imports.get(c.name);
		return imp?.from === "valibot" && imp.name !== "*" && imp.name !== "default" ? imp.name : null;
	}
	if (c?.type === "MemberExpression" && !c.computed && unwrap(c.object)?.type === "Identifier") {
		const imp = e.imports.get(unwrap(c.object).name);
		return imp?.from === "valibot" && (imp.name === "*" || imp.name === "default") ? c.property.name : null;
	}
	return null;
}

const callOf = (e: Engine, n: N): { name: string; args: N[] } | null => {
	const u = unwrap(n);
	if (u?.type !== "CallExpression") return null;
	const name = apiName(e, u.callee);
	return name ? { name, args: u.arguments } : null;
};

const literalString = (n: N): string | null => {
	const u = unwrap(n);
	if (u?.type === "Literal" && typeof u.value === "string") return u.value;
	if (u?.type === "TemplateLiteral" && !u.expressions.length) return u.quasis[0].value.cooked;
	return null;
};

const elements = (n: N): N[] | null => (unwrap(n)?.type === "ArrayExpression" ? unwrap(n).elements.filter(Boolean) : null);

const BASES = new Set(["string", "number", "bigint", "boolean", "date", "any", "unknown", "nan", "symbol", "file", "blob", "never"]);
const BASE_ALIASES = new Map<string, keyof Say["base"]>([
	["null_", "null"],
	["null", "null"],
	["undefined", "undefined"],
	["void", "void"],
	["undefined_", "undefined"],
	["void_", "void"],
]);
const OBJECTS = new Set(["object", "strictObject", "looseObject"]);
const WRAPPERS = new Set(["optional", "exactOptional", "undefinedable", "nullable", "nullish", "nonOptional", "nonNullable", "nonNullish", "fallback"]);
const VALUE_MODS = new Set([
	"minLength",
	"maxLength",
	"length",
	"minValue",
	"maxValue",
	"gtValue",
	"ltValue",
	"value",
	"notValue",
	"multipleOf",
	"startsWith",
	"endsWith",
	"includes",
	"excludes",
	"minSize",
	"maxSize",
	"minWords",
	"maxWords",
	"mimeType",
]);
const FLAG_MODS = new Set([
	"nonEmpty",
	"integer",
	"finite",
	"safeInteger",
	"email",
	"rfcEmail",
	"url",
	"uuid",
	"ulid",
	"cuid2",
	"isoDate",
	"isoDateTime",
	"isoTimestamp",
	"ip",
	"ipv4",
	"ipv6",
	"hexColor",
	"emoji",
	"digits",
	"checkItems",
	"trim",
	"trimStart",
	"trimEnd",
	"toLowerCase",
	"toUpperCase",
	"transform",
	"rawTransform",
	"readonly",
]);
const FLAG_ALIASES = new Map<string, keyof Say["modifiers"]>([
	["rfcEmail", "email"],
	["ipv4", "ip"],
	["ipv6", "ip"],
	["trimStart", "trim"],
	["trimEnd", "trim"],
	["rawTransform", "transform"],
]);
const CONVERTERS = new Map<string, keyof Say["base"]>([
	["toNumber", "number"],
	["toString", "string"],
	["toDate", "date"],
	["toBoolean", "boolean"],
	["toBigint", "bigint"],
]);

/** The fields of an object schema's entries, linked by name. */
const fieldList = (e: Engine, o: N) =>
	e.g.list(
		unwrap(o).properties.map((p: N) =>
			p.type === "SpreadElement"
				? e.say.expressions.everythingIn({ value: e.text(p.argument) })
				: mk("v", e.lex.humanize(p.key?.name ?? String(p.key?.value)), p.key?.name),
		),
	);

/** A Valibot schema as a type phrase, e.g. `v.pipe(v.string(), v.email())` -> "text (an email)". */
export function describe(e: Engine, n: N, say: Say): string | null {
	const s = shape(e, n, say);
	return s && say.withModifiers(s);
}

type Shape = { type: string; modifiers: string[] };

/** A schema's base type and its modifiers, kept apart so wrappers and pipes can add to them. */
function shape(e: Engine, n: N, say: Say): Shape | null {
	const call = callOf(e, n);
	if (!call) return null;
	const { name, args } = call;
	const sub = (x: N) => describe(e, x, say) ?? e.text(x);
	const inner = (x: N): Shape => shape(e, x, say) ?? { type: e.text(x), modifiers: [] };
	const list = (x: N) => elements(x) ?? [x];
	const keyText = (x: N) => (literalString(x) !== null ? e.prop(literalString(x)!) : e.text(x));
	const plain = (type: string): Shape => ({ type, modifiers: [] });
	if (BASES.has(name)) return plain(say.base[name as keyof Say["base"]]);
	if (BASE_ALIASES.has(name)) return plain(say.base[BASE_ALIASES.get(name)!]);
	if (OBJECTS.has(name) || name === "objectWithRest") {
		const o = unwrap(args[0]);
		const fields = o?.type === "ObjectExpression" ? (o.properties.length ? fieldList(e, o) : null) : e.text(args[0]);
		if (fields === null) return plain(say.emptyObject);
		return plain(name === "objectWithRest" ? say.objectWithRest({ fields, rest: sub(args[1]) }) : say.object({ fields }));
	}
	if (name === "array") return plain(say.array({ item: sub(args[0]) }));
	if (["tuple", "strictTuple", "looseTuple", "tupleWithRest"].includes(name)) return plain(say.tuple({ items: e.g.list(list(args[0]).map(sub)) }));
	if (name === "set") return plain(say.set({ item: sub(args[0]) }));
	if (name === "map") return plain(say.map({ key: sub(args[0]), value: sub(args[1]) }));
	if (name === "picklist")
		return plain(
			say.picklist({
				options: elements(args[0])
					? e.g.list(
							elements(args[0])!.map((x) => e.text(x)),
							"or",
						)
					: e.text(args[0]),
			}),
		);
	if (name === "enum" || name === "enum_") return plain(say.enum({ name: e.text(args[0]) }));
	if (name === "literal") return plain(say.literal({ value: e.text(args[0]) }));
	if (name === "union") return plain(say.union({ options: e.g.list(list(args[0]).map(sub), "or") }));
	if (name === "variant") return plain(say.variant({ key: keyText(args[0]), options: e.g.list(list(args[1]).map(sub), "or") }));
	if (name === "intersect") return plain(say.intersect({ types: e.g.list(list(args[0]).map(sub)) }));
	if (name === "record") return plain(say.record({ key: sub(args[0]), value: sub(args[1]) }));
	if (name === "instance") return plain(say.instance({ name: e.text(args[0]) }));
	if (name === "partial" || name === "required") return plain(say[name]({ type: sub(args[0]) }));
	if (name === "pick" || name === "omit") return plain(say[name]({ type: sub(args[0]), keys: e.g.list(list(args[1]).map(keyText)) }));
	if (name === "custom") return plain(say.custom);
	if (name === "lazy") return plain(say.lazy);
	const m = say.modifiers;
	if (WRAPPERS.has(name)) {
		const s = inner(args[0]);
		const added: string[] = [];
		if (name === "optional" || name === "exactOptional" || name === "undefinedable") added.push(m.optional);
		else if (name === "nullable") added.push(m.nullable);
		else if (name === "nullish") added.push(m.nullish);
		else if (name.startsWith("non")) added.push(m.required);
		if (args[1]) added.push(name === "fallback" ? m.fallback({ value: e.text(args[1]) }) : m.default({ value: e.text(args[1]) }));
		return { type: s.type, modifiers: [...s.modifiers, ...added] };
	}
	if (name === "pipe" || name === "pipeAsync") {
		const s = inner(args[0]);
		const added = args.slice(1).flatMap((a: N) => modifier(e, a, say) ?? []);
		return { type: s.type, modifiers: [...s.modifiers, ...added] };
	}
	return null;
}

/** One pipe action: `v.minLength(3)` -> "at least 3 long". */
function modifier(e: Engine, n: N, say: Say): string | null {
	const call = callOf(e, n);
	const m = say.modifiers;
	if (!call) return null;
	const { name, args } = call;
	if (VALUE_MODS.has(name)) return (m[name as "minLength"] as (p: { value: string }) => string)({ value: e.text(args[0]) });
	if (FLAG_MODS.has(name)) return m[(FLAG_ALIASES.get(name) ?? name) as "email"] as string;
	if (name === "regex") return m.regex({ pattern: e.text(args[0]) });
	if (name === "check" || name === "checkAsync" || name === "rawCheck")
		return literalString(args[1]) !== null ? m.checkWith({ message: e.text(args[1]) }) : m.check;
	if (name === "transformAsync") return m.transform;
	if (CONVERTERS.has(name)) return m.convert({ type: say.base[CONVERTERS.get(name)!] });
	if (name === "brand") return m.brand({ name: e.text(args[0]) });
	if (name === "description" || name === "title") return m[name]({ text: e.text(args[0]) });
	if (name === "metadata") return null;
	if (name === "forward") return modifier(e, args[0], say);
	if (name === "partialCheck") return literalString(args[2]) !== null ? m.checkWith({ message: e.text(args[2]) }) : m.check;
	return m.other({ name: mk("f", e.lex.humanize(name), name) });
}

const SCHEMA_NAMES = [
	...BASES,
	...BASE_ALIASES.keys(),
	...OBJECTS,
	"objectWithRest",
	"array",
	"tuple",
	"strictTuple",
	"looseTuple",
	"tupleWithRest",
	"set",
	"map",
	"picklist",
	"enum",
	"enum_",
	"literal",
	"union",
	"variant",
	"intersect",
	"record",
	"instance",
	"partial",
	"required",
	"pick",
	"omit",
	"custom",
	"lazy",
	...WRAPPERS,
	"pipe",
	"pipeAsync",
];

/** Valibot (valibot.dev), v1: schemas, pipes and actions read like the Zod plugin; parse, safeParse, is, assert and parser. */
export const valibot = (): TsPlugin<Say> => {
	const schemaRule: CallRule<Say> = ({ node, e, say }) => {
		const t = describe(e, node, say);
		return t ? D(say.schema({ type: t })) : null;
	};
	/** `parse(Schema, input)` and friends; the schema is named by its variable or described inline. */
	const validateRule: CallRule<Say> = ({ node, e, say, stmt }) => {
		const call = callOf(e, node);
		if (!call) return null;
		const { name, args } = call;
		const v = say.validate;
		const async = name.endsWith("Async");
		const base = async ? name.slice(0, -5) : name;
		const schema = describe(e, args[0], say) ?? e.text(args[0]);
		const value = args[1] ? e.text(args[1]) : "";
		let t: string | null = null;
		if (base === "parse") t = stmt ? v.parseStep({ value, schema }) : v.parse({ value, schema });
		else if (base === "safeParse") t = v.safeParse({ value, schema });
		else if (base === "assert") t = v.assert({ value, schema });
		else if (base === "is") t = v.matches({ value, schema, neg: false });
		else if (base === "parser") t = v.parser({ schema });
		else if (base === "safeParser") t = v.safeParser({ schema });
		else if (base === "getDefault") t = v.getDefault({ schema });
		else if (base === "flatten") t = v.flatten({ issues: schema });
		else if (base === "summarize") t = v.summarize({ issues: schema });
		if (!t) return null;
		return D(async ? v.async({ text: t }) : t);
	};
	const isCond: CondRule<Say> = ({ node, e, say, neg }) => {
		const call = callOf(e, node);
		if (call?.name !== "is") return null;
		const schema = describe(e, call.args[0], say) ?? e.text(call.args[0]);
		return D(say.validate.matches({ value: e.text(call.args[1]), schema, neg }));
	};
	const VALIDATORS = [
		"parse",
		"parseAsync",
		"safeParse",
		"safeParseAsync",
		"assert",
		"is",
		"parser",
		"parserAsync",
		"safeParser",
		"safeParserAsync",
		"getDefault",
		"flatten",
		"summarize",
	];
	const calls: Record<string, CallRule<Say>> = {};
	for (const n of SCHEMA_NAMES) {
		calls[n] = schemaRule;
		calls[`*.${n}`] = schemaRule;
	}
	for (const n of VALIDATORS) {
		calls[n] = validateRule;
		calls[`*.${n}`] = validateRule;
	}
	const resultMember: MemberRule<Say> = ({ e, say, obj, prop }) => {
		const o = unwrap(obj);
		if (o?.type !== "Identifier" || !safeParseResults(e).has(o.name)) return null;
		const result = e.ref(o.name);
		return D(prop === "output" ? say.result.output({ result }) : say.result.issues({ result }));
	};
	return definePlugin<Say>({
		name: "valibot",
		library: { name: "valibot", versions: ">=1 <2" },
		phrases: { en },
		calls,
		conditions: { is: isCond, "*.is": isCond },
		members: { "*.output": resultMember, "*.issues": resultMember },
		describeSchema: describe,
	});
};

const resultCache = new WeakMap<object, Set<string>>();

/** Names this file binds to a `safeParse(...)` result. */
function safeParseResults(e: Engine): Set<string> {
	const program = e.program;
	if (!program) return new Set();
	const hit = resultCache.get(program);
	if (hit) return hit;
	const names = new Set<string>();
	const visit = (n: N) => {
		if (!n || typeof n !== "object") return;
		if (Array.isArray(n)) return n.forEach(visit);
		if (n.type === "VariableDeclarator" && n.id?.type === "Identifier" && /^safeParse(Async)?$/.test(callOf(e, n.init)?.name ?? "")) names.add(n.id.name);
		for (const k in n) if (n[k] && typeof n[k] === "object") visit(n[k]);
	};
	visit(program.body);
	resultCache.set(program, names);
	return names;
}
