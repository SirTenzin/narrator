import { mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import type { BaseType, StringFormat } from "./phrases";
import { type Ctx, isTypeBox, keyOf, literal, objectArg, stringLit } from "./shared";

const BASE = new Set<string>([
	"String",
	"Number",
	"Integer",
	"Boolean",
	"Null",
	"Undefined",
	"Void",
	"Any",
	"Unknown",
	"Never",
	"Date",
	"BigInt",
	"Symbol",
	"Uint8Array",
	"Numeric",
	"BooleanString",
	"ObjectString",
	"ArrayString",
	"File",
	"Files",
] satisfies BaseType[]);

/** Where each TypeBox builder keeps its options object. */
const OPTIONS_AT: Record<string, number> = { Array: 1, Object: 1, Union: 1, Record: 2, Literal: 1, Tuple: 1, Enum: 1, Intersect: 1, Composite: 1 };

const elements = (n: N): N[] | null => (unwrap(n)?.type === "ArrayExpression" ? unwrap(n).elements.filter(Boolean) : null);

/** `t.Object(...)` -> `["Object", args]` when `t` is TypeBox. */
export function typeBoxCall(c: Ctx, node: N): { m: string; args: N[] } | null {
	const u = unwrap(node);
	if (u?.type !== "CallExpression") return null;
	const callee = unwrap(u.callee);
	if (callee?.type !== "MemberExpression" || callee.computed || unwrap(callee.object)?.type !== "Identifier") return null;
	if (!isTypeBox(c, unwrap(callee.object).name)) return null;
	return { m: callee.property.name, args: u.arguments };
}

/** A TypeBox schema as words: `t.Object({ name: t.String() })` -> "an object with name (text)". */
export function typeText(c: Ctx, node: N): string | null {
	const call = typeBoxCall(c, node);
	if (!call) return null;
	const { m, args } = call;
	const base = baseText(c, m, args);
	if (base === null) return null;
	const opts = objectArg(args[OPTIONS_AT[m] ?? (BASE.has(m) ? 0 : -1)]);
	const s = c.say.schema;
	if (m === "String" && opts) {
		const format = stringLit(opts.properties.find((p: N) => keyOf(p) === "format")?.value);
		const known = format && Object.hasOwn(s.formats, format) ? s.formats[format as StringFormat] : null;
		return s.withModifiers({ type: known ?? base, modifiers: modifiers(c, opts, known ? ["format"] : []) });
	}
	return opts ? s.withModifiers({ type: base, modifiers: modifiers(c, opts, []) }) : base;
}

/** Any schema in a hook: TypeBox, a model name (`body: "sign"`), or whatever the engine (or another plugin) makes of it. */
export function schemaText(c: Ctx, node: N): string {
	const t = typeText(c, node);
	if (t) return t;
	const name = stringLit(node);
	if (name !== null) {
		const list = /^(.+)\[\]$/.exec(name);
		return list ? c.say.schema.modelList({ name: mk("l", list[1]!) }) : c.say.schema.model({ name: mk("l", name) });
	}
	return c.e.text(node);
}

const inner = (c: Ctx, n: N) => typeText(c, n) ?? c.e.text(n);

function baseText(c: Ctx, m: string, args: N[]): string | null {
	const { e, say } = c;
	const s = say.schema;
	if (BASE.has(m)) return s.base[m as BaseType];
	const list = (n: N, conj: "and" | "or" = "and") => {
		const els = elements(n);
		return els
			? e.g.list(
					els.map((x) => inner(c, x)),
					conj,
				)
			: e.text(n);
	};
	switch (m) {
		case "Object":
			return objectText(c, args[0]);
		case "Array":
			return s.array({ item: e.g.bareNoun(inner(c, args[0])) });
		case "Optional":
			return s.optional({ type: inner(c, args[0]) });
		case "Union": {
			const els = elements(args[0]);
			const allLiterals = els?.every((x) => typeBoxCall(c, x)?.m === "Literal");
			if (els && allLiterals)
				return s.oneOf({
					options: e.g.list(
						els.map((x) => e.text(typeBoxCall(c, x)!.args[0])),
						"or",
					),
				});
			return s.either({ options: list(args[0], "or") });
		}
		case "UnionEnum":
			return s.oneOf({ options: list(args[0], "or") });
		case "Literal":
			return s.literal({ value: e.text(args[0]) });
		case "Nullable":
			return s.nullable({ type: inner(c, args[0]) });
		case "MaybeEmpty":
			return s.maybeEmpty({ type: inner(c, args[0]) });
		case "Record":
			return s.record({ key: e.g.bareNoun(inner(c, args[0])), value: e.g.bareNoun(inner(c, args[1])) });
		case "Tuple":
			return s.tuple({ items: list(args[0]) });
		case "Enum":
			return s.enumOf({ name: e.text(args[0]) });
		case "KeyOf":
			return s.keysOf({ type: inner(c, args[0]) });
		case "Ref": {
			const name = stringLit(args[0]);
			return s.model({ name: name !== null ? mk("l", name) : e.text(args[0]) });
		}
		case "Partial":
			return s.partial({ type: inner(c, args[0]) });
		case "Required":
			return s.required({ type: inner(c, args[0]) });
		case "Pick":
			return s.pick({ type: inner(c, args[0]), keys: list(args[1]) });
		case "Omit":
			return s.omit({ type: inner(c, args[0]), keys: list(args[1]) });
		case "Intersect":
		case "Composite":
			return s.allOf({ types: list(args[0]) });
		case "Not":
			return s.not({ type: inner(c, args[0]) });
		case "Cookie":
			return s.cookie({ type: inner(c, args[0]) });
		case "Form":
			return s.form({ type: inner(c, args[0]) });
		case "NoValidate":
			return s.unchecked({ type: inner(c, args[0]) });
	}
	return null;
}

function objectText(c: Ctx, node: N): string {
	const { e, say } = c;
	const s = say.schema;
	const o = objectArg(node);
	if (!o) return s.object({ fields: e.text(node) });
	if (!o.properties.length) return s.emptyObject;
	const fields = o.properties.map((p: N) => {
		if (p.type === "SpreadElement") return e.noun(p).t;
		const key = keyOf(p);
		const name = key === null ? e.text(p.key) : /^[A-Za-z_$][\w$]*$/.test(key) ? e.prop(key) : mk("l", `"${key}"`);
		const opt = typeBoxCall(c, p.value);
		if (opt?.m === "Optional") return s.optionalField({ name, type: inner(c, opt.args[0]) });
		return s.field({ name, type: inner(c, p.value) });
	});
	return s.object({ fields: e.g.list(fields) });
}

const COUNTS = ["minLength", "maxLength", "minItems", "maxItems"] as const;
const VALUES = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "default"] as const;
const SIZES = ["maxSize", "minSize"] as const;

