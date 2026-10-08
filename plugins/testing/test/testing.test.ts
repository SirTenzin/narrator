import { expect, test } from "bun:test";
import { narrateWithStats, phrasebookGaps } from "@narrate/testkit";
import { testing, testingEn } from "../src";

const reads = (code: string, text: string) => {
	const r = narrateWithStats(code, { plugins: [testing()] });
	expect(r.text).toBe(text);
	expect(r.fallbacks).toBe(0);
};

test("a test block with an expectation", () => reads(`test("adds", () => { expect(add(1, 2)).toBe(3); });`, `Test "adds":\n  Check that add (1 and 2) is 3.`));

test("groups, hooks and matchers", () =>
	reads(
		`describe("cart", () => { beforeEach(() => reset()); it("is empty", () => { expect(cart.items).toHaveLength(0); }); });`,
		`Test group "cart":\n  Before each test:\n    reset\n  Test "is empty":\n    Check that cart's items has 0 item(s).`,
	));

test("negated and argument-less matchers", () => {
	reads(`expect(result).not.toBeNull();`, "Check that result is not null.");
	reads(`expect(user.id).toBeDefined();`, "Check that user's ID is set.");
	reads(`expect(total).not.toBeGreaterThan(10);`, "Check that total is not more than 10.");
});

test("a partial translation reports what it is missing", () => {
	const gaps = phrasebookGaps(testingEn, { check: () => "", matchers: { toBe: () => "" }, blocks: { test: () => "" } });
	expect(gaps.missing).toContain("matchers.toEqual");
	expect(gaps.missing).toContain("blocks.beforeAll");
	expect(gaps.missing).toContain("otherMatcher");
	expect(gaps.extra).toEqual([]);
});
