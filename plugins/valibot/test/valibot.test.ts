import { describe, expect, test } from "bun:test";
import { narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { en, valibot } from "../src";

const NS = `import * as v from "valibot";\n`;

/** Narrates a snippet (with the Valibot import) and asserts nothing fell back to raw code. */
const say = (code: string, header = NS) => {
	const { text, fallbacks } = narrateWithStats(header + code, { plugins: [valibot()] });
	expect(fallbacks).toBe(0);
	return text;
};

describe("schemas", () => {
	test("an object schema lists its fields, like zod", () => {
		expect(
			say(`const LoginSchema = v.object({
  email: v.pipe(v.string(), v.nonEmpty("Please enter your email."), v.email("The email address is badly formatted.")),
  password: v.pipe(v.string(), v.minLength(8)),
});`),
		).toBe("Let login schema be a schema for an object with email and password.");
	});

	test("pipes and wrappers stack their modifiers in order", () => {
		expect(say(`const Email = v.pipe(v.string(), v.trim(), v.email(), v.maxLength(255));`)).toBe(
			"Let email be a schema for text (trimmed, an email, at most 255 long).",
		);
		expect(say(`const Age = v.nullable(v.pipe(v.number(), v.integer(), v.minValue(18)));`)).toBe(
			"Let age be a schema for a number (whole number, at least 18, can be null).",
		);
		expect(say(`const Role = v.optional(v.picklist(["admin", "member"]), "member");`)).toBe(
			`Let role be a schema for one of "admin" or "member" (optional, defaults to "member").`,
		);
	});

	test("arrays, records, unions, variants and object helpers", () => {
		expect(say(`const Tags = v.array(v.string());`)).toBe("Let tags be a schema for a list of text.");
		expect(say(`const Scores = v.record(v.string(), v.number());`)).toBe("Let scores be a schema for a lookup from text to a number.");
		expect(say(`const Id = v.union([v.string(), v.number()]);`)).toBe("Let ID be a schema for either text or a number.");
		expect(
			say(
				`const Shape = v.variant("type", [v.object({ type: v.literal("circle"), r: v.number() }), v.object({ type: v.literal("square"), side: v.number() })]);`,
			),
		).toBe("Let shape be a schema for either an object with type and r or an object with type and side, told apart by type.");
		expect(say(`const Patch = v.partial(v.omit(User, ["id"]));`)).toBe("Let patch be a schema for user, without ID, with every field optional.");
	});

	test("checks with a message, forwarded to a field", () => {
		expect(
			say(`const Pw = v.pipe(v.object({ a: v.string(), b: v.string() }), v.forward(v.check((x) => x.a === x.b, "Passwords do not match."), ["b"]));`),
		).toBe(`Let pw be a schema for an object with a and b (checked: "Passwords do not match.").`);
	});

	test("named imports work too", () => {
		expect(say(`const Name = pipe(string(), minLength(1), maxLength(50));`, `import { pipe, string, minLength, maxLength } from "valibot";\n`)).toBe(
			"Let name be a schema for text (at least 1 long, at most 50 long).",
		);
	});
});

describe("validation", () => {
	test("parse, safeParse, is, assert and parser", () => {
		const text = say(`export function login(input: unknown) {
  const data = v.parse(LoginSchema, input);
  const result = v.safeParse(LoginSchema, input);
  if (!result.success) report(v.flatten(result.issues));
  if (v.is(LoginSchema, input)) go();
  v.assert(LoginSchema, input);
}
const check = v.parser(v.string());`);
		expect(text).toBe(
			[
				"To login, given input:",
				"  Let data be input, checked against login schema.",
				"  Let result be the result of checking input against login schema, without failing.",
				"  If result's success is missing, report (the problems found in result, grouped by field).",
				"  If input matches login schema, run go.",
				"  Check that input matches login schema, failing if it doesn't.",
				"",
				"Let check be a function that checks its input against text, failing if it doesn't match.",
			].join("\n"),
		);
	});

	test("the async variants say so", () => {
		expect(say(`const data = await v.parseAsync(Schema, input);`)).toBe("Let data be input, checked against schema (async).");
	});
});

describe("guards", () => {
	const plain = (code: string) => narrateWithStats(code).text;
	const withPlugin = (code: string) => narrateWithStats(code, { plugins: [valibot()] }).text;

	test("same-named functions from elsewhere are left alone", () => {
		const code = `import * as v from "./vectors";\nimport { object, parse } from "./local";\nconst a = v.object({ x: 1 });\nconst b = object({ y: 2 });\nconst c = parse(text);\nconst d = JSON.parse(s);`;
		expect(withPlugin(code)).toBe(plain(code));
	});
});

test("a partial translation reports what it is missing", () => {
	const gaps = phrasebookGaps(en, { schema: () => "", base: { string: "texto" } });
	expect(gaps.missing).toContain("base.number");
	expect(gaps.missing).toContain("modifiers.email");
	expect(gaps.extra).toEqual([]);
});
