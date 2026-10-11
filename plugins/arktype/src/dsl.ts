import { mk } from "@usenarrator/core";
import type { Engine } from "@usenarrator/lang-ts";
import type { ArkTypePhrases } from "./phrases";

type Say = ArkTypePhrases;
type Mod = keyof Say["modifiers"];
type Base = keyof Say["base"];
export type Shape = { type: string; modifiers: string[] };

/** Keyword -> its base type and the refinement it adds, e.g. `string.email` -> text, "an email". */
const KEYWORDS = new Map<string, [Base, Mod | null, Base?]>([
	["string", ["string", null]],
	["number", ["number", null]],
	["bigint", ["bigint", null]],
	["boolean", ["boolean", null]],
	["symbol", ["symbol", null]],
	["null", ["null", null]],
	["undefined", ["undefined", null]],
	["unknown", ["unknown", null]],
	["any", ["unknown", null]],
	["never", ["never", null]],
	["object", ["object", null]],
	["Date", ["date", null]],
	["Array", ["array", null]],
	["true", ["true", null]],
	["false", ["false", null]],
	["string.email", ["string", "email"]],
	["string.url", ["string", "url"]],
	["string.uuid", ["string", "uuid"]],
	["string.uuid.v4", ["string", "uuid"]],
	["string.uuid.v7", ["string", "uuid"]],
	["string.ip", ["string", "ip"]],
	["string.ip.v4", ["string", "ip"]],
	["string.ip.v6", ["string", "ip"]],
	["string.semver", ["string", "semver"]],
	["string.creditCard", ["string", "creditCard"]],
	["string.alpha", ["string", "alpha"]],
	["string.alphanumeric", ["string", "alphanumeric"]],
	["string.digits", ["string", "digits"]],
	["string.numeric", ["string", "numeric"]],
	["string.integer", ["string", "numeric"]],
	["string.json", ["string", "json"]],
	["string.date", ["string", "isoDate"]],
	["string.date.iso", ["string", "isoDate"]],
	["string.trim", ["string", "trim"]],
	["string.lower", ["string", "lower"]],
	["string.upper", ["string", "upper"]],
	["string.capitalize", ["string", "capitalize"]],
	["string.normalize", ["string", "normalize"]],
	["string.numeric.parse", ["string", "parsedAs", "number"]],
	["string.integer.parse", ["string", "parsedAs", "number"]],
	["string.date.parse", ["string", "parsedAs", "date"]],
	["string.date.iso.parse", ["string", "parsedAs", "date"]],
	["string.date.epoch.parse", ["string", "parsedAs", "date"]],
	["string.json.parse", ["string", "parsedAs", "object"]],
	["number.integer", ["number", "integer"]],
	["number.safe", ["number", "safe"]],
	["number.epoch", ["number", "epoch"]],
	["integer", ["number", "integer"]],
]);

/** Splits on `sep` at the top level, outside quotes, parentheses and brackets. */
function splitTop(s: string, sep: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let quote = "";
	let start = 0;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i]!;
		if (quote) {
			if (ch === quote && s[i - 1] !== "\\") quote = "";
			continue;
		}
		if (ch === "'" || ch === '"' || ch === "/") quote = ch;
		else if (ch === "(" || ch === "[") depth++;
		else if (ch === ")" || ch === "]") depth--;
		else if (depth === 0 && s.startsWith(sep, i)) {
			out.push(s.slice(start, i));
			start = i + sep.length;
			i += sep.length - 1;
		}
	}
	out.push(s.slice(start));
	return out.map((x) => x.trim());
}

