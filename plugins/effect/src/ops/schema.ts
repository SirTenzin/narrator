import { D, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, calleeKey, curried, form, isFn, isObj, type Mode, make, memberKey, type OpTable, objProp } from "../context";
import type { EffectPhrases } from "../phrases";

type Types = EffectPhrases["schema"]["types"];

/** `Schema.X` members that name a type. Version-sensitive ones (`Date`, `BigInt`) are resolved in `typeOfMember`. */
const MEMBERS: Record<string, keyof Types> = {
	String: "string",
	Number: "number",
	Boolean: "boolean",
	BigIntFromSelf: "bigint",
	DateFromSelf: "date",
	ValidDateFromSelf: "date",
	DateValid: "date",
	Unknown: "unknown",
	Any: "unknown",
	Object: "unknown",
	Null: "null",
	Undefined: "undefined",
	Void: "void",
	Never: "never",
	UUID: "uuid",
	NonEmptyString: "nonEmptyString",
	NonEmptyTrimmedString: "nonEmptyString",
	Trim: "trimmed",
	Trimmed: "trimmed",
	Int: "int",
	Positive: "positive",
	Finite: "finite",
	NumberFromString: "numberFromString",
	FiniteFromString: "numberFromString",
	DateFromString: "dateFromString",
	BooleanFromString: "booleanFromString",
	URL: "url",
	URLFromSelf: "url",
};

function typeOfMember(c: Ctx, name: string): string | null {
	const t = c.say.schema.types;
	// v3 `Schema.Date` / `Schema.BigInt` decode from strings; in v4 they are the plain types.
	if (name === "Date") return c.version === 3 ? t.dateFromString : t.date;
	if (name === "BigInt") return t.bigint;
	const k = MEMBERS[name];
	return k ? t[k] : null;
}

/** v3 data-last filters and v4 `is*` checks, normalised to one name: `isMinLength` -> `minLength`. */
function check(c: Ctx, n: N): string | null {
	const k = c.say.schema.checks;
	const u = unwrap(n);
	const call = u?.type === "CallExpression";
	const key = call ? calleeKey(u) : memberKey(u);
	if (!key?.startsWith("Schema.")) return null;
	const raw = key.slice(7);
	const name = /^is[A-Z]/.test(raw) ? raw[2]!.toLowerCase() + raw.slice(3) : raw;
	const [a, b] = call ? u.arguments : [];
	const t = (x: N) => c.e.noun(x).t;
	switch (name) {
		case "minLength":
			return k.minLength({ n: t(a) });
		case "maxLength":
			return k.maxLength({ n: t(a) });
		case "length":
			return k.length({ n: t(a) });
		case "nonEmpty":
		case "nonEmptyString":
			return k.nonEmpty;
		case "int":
			return k.int;
		case "positive":
			return k.positive;
		case "negative":
			return k.negative;
		case "nonNegative":
			return k.nonNegative;
		case "nonPositive":
			return k.nonPositive;
		case "finite":
			return k.finite;
		case "between":
			if (isObj(a)) return k.between({ min: t(objProp(a, "minimum")), max: t(objProp(a, "maximum")) });
			return k.between({ min: t(a), max: t(b) });
		case "greaterThan":
			return k.greaterThan({ n: t(a) });
		case "greaterThanOrEqualTo":
			return k.atLeast({ n: t(a) });
		case "lessThan":
			return k.lessThan({ n: t(a) });
		case "lessThanOrEqualTo":
			return k.atMost({ n: t(a) });
		case "multipleOf":
			return k.multipleOf({ n: t(a) });
		case "pattern":
			return k.pattern({ pattern: t(a) });
		case "startsWith":
			return k.startsWith({ value: t(a) });
		case "endsWith":
			return k.endsWith({ value: t(a) });
		case "includes":
			return k.includes({ value: t(a) });
		case "trimmed":
			return k.trimmed;
		case "lowercased":
			return k.lowercased;
		case "uppercased":
			return k.uppercased;
		case "uUID":
		case "uuid":
			return k.uuid;
		case "minItems":
			return k.minItems({ n: t(a) });
		case "maxItems":
			return k.maxItems({ n: t(a) });
		case "brand":
			return k.brand({ name: t(a) });
		case "withDecodingDefault":
		case "withConstructorDefault":
			return k.defaultsTo({ value: isFn(a) ? c.e.noun(c.e.lambdaExpr(unwrap(a)) ?? a).t : t(a) });
		case "annotations":
		case "annotate":
			return "";
		case "filter":
		case "makeFilter":
		case "refine":
			return k.custom;
	}
	return null;
}

const withChecks = (c: Ctx, type: string, checks: string[]) => {
	const shown = checks.filter(Boolean);
	return shown.length ? c.say.schema.withChecks({ type, checks: c.e.g.list(shown) }) : type;
};

/** One struct field: `name (text)`, `age (a number, optional)`. */
function field(c: Ctx, p: N): string {
	if (p.type !== "Property") return c.e.noun(p).t;
	const key = p.key.name ?? String(p.key.value);
	const name = mk("v", c.e.lex.humanize(key), key);
	const v = unwrap(p.value);
	const k = calleeKey(v);
	if (k === "Schema.optional" || k === "Schema.optionalKey" || k === "Schema.optionalWith") {
		const inner = schemaType(c, v.arguments[0], false)!;
		const def = k === "Schema.optionalWith" ? objProp(v.arguments[1], "default") : null;
		const type = def ? withChecks(c, inner, [c.say.schema.checks.defaultsTo({ value: c.e.noun(c.e.lambdaExpr(unwrap(def)) ?? def).t })]) : inner;
		return c.say.data.optionalField({ name, type });
	}
	return c.say.data.field({ name, type: schemaType(c, v, false)! });
}

