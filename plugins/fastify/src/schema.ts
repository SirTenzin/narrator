import { mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import type { JsonType } from "./phrases";
import { type Ctx, keyOf, objectArg, propOf, str } from "./shared";

const JSON_TYPES = ["string", "number", "integer", "boolean", "object", "array", "null"];

const lit = (c: Ctx, n: N): string => {
	const u = unwrap(n);
	return u?.type === "Literal" ? mk("l", JSON.stringify(u.value)) : c.e.text(n);
};

/** A JSON Schema literal in words: "an object with name (a string, required)". Non-literals defer to schema plugins. */
export function shapeText(c: Ctx, n: N): string {
	const { e, say } = c;
	const s = say.schema;
	const o = objectArg(n);
	if (!o) return typeboxText(c, n) ?? e.schemaText(n) ?? e.text(n);
	const ref = str(propOf(o, "$ref"));
	if (ref) return s.ref({ ref: mk("c", ref) });
	const en = unwrap(propOf(o, "enum"));
	if (en?.type === "ArrayExpression")
		return s.enumOf({
			list: e.g.list(
				en.elements.map((x: N) => lit(c, x)),
				"or",
			),
		});
	const cst = propOf(o, "const");
	if (cst) return lit(c, cst);
	const alt = unwrap(propOf(o, "anyOf") ?? propOf(o, "oneOf"));
	if (alt?.type === "ArrayExpression")
		return s.oneOf({
			list: e.g.list(
				alt.elements.map((x: N) => shapeText(c, x)),
				"or",
			),
		});
	const t = unwrap(propOf(o, "type"));
	const types: string[] = t?.type === "ArrayExpression" ? t.elements.map((x: N) => str(x) ?? "") : [str(t) ?? ""];
	const nullable = types.includes("null") || unwrap(propOf(o, "nullable"))?.value === true;
	const main = types.find((x) => x && x !== "null") ?? (propOf(o, "properties") ? "object" : propOf(o, "items") ? "array" : null);
	let base: string;
	if (main === "object") {
		const props = objectArg(propOf(o, "properties"));
		const req = unwrap(propOf(o, "required"));
		const required = new Set<string>(req?.type === "ArrayExpression" ? req.elements.map((x: N) => str(x) ?? "") : []);
		const fields = (props?.properties ?? []).map((p: N) => {
			const k = keyOf(p) ?? e.text(p.key);
			return s.field({ name: mk("c", k), type: shapeText(c, p.value), required: required.has(k) });
		});
		base = fields.length ? s.objectWith({ fields: e.g.list(fields) }) : s.types.object;
	} else if (main === "array") {
		const items = propOf(o, "items");
		base = items ? s.arrayOf({ items: shapeText(c, items) }) : s.types.array;
	} else if (main && JSON_TYPES.includes(main)) base = s.types[main as JsonType];
	else if (!main && isShorthand(c, o)) return shapeText(c, { type: "ObjectExpression", start: o.start, end: o.end, ...shorthand(o) });
	else return e.text(n);
	const rules = ruleTexts(c, o);
	if (nullable) rules.push(s.nullable);
	return rules.length ? s.withRules({ type: base, rules: e.g.list(rules) }) : base;
}

/** v4's short form: `querystring: { name: { type: "string" } }` without `type: "object"`. */
const isShorthand = (c: Ctx, o: N) =>
	o.properties.length > 0 &&
	o.properties.every((p: N) => p.type === "Property" && ((objectArg(p.value) && propOf(objectArg(p.value), "type")) || typeboxText(c, p.value) !== null));

const shorthand = (o: N) => ({
	properties: [
		{ type: "Property", key: { type: "Identifier", name: "type" }, value: { type: "Literal", value: "object" }, computed: false },
		{ type: "Property", key: { type: "Identifier", name: "properties" }, value: o, computed: false },
	],
});

function ruleTexts(c: Ctx, o: N): string[] {
	const { e, say } = c;
	const s = say.schema;
	const out: string[] = [];
	const n = (k: string) => {
		const v = propOf(o, k);
		return v ? mk("l", e.code(v)) : null;
	};
	const fmt = str(propOf(o, "format"));
	if (fmt) out.push(s.format({ format: mk("c", fmt) }));
	for (const [k, f] of [
		["minLength", s.minLength],
		["maxLength", s.maxLength],
		["minimum", s.minimum],
		["maximum", s.maximum],
		["minItems", s.minItems],
		["maxItems", s.maxItems],
	] as const) {
		const v = n(k);
		if (v) out.push(f({ n: v, count: Number(e.code(propOf(o, k))) }));
	}
	const pat = str(propOf(o, "pattern"));
	if (pat) out.push(s.pattern({ pattern: mk("c", pat) }));
	const def = propOf(o, "default");
	if (def) out.push(s.defaultValue({ value: lit(c, def) }));
	if (unwrap(propOf(o, "additionalProperties"))?.value === false) out.push(s.noExtra);
	return out;
}

const TYPEBOX = /^(@sinclair\/typebox|typebox|@fastify\/type-provider-typebox)$/;

/** `Type.Object({ id: Type.Number() })` from TypeBox, Fastify's usual type provider, in the same words as JSON Schema. */
function typeboxText(c: Ctx, n: N): string | null {
	const u = unwrap(n);
	const callee = u?.type === "CallExpression" ? unwrap(u.callee) : null;
	if (callee?.type !== "MemberExpression" || callee.computed || unwrap(callee.object)?.type !== "Identifier") return null;
	const from = c.e.imports.get(unwrap(callee.object).name)?.from;
	if (!from || !TYPEBOX.test(from)) return null;
	const { e, say } = c;
	const s = say.schema;
	const [a, b] = u.arguments;
	const withOpts = (base: string, opts: N | undefined) => {
		const o = objectArg(opts);
		const rules = o ? ruleTexts(c, o) : [];
		return rules.length ? s.withRules({ type: base, rules: e.g.list(rules) }) : base;
	};
	const optional = (v: N) => {
		const x = unwrap(v);
		const cal = x?.type === "CallExpression" ? unwrap(x.callee) : null;
		return cal?.type === "MemberExpression" && cal.property.name === "Optional" ? x.arguments[0] : null;
	};
	switch (callee.property.name) {
		case "Object": {
			const o = objectArg(a);
			if (!o) return null;
			const fields = o.properties.map((p: N) => {
				const inner = optional(p.value);
				return s.field({ name: mk("c", keyOf(p) ?? e.text(p.key)), type: shapeText(c, inner ?? p.value), required: !inner });
			});
			return withOpts(fields.length ? s.objectWith({ fields: e.g.list(fields) }) : s.types.object, b);
		}
		case "String":
		case "Number":
		case "Integer":
		case "Boolean":
		case "Null":
			return withOpts(s.types[callee.property.name.toLowerCase() as JsonType], a);
		case "Array":
			return a ? withOpts(s.arrayOf({ items: shapeText(c, a) }), b) : null;
		case "Optional":
			return a ? shapeText(c, a) : null;
		case "Union": {
			const list = unwrap(a);
			return list?.type === "ArrayExpression"
				? s.oneOf({
						list: e.g.list(
							list.elements.map((x: N) => shapeText(c, x)),
							"or",
						),
					})
				: null;
		}
		case "Literal":
			return a ? lit(c, a) : null;
		case "Ref":
			return a ? s.ref({ ref: e.text(a) }) : null;
		default:
			return null;
	}
}