const LITERAL = /^('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|-?\d+(\.\d+)?n?)$/;
const OPS: Record<string, [Mod, Mod]> = {
	">=": ["atLeast", "lengthAtLeast"],
	">": ["moreThan", "lengthMoreThan"],
	"<=": ["atMost", "lengthAtMost"],
	"<": ["lessThan", "lengthLessThan"],
	"==": ["exactly", "lengthExactly"],
};
const FLIP: Record<string, string> = { ">=": "<=", ">": "<", "<=": ">=", "<": ">", "==": "==" };

const literalText = (s: string) => mk("l", s.startsWith("'") ? `"${s.slice(1, -1)}"` : s);

/** Reads an ArkType string definition (`"string.email"`, `"1 <= string <= 50"`, `"'a' | 'b'"`, `"number[]"`) as a type. */
export function parseDef(e: Engine, say: Say, def: string): Shape {
	const plain = (type: string): Shape => ({ type, modifiers: [] });
	const s = def.trim();
	const [body, fallback] = splitTop(s, " = ");
	if (fallback !== undefined) {
		const inner = parseDef(e, say, body!);
		return { type: inner.type, modifiers: [...inner.modifiers, say.modifiers.default({ value: literalText(fallback) })] };
	}
	const options = splitTop(s, "|").filter((x) => x !== "");
	if (options.length > 1) {
		const rest = options.filter((o) => o !== "null" && o !== "undefined");
		const extra = [...(options.includes("undefined") ? [say.modifiers.optional] : []), ...(options.includes("null") ? [say.modifiers.nullable] : [])];
		if (rest.length === 1) {
			const one = parseDef(e, say, rest[0]!);
			return { type: one.type, modifiers: [...one.modifiers, ...extra] };
		}
		const t = rest.every((o) => LITERAL.test(o))
			? say.oneOf({ options: e.g.list(rest.map(literalText), "or") })
			: say.union({
					options: e.g.list(
						rest.map((o) => say.withModifiers(parseDef(e, say, o))),
						"or",
					),
				});
		return { type: t, modifiers: extra };
	}
	const parts = splitTop(s, "&");
	if (parts.length > 1) return plain(say.intersection({ types: e.g.list(parts.map((p) => say.withModifiers(parseDef(e, say, p)))) }));
	if (s.startsWith("(") && s.endsWith(")")) return parseDef(e, say, s.slice(1, -1));
	if (s.endsWith("[]")) return plain(say.array({ item: say.withModifiers(parseDef(e, say, s.slice(0, -2))) }));
	if (LITERAL.test(s)) return plain(say.literal({ value: literalText(s) }));
	if (s.startsWith("/") && s.lastIndexOf("/") > 0) return { type: say.base.string, modifiers: [say.modifiers.matching({ pattern: mk("c", s) })] };
	const range = s.match(/^(\S+)\s*(<=|<|>=|>|==)\s*([\w.$]+)\s*(<=|<|>=|>|==)\s*(\S+)$/);
	if (range) {
		const inner = parseDef(e, say, range[3]!);
		return {
			type: inner.type,
			modifiers: [...inner.modifiers, bound(say, range[3]!, FLIP[range[2]!]!, range[1]!), bound(say, range[3]!, range[4]!, range[5]!)],
		};
	}
	const single = s.match(/^([\w.$]+(?:\[\])?)\s*(<=|<|>=|>|==|%)\s*(\S+)$/);
	if (single) {
		const inner = parseDef(e, say, single[1]!);
		const mod = single[2] === "%" ? say.modifiers.divisibleBy({ value: single[3]! }) : bound(say, single[1]!, single[2]!, single[3]!);
		return { type: inner.type, modifiers: [...inner.modifiers, mod] };
	}
	const known = KEYWORDS.get(s);
	if (known) {
		const [base, mod, to] = known;
		if (!mod) return plain(say.base[base]);
		const m = say.modifiers[mod];
		return { type: say.base[base], modifiers: [typeof m === "string" ? m : (m as (p: { type: string }) => string)({ type: say.base[to ?? "unknown"] })] };
	}
	const dotted = s.match(/^(string|number)\.(.+)$/);
	if (dotted) return { type: say.base[dotted[1] as Base], modifiers: [say.modifiers.other({ name: mk("c", dotted[2]!) })] };
	return plain(say.alias({ name: e.prop(s) }));
}

/** A bound on `base`: lengths for text and lists, values for numbers and dates. */
function bound(say: Say, base: string, op: string, limit: string): string {
	const isLength = base.startsWith("string") || base.endsWith("[]");
	const key = OPS[op]![isLength ? 1 : 0];
	const value = limit.startsWith("d'") || limit.startsWith('d"') ? mk("l", limit.slice(1)) : limit;
	return (say.modifiers[key] as (p: { value: string }) => string)({ value });
}
