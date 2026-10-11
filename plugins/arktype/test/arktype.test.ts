import { describe, expect, test } from "bun:test";
import { narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { arktype, en } from "../src";

const IMPORT = `import { type, scope } from "arktype";\n`;

/** Narrates a snippet (with the ArkType import) and asserts nothing fell back to raw code. */
const say = (code: string) => {
	const { text, fallbacks } = narrateWithStats(IMPORT + code, { plugins: [arktype()] });
	expect(fallbacks).toBe(0);
	return text;
};

describe("definitions", () => {
	test("an object definition lists its fields, like zod", () => {
		expect(
			say(`export const User = type({
  name: "string",
  "age?": "number.integer >= 18",
  email: "string.email",
  "[string]": "unknown",
});`),
		).toBe("Let user be a schema for an object with name, age, email, and any text key holding anything.");
	});

	test("the string DSL: keywords, bounds, unions, arrays, defaults", () => {
		expect(say(`const Bio = type("1 <= string <= 280");`)).toBe("Let bio be a schema for text (at least 1 long, at most 280 long).");
		expect(say(`const Port = type("0 < number.integer <= 65535");`)).toBe("Let port be a schema for a number (whole number, more than 0, at most 65535).");
		expect(say(`const Role = type("'admin' | 'member'");`)).toBe(`Let role be a schema for one of "admin" or "member".`);
		expect(say(`const Ids = type("string.uuid[]");`)).toBe("Let IDs be a schema for a list of text (a UUID).");
		expect(say(`const Nick = type("string | null");`)).toBe("Let nick be a schema for text (can be null).");
		expect(say(`const Plan = type("string = 'free'");`)).toBe(`Let plan be a schema for text (defaults to "free").`);
		expect(say(`const Even = type("number % 2");`)).toBe("Let even be a schema for a number (a multiple of 2).");
		expect(say(`const Parsed = type("string.numeric.parse");`)).toBe("Let parsed be a schema for text (converted to a number).");
	});

	test("chained methods and statics", () => {
		expect(say(`const Status = type.enumerated("open", "closed");`)).toBe(`Let status be a schema for one of "open" or "closed".`);
		expect(say(`const Strict = type({ "+": "reject", id: "string" });`)).toBe("Let strict be a schema for an object with ID (no other fields allowed).");
		expect(say(`const Trimmed = type("string").pipe((s) => s.trim()).narrow((s) => s.length > 0);`)).toBe(
			"Let trimmed be a schema for text (transformed, with extra checks).",
		);
		expect(say(`const Users = type({ id: "string" }).array().describe("all users");`)).toBe(
			`Let users be a schema for a list of an object with ID (described as "all users").`,
		);
		expect(say(`const T = type(["string", "number"]);`)).toBe("Let T be a schema for a fixed list of text and a number.");
	});
});

describe("validation", () => {
	test("calling a schema, assert and allows", () => {
		const text = say(`const User = type({ name: "string" });
export function check(data: unknown) {
  const out = User(data);
  if (out instanceof type.errors) return out.summary;
  if (User.allows(data)) go();
  User.assert(data);
}`);
		expect(text).toContain("Let out be data, checked against user (either the valid data or the problems found).");
		expect(text).toContain("If data matches user, run go.");
		expect(text).toContain("Check that data matches user, failing if it doesn't.");
	});

	test("scopes", () => {
		expect(say(`const types = scope({ id: "string", user: { id: "id", friends: "user[]" } }).export();`)).toBe(
			"Let types be a set of named schemas: ID and user.",
		);
	});
});

describe("guards", () => {
	const plain = (code: string) => narrateWithStats(code).text;
	const withPlugin = (code: string) => narrateWithStats(code, { plugins: [arktype()] }).text;

	test("a local type() and other libraries are left alone", () => {
		const code = `const type = (x: string) => x;\nconst a = type("string");\nconst User = makeUser();\nconst out = User(data);\nUser.assert(x);`;
		expect(withPlugin(code)).toBe(plain(code));
	});
});

test("a partial translation reports what it is missing", () => {
	const gaps = phrasebookGaps(en, { schema: () => "", base: { string: "texto" } });
	expect(gaps.missing).toContain("base.number");
	expect(gaps.missing).toContain("modifiers.email");
	expect(gaps.extra).toEqual([]);
});
