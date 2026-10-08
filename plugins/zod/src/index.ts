import { D, mk } from "@narrate/core";
import { definePlugin, type Engine, listJoin, type N, type TsPlugin, unwrap } from "@narrate/lang-ts";

/** Zod: `z.string().optional()` -> "optional text". */
function zodText(e: Engine, n: N): string | null {
	const steps: { m: string; args: N[] }[] = [];
	let cur = unwrap(n);
	while (cur?.type === "CallExpression" && unwrap(cur.callee).type === "MemberExpression") {
		const c = unwrap(cur.callee);
		steps.unshift({ m: c.property.name, args: cur.arguments });
		cur = unwrap(c.object);
	}
	if (cur?.type !== "Identifier" || cur.name !== "z" || !steps.length) return null;
	const base = steps[0]!;
	const BASE: Record<string, string> = {
		string: "text",
		number: "a number",
		boolean: "true/false",
		date: "a date",
		any: "anything",
		unknown: "anything",
		null: "null",
		bigint: "a big number",
	};
	let t: string;
	if (BASE[base.m]) t = BASE[base.m]!;
	else if (base.m === "object" || base.m === "strictObject") {
		const o = unwrap(base.args[0]);
		const keys =
			o?.type === "ObjectExpression" ? o.properties.map((p: N) => (p.key ? mk("v", e.lex.humanize(p.key.name ?? String(p.key.value)), p.key.name) : "…")) : [];
		t = `an object with ${listJoin(keys)}`;
	} else if (base.m === "array") t = `a list of ${zodText(e, base.args[0]) ?? e.text(base.args[0])}`;
	else if (base.m === "enum")
		t = `one of ${
			unwrap(base.args[0])?.type === "ArrayExpression"
				? listJoin(
						unwrap(base.args[0]).elements.map((x: N) => e.text(x)),
						"or",
					)
				: e.text(base.args[0])
		}`;
	else if (base.m === "literal") t = `exactly ${e.text(base.args[0])}`;
	else if (base.m === "union")
		t = `either ${
			unwrap(base.args[0])?.type === "ArrayExpression"
				? listJoin(
						unwrap(base.args[0]).elements.map((x: N) => zodText(e, x) ?? e.text(x)),
						"or",
					)
				: "…"
		}`;
	else if (base.m === "record") t = `a lookup of ${zodText(e, base.args[base.args.length - 1]) ?? "values"}`;
	else if (base.m === "nativeEnum") t = `one of the ${e.text(base.args[0])} values`;
	else return null;
	const mods: string[] = [];
	for (const s of steps.slice(1)) {
		if (s.m === "optional") mods.push("optional");
		else if (s.m === "nullable" || s.m === "nullish") mods.push("can be null");
		else if (s.m === "default") mods.push(`defaults to ${e.text(s.args[0])}`);
		else if (s.m === "min") mods.push(`at least ${e.text(s.args[0])}`);
		else if (s.m === "max") mods.push(`at most ${e.text(s.args[0])}`);
		else if (s.m === "int") mods.push("whole number");
		else if (s.m === "positive") mods.push("positive");
		else if (s.m === "nonnegative") mods.push("not negative");
		else if (s.m === "email") mods.push("an email");
		else if (s.m === "url") mods.push("a URL");
		else if (s.m === "uuid") mods.push("a UUID");
		else if (s.m === "extend") t += ` plus more fields`;
		else if (s.m === "refine" || s.m === "superRefine") mods.push("with extra checks");
		else if (s.m === "transform") mods.push("transformed");
		else if (s.m === "describe" || s.m === "meta" || s.m === "openapi") continue;
	}
	return `${t}${mods.length ? ` (${mods.join(", ")})` : ""}`;
}

const zodRule = ({ node, e }: { node: N; e: Engine }) => {
	const t = zodText(e, node);
	return t ? D(`a schema for ${t}`) : null;
};

const zodRules: TsPlugin["calls"] = Object.fromEntries(
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

export const zod = (): TsPlugin =>
	definePlugin({
		name: "zod",
		calls: zodRules,
		describeSchema: zodText,
	});
