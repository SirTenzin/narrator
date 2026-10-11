import { describe, expect, test } from "bun:test";
import { grammar } from "@usenarrator/locale-en";
import { narrate } from "@usenarrator/testkit";

describe("articles", () => {
	test("initialisms take the article of their first letter's name", () => {
		expect(
			["HTTP client", "SQL query", "API key", "MCP server", "ID", "URL", "UUID", "JSON body", "x", "user", "hour"].map((w) => `${grammar.article(w)} ${w}`),
		).toEqual(["an HTTP client", "an SQL query", "an API key", "an MCP server", "an ID", "a URL", "a UUID", "a JSON body", "an x", "a user", "an hour"]);
	});
});

describe("identifiers", () => {
	test("HTTP methods and short initialisms keep their casing; other constants read as words", () => {
		expect(narrate("const m = GET; const s = KV; const t = MAX_RETRIES; const u = TIERS;")).toBe(
			"Let m be GET.\nLet s be KV.\nLet t be max retries.\nLet u be tiers.",
		);
	});

	test("an object key spelled like its value reads once", () => {
		expect(narrate("const a = { entity_id: entityId, plan: x };")).toBe("Let a be an object with entity ID and plan: x.");
	});
});

describe("functions", () => {
	test("list parameters say they are lists", () => {
		expect(narrate("function f(items: Item[], prices: ReadonlyArray<Price> | null, one: Item) {}")).toBe(
			"To f, given items (a list of Item), prices (a list of Price), and one (Item):\n  Do nothing.",
		);
	});

	test("returning a literal true/false gives back the value itself", () => {
		expect(narrate("function f(x) { if (x) return true; return false; }")).toBe("To f, given x:\n  If x is set, give back true.\n  Give back false.");
	});

	test("new.target reads as whether the function was called with new", () => {
		expect(narrate('function F() { if (!new.target) throw new Error("x"); }')).toBe('To F:\n  If this was not called with new, fail with an error: "x".');
	});
});

describe("this", () => {
	test("members read as this object's; verb methods drop the receiver", () => {
		expect(narrate("class A { add(x) { this.jobs.push(x); this.flush(); return this.size; } }")).toBe(
			"Class A:\n  To add, given x:\n    Add x to this object's jobs.\n    Flush.\n    Give back this object's size.",
		);
	});
});

describe("schemas", () => {
	test("z.infer, z.input and z.output read as the schema's shape", () => {
		expect(narrate("type T = z.infer<typeof S>; type I = z.input<typeof S>; type O = z.output<typeof S>;")).toBe(
			"Type (T): the shape of the schema (S).\nType (I): the input shape of the schema (S).\nType (O): the output shape of the schema (S).",
		);
	});
});
