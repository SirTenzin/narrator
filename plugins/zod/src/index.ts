import { D, mk } from "@narrate/core";
import { type CallRule, definePlugin, type Engine, type N, type TsPlugin, unwrap } from "@narrate/lang-ts";
import { en } from "./en";
import type { ZodPhrases } from "./phrases";

export type { ZodPhrases } from "./phrases";
export { en as zodEn };

const UNKNOWN = "…";

const elements = (n: N): N[] | null => (unwrap(n)?.type === "ArrayExpression" ? unwrap(n).elements : null);

/** Zod: `z.string().optional()` -> "optional text". */
function zodText(e: Engine, n: N, say: ZodPhrases): string | null {
	const steps: { m: string; args: N[] }[] = [];
	let cur = unwrap(n);
	while (cur?.type === "CallExpression" && unwrap(cur.callee).type === "MemberExpression") {
		const c = unwrap(cur.callee);
		steps.unshift({ m: c.property.name, args: cur.arguments });
		cur = unwrap(c.object);
	}
	if (cur?.type !== "Identifier" || cur.name !== "z" || !steps.length) return null;
	let t = baseText({ e, say, base: steps[0]! });
	if (t === null) return null;
	const modifiers: string[] = [];
	const mod = say.modifiers;
	for (const s of steps.slice(1)) {
		if (s.m === "optional") modifiers.push(mod.optional);
		else if (s.m === "nullable" || s.m === "nullish") modifiers.push(mod.nullable);
		else if (s.m === "default") modifiers.push(mod.default({ value: e.text(s.args[0]) }));
		else if (s.m === "min") modifiers.push(mod.min({ value: e.text(s.args[0]) }));
		else if (s.m === "max") modifiers.push(mod.max({ value: e.text(s.args[0]) }));
		else if (s.m === "int") modifiers.push(mod.int);
		else if (s.m === "positive") modifiers.push(mod.positive);
		else if (s.m === "nonnegative") modifiers.push(mod.nonnegative);
		else if (s.m === "email") modifiers.push(mod.email);
		else if (s.m === "url") modifiers.push(mod.url);
		else if (s.m === "uuid") modifiers.push(mod.uuid);
		else if (s.m === "extend") t = say.extend({ type: t });
		else if (s.m === "refine" || s.m === "superRefine") modifiers.push(mod.refine);
		else if (s.m === "transform") modifiers.push(mod.transform);
	}
	return say.withModifiers({ type: t, modifiers });
}

function baseText({ e, say, base }: { e: Engine; say: ZodPhrases; base: { m: string; args: N[] } }): string | null {
	const { m, args } = base;
	if (Object.hasOwn(say.base, m)) return say.base[m as keyof ZodPhrases["base"]];
	if (m === "object" || m === "strictObject") {
		const o = unwrap(args[0]);
		const keys =
			o?.type === "ObjectExpression"
				? o.properties.map((p: N) => (p.key ? mk("v", e.lex.humanize(p.key.name ?? String(p.key.value)), p.key.name) : UNKNOWN))
				: [];
		return say.object({ fields: e.g.list(keys) });
	}
	if (m === "array") return say.array({ item: zodText(e, args[0], say) ?? e.text(args[0]) });
	if (m === "enum") {
		const els = elements(args[0]);
		return say.enum({
			options: els
				? e.g.list(
						els.map((x: N) => e.text(x)),
						"or",
					)
				: e.text(args[0]),
		});
	}
	if (m === "literal") return say.literal({ value: e.text(args[0]) });
	if (m === "union") {
		const els = elements(args[0]);
		return say.union({
			options: els
				? e.g.list(
						els.map((x: N) => zodText(e, x, say) ?? e.text(x)),
						"or",
					)
				: UNKNOWN,
		});
	}
	if (m === "record") {
		const value = zodText(e, args[args.length - 1], say);
		return value ? say.record({ value }) : say.recordOfAnything;
	}
	if (m === "nativeEnum") return say.nativeEnum({ name: e.text(args[0]) });
	return null;
}

const zodRule: CallRule<ZodPhrases> = ({ node, e, say }) => {
	const t = zodText(e, node, say);
	return t ? D(say.schema({ type: t })) : null;
};

const zodRules: Record<string, CallRule<ZodPhrases>> = Object.fromEntries(
	[
		"z.object",
		"z.string",
		"z.number",
		"z.boolean",
		"z.array",
		"z.enum",
		"z.union",
		"z.literal",
		"z.record",
		"z.date",
		"z.any",
		"z.unknown",
		"z.nativeEnum",
		"z.strictObject",
		"*.optional",
		"*.nullable",
		"*.nullish",
		"*.default",
		"*.min",
		"*.max",
		"*.int",
		"*.positive",
		"*.nonnegative",
		"*.email",
		"*.url",
		"*.uuid",
		"*.describe",
		"*.meta",
		"*.openapi",
		"*.extend",
		"*.refine",
		"*.transform",
	].map((k) => [k, zodRule]),
);

export const zod = (): TsPlugin<ZodPhrases> =>
	definePlugin({
		name: "zod",
		phrases: { en },
		calls: zodRules,
		describeSchema: zodText,
	});
