/** A matcher's claim about the subject; `expected` is the rendered matcher argument ("" when there is none). */
type Claim = (p: { expected: string; neg: boolean }) => string;

/** Everything the test-runner plugin says. Arguments are already-rendered markup strings. */
export type TestingPhrases = {
	/** `expect(subject).<matcher>(…)`; `claim` is one of `matchers`. */
	check: (p: { subject: string; claim: string }) => string;
	matchers: Record<
		| "toBe"
		| "toEqual"
		| "toStrictEqual"
		| "toMatchObject"
		| "toBeDefined"
		| "toBeUndefined"
		| "toBeNull"
		| "toBeTruthy"
		| "toBeFalsy"
		| "toHaveLength"
		| "toContain"
		| "toThrow"
		| "toBeGreaterThan"
		| "toBeLessThan"
		| "toBeGreaterThanOrEqual"
		| "toBeLessThanOrEqual"
		| "toBeCloseTo"
		| "toHaveProperty"
		| "toBeInstanceOf"
		| "toHaveBeenCalled"
		| "toHaveBeenCalledTimes"
		| "toHaveBeenCalledWith",
		Claim
	>;
	/** A matcher without its own phrase; `matcher` is its name read as words. */
	otherMatcher: (p: { matcher: string; expected: string; neg: boolean }) => string;
	/** Block headings; `name` is the rendered test name, or null when there is none. */
	blocks: {
		describe: (p: { name: string | null }) => string;
		test: (p: { name: string | null }) => string;
		beforeAll: string;
		beforeEach: string;
		afterAll: string;
		afterEach: string;
	};
};
