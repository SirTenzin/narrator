import { expect, test } from "bun:test";
import { narrate, narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { zod, zodEn } from "../src";

const reads = (code: string, text: string) => {
	const r = narrateWithStats(code, { plugins: [zod()] });
	expect(r.text).toBe(text);
	expect(r.fallbacks).toBe(0);
};

test("an object schema lists its fields and modifiers", () => {
	const text = narrate(`const User = z.object({ email: z.string().email(), age: z.number().int().optional() });`, { plugins: [zod()] });
	expect(text).toContain("a schema for an object with email and age");
});

test("enums, arrays and records", () => {
	reads(`const Role = z.enum(["admin", "member"]);`, `Let role be a schema for one of "admin" or "member".`);
	reads(`const Tags = z.array(z.string()).max(5);`, "Let tags be a schema for a list of text (at most 5).");
	reads(`const Ids = z.record(z.string(), z.number()).default({});`, "Let IDs be a schema for a lookup of a number (defaults to an empty object).");
});

test("modifiers stack in order", () =>
	reads(`const Age = z.number().int().positive().nullable();`, "Let age be a schema for a number (whole number, positive, can be null)."));

test("parse and safeParse read as validation against the schema", () => {
	reads(`const body = CreateCustomerSchema.parse(input);`, "Let body be input, validated against create customer schema.");
	reads(`UpdateSchema.parse(data);`, "Validate data against update schema.");
	reads(
		`const User = z.object({ a: z.string() });\nconst r = User.safeParse(x);`,
		"Let user be a schema for an object with a.\nLet r be the outcome of validating x against user.",
	);
	reads(`const q = qs.parse(str);`, "Parse qs (string), and call the result q.");
	reads(`const r = z.safeParse(UserSchema, input);`, "Let r be the outcome of validating input against user schema.");
});

test("a partial translation reports what it is missing", () => {
	const gaps = phrasebookGaps(zodEn, { schema: () => "", base: { string: "texto" } });
	expect(gaps.missing).toContain("base.number");
	expect(gaps.missing).toContain("modifiers.optional");
	expect(gaps.missing).not.toContain("schema");
	expect(gaps.extra).toEqual([]);
});