/** Schema options (`{ minLength: 1, format: "email" }`) in source order. */
function modifiers(c: Ctx, opts: N, skip: string[]): string[] {
	const { e, say } = c;
	const mod = say.schema.modifiers;
	return opts.properties.flatMap((p: N): string[] => {
		if (p.type === "SpreadElement") return [e.noun(p).t];
		const key = keyOf(p);
		if (key === null || skip.includes(key)) return key === null ? [mod.option({ name: e.text(p.key), value: e.text(p.value) })] : [];
		const v = p.value;
		if ((COUNTS as readonly string[]).includes(key)) {
			const n = literal(v);
			return [mod[key as (typeof COUNTS)[number]]({ count: e.text(v), n: typeof n === "number" ? n : null })];
		}
		if ((VALUES as readonly string[]).includes(key)) return [mod[key as (typeof VALUES)[number]]({ value: e.text(v) })];
		if ((SIZES as readonly string[]).includes(key)) return [mod[key as (typeof SIZES)[number]]({ size: e.text(v) })];
		if (key === "uniqueItems") return literal(v) === true ? [mod.uniqueItems] : [];
		if (key === "pattern") return [mod.pattern({ pattern: mk("c", stringLit(v) ?? e.code(v)) })];
		if (key === "format") return [mod.format({ format: e.text(v) })];
		if (key === "description") return [mod.description({ text: e.text(v) })];
		if (key === "error") return [mod.error({ message: e.text(v) })];
		if (key === "type") {
			const els = elements(v);
			return [mod.fileType({ types: els ? e.g.list(els.map((x) => e.text(x))) : e.text(v) })];
		}
		return [mod.option({ name: e.prop(key), value: e.text(v) })];
	});
}