export const structFields = (c: Ctx, obj: N): string | null => {
	const u = unwrap(obj);
	if (u?.type !== "ObjectExpression") return null;
	return u.properties.length ? c.e.g.list(u.properties.map((p: N) => field(c, p))) : null;
};

/** A Schema expression as a type phrase ("an object with id (a number)"). `strict` returns null for non-schemas. */
export function schemaType(c: Ctx, n: N, strict: boolean): string | null {
	const s = c.say.schema;
	const u = unwrap(n);
	const loose = (x: N) => schemaType(c, x, false)!;
	const fallback = () => {
		if (strict) return null;
		if (u?.type === "Identifier" && /^[A-Z]/.test(u.name)) {
			const ref = c.e.ref(u.name);
			return `${c.e.g.article(c.e.lex.humanize(u.name))} ${ref}`;
		}
		return c.e.noun(u).t;
	};
	const bare = memberKey(u);
	if (bare?.startsWith("Schema.")) return typeOfMember(c, bare.slice(7)) ?? fallback();
	if (u?.type !== "CallExpression") return fallback();
	const callee = unwrap(u.callee);
	if (callee.type === "MemberExpression" && !callee.computed && ["pipe", "check", "annotations", "annotate"].includes(callee.property.name)) {
		const base = schemaType(c, callee.object, strict);
		if (base === null) return null;
		if (callee.property.name === "annotations" || callee.property.name === "annotate") return base;
		return withChecks(
			c,
			base,
			u.arguments.map((a: N) => check(c, a) ?? c.say.schema.checks.custom),
		);
	}
	const key = calleeKey(u);
	const args = u.arguments;
	const listed = (xs: N[], conj: "and" | "or") => c.e.g.list(xs.map(loose), conj);
	const spread = (xs: N[]) => (xs.length === 1 && unwrap(xs[0]).type === "ArrayExpression" ? unwrap(xs[0]).elements : xs);
	switch (key) {
		case "Schema.Struct":
			return structFields(c, args[0]) ? s.struct({ fields: structFields(c, args[0])! }) : s.emptyStruct;
		case "Schema.Array":
			return s.array({ item: loose(args[0]) });
		case "Schema.NonEmptyArray":
			return s.nonEmptyArray({ item: loose(args[0]) });
		case "Schema.Record": {
			const [k, v] = isObj(args[0]) ? [objProp(args[0], "key"), objProp(args[0], "value")] : args;
			return s.record({ key: loose(k), value: loose(v) });
		}
		case "Schema.Union":
			return s.union({ options: listed(spread(args), "or") });
		case "Schema.Literal":
		case "Schema.Literals": {
			const vals = spread(args);
			if (vals.length === 1) return s.literal({ value: c.e.noun(vals[0]).t });
			return s.literals({
				values: c.e.g.list(
					vals.map((x: N) => c.e.noun(x).t),
					"or",
				),
			});
		}
		case "Schema.NullOr":
		case "Schema.NullishOr":
			return s.nullOr({ type: loose(args[0]) });
		case "Schema.UndefinedOr":
		case "Schema.optional":
		case "Schema.optionalKey":
			return s.optional({ type: loose(args[0]) });
		case "Schema.Tuple":
			return s.tuple({ items: listed(spread(args), "and") });
		case "Schema.Enums":
			return s.enums({ name: c.e.noun(args[0]).t });
		case "Schema.TemplateLiteral":
			return c.say.schema.types.string;
	}
	return fallback();
}

type DecodeForm = "decode" | "decodeSync" | "decodeOutcome" | "decodePromise" | "encode";

/** `Schema.decodeUnknown(User)(input)`; with only the first call it's "a checker for a user". */
const decoder = (which: DecodeForm) =>
	curried((c, [schema], outer, mode: Mode) => {
		if (!schema) return null;
		const type = schemaType(c, schema, false)!;
		if (!outer?.[0]) return D(which === "encode" ? c.say.schema.encoder({ type }) : c.say.schema.decoder({ type }));
		const input = c.e.noun(outer[0]);
		return D(form(c.say.schema[which], mode, { input: input.t, type }), input.kids);
	});

const DECODERS: Record<string, DecodeForm> = {
	decodeUnknown: "decode",
	decode: "decode",
	validate: "decode",
	decodeUnknownEffect: "decode",
	decodeEffect: "decode",
	decodeUnknownSync: "decodeSync",
	decodeSync: "decodeSync",
	validateSync: "decodeSync",
	decodeUnknownEither: "decodeOutcome",
	decodeEither: "decodeOutcome",
	decodeUnknownResult: "decodeOutcome",
	decodeUnknownExit: "decodeOutcome",
	decodeUnknownOption: "decodeOutcome",
	decodeUnknownPromise: "decodePromise",
	decodePromise: "decodePromise",
	encode: "encode",
	encodeSync: "encode",
	encodeUnknown: "encode",
	encodeUnknownSync: "encode",
	encodeEffect: "encode",
	encodeUnknownEffect: "encode",
};

/** Schema builders read as "a schema for …" when used as values. */
const asSchema = make((c, _args, _mode, node) => {
	const type = schemaType(c, node, true);
	return type ? D(c.say.schema.of({ type })) : null;
});

const BUILDERS = ["Struct", "Array", "NonEmptyArray", "Record", "Union", "Literal", "Literals", "NullOr", "NullishOr", "UndefinedOr", "Tuple", "Enums"];

export const schemaOps: OpTable = {
	...Object.fromEntries(BUILDERS.map((m) => [`Schema.${m}`, asSchema])),
	...Object.fromEntries(Object.entries(DECODERS).map(([k, v]) => [`Schema.${k}`, decoder(v)])),
};
