import { expect, test } from "bun:test";
import { narrate } from "@narrate/testkit";
import { zod } from "../src";

test("an object schema lists its fields and modifiers", () => {
	const text = narrate(`const User = z.object({ email: z.string().email(), age: z.number().int().optional() });`, { plugins: [zod()] });
	expect(text).toContain("a schema for an object with email and age");
});
