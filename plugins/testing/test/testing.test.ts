import { expect, test } from "bun:test";
import { narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
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
		`Test group "cart":\n  Before each test:\n    Reset.\n  Test "is empty":\n    Check that cart's items is empty.`,
	));

test("negated and argument-less matchers", () => {
	reads(`expect(result).not.toBeNull();`, "Check that result is not null.");
	reads(`expect(user.id).toBeDefined();`, "Check that user's ID is set.");
	reads(`expect(total).not.toBeGreaterThan(10);`, "Check that total is not more than 10.");
});

test("lengths read as empty or as a real count", () => {
	reads(`expect(xs).toHaveLength(0);`, "Check that xs is empty.");
	reads(`expect(xs).not.toHaveLength(0);`, "Check that xs is not empty.");
	reads(`expect(xs).toHaveLength(1);`, "Check that xs has 1 item.");
	reads(`expect(xs).toHaveLength(3);`, "Check that xs has 3 items.");
});

test("mock call matchers", () => {
	reads(`expect(send).toHaveBeenCalled();`, "Check that send was called.");
	reads(`expect(send).not.toHaveBeenCalled();`, "Check that send was never called.");
	reads(`expect(send).toHaveBeenCalledTimes(2);`, "Check that send was called twice.");
	reads(`expect(send).toHaveBeenCalledWith(a, 2);`, "Check that send was called with a and 2.");
	reads(`expect(send).toHaveBeenNthCalledWith(2, a);`, "Check that send was called with a the second time.");
});

test("other matchers conjugate their own name", () => {
	reads(`expect(s).toMatch(/x/);`, "Check that s matches /x/.");
	reads(`expect(view).toMatchSnapshot();`, "Check that view matches snapshot.");
	reads(`expect(list).toBeEmpty();`, "Check that list is empty.");
	reads(`expect(e).toBeInstanceOf(HTTPError);`, "Check that e is an HTTP error.");
});

test("promises, thrown errors and asymmetric matchers", () => {
	reads(`await expect(load()).rejects.toThrow("nope");`, `Check that load fails with "nope".`);
	reads(`await expect(load()).resolves.toBe(3);`, "Check that the result of load is 3.");
	reads(`expect(() => parse(x)).toThrow();`, "Check that running parse (x) throws.");
	reads(
		`expect(r).toEqual(expect.objectContaining({ id: 1, name: expect.any(String) }));`,
		"Check that r equals an object containing ID: 1 and name: any text.",
	);
});

test("toBe(true/false) on a yes/no subject reads as the condition itself", () => {
	reads(`expect(Array.isArray(x)).toBe(true);`, "Check that x is a list.");
	reads(`expect(isValid(y)).toBe(false);`, "Check that y is not valid.");
	reads(`expect(x.enabled).toBe(true);`, "Check that x's enabled is true.");
});

test("test variants", () => {
	reads(`test.concurrent("a", () => { run(); });`, `Test "a":\n  Run.`);
	reads(`test.skip("b", () => { run(); });`, `Test "b" (skipped):\n  Run.`);
	reads(`test.todo("c");`, `Test "c" (skipped).`);
	reads(`test.if(isLinux)("d", () => { run(); });`, `Test "d" (only when it is linux):\n  Run.`);
	reads(`test.each([1, 2])("e %i", (n) => { expect(n).toBe(n); });`, `Test "e %i", for each case in a list of 1 and 2:\n  Check that n is n.`);
});

test("mocks and spies", () => {
	const text = narrateWithStats(
		`import { spyOn } from "bun:test";\nconst spy = spyOn(service, "getFull").mockResolvedValue(row);\nfetcher.mockReturnValueOnce(1);\nspy.mockRestore();`,
		{ plugins: [testing()] },
	).text;
	expect(text).toBe("Let spy be a spy on service's get full, resolving to row.\nMake fetcher return 1 (once).\nPut back what spy replaced.");
});

test("a partial translation reports what it is missing", () => {
	const gaps = phrasebookGaps(testingEn, { check: () => "", matchers: { toBe: () => "" }, blocks: { test: () => "" } });
	expect(gaps.missing).toContain("matchers.toEqual");
	expect(gaps.missing).toContain("blocks.beforeAll");
	expect(gaps.missing).toContain("otherMatcher");
	expect(gaps.extra).toEqual([]);
});
