/**
 * A matcher's claim about the subject. `expected` is the rendered matcher argument ("" when there is none; a joined list for
 * call-argument matchers); `article` is the locale's article for `expected`.
 */
type Claim = (p: { expected: string; neg: boolean; article: string }) => string;

type MatcherName =
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
	| "toContainEqual"
	| "toMatch"
	| "toStartWith"
	| "toEndWith"
	| "toThrow"
	| "toBeGreaterThan"
	| "toBeLessThan"
	| "toBeGreaterThanOrEqual"
	| "toBeLessThanOrEqual"
	| "toBeCloseTo"
	| "toHaveProperty"
	| "toBeInstanceOf"
	| "toSatisfy"
	| "toHaveBeenCalled"
	| "toHaveBeenCalledTimes"
	| "toHaveBeenCalledWith"
	| "toHaveBeenLastCalledWith"
	| "toHaveBeenNthCalledWith";

/** Everything the test-runner plugin says. Arguments are already-rendered markup strings. */
export type TestingPhrases = {
	/** `expect(subject).<matcher>(…)`; `claim` is one of `matchers`. */
	check: (p: { subject: string; claim: string }) => string;
	/** `expect(isReady(x)).toBe(true)`: the subject is already a yes/no condition. */
	checkThat: (p: { condition: string }) => string;
	matchers: Record<MatcherName, Claim>;
	/** `expect(fn).toHaveBeenNthCalledWith(n, …)`: `n` is the 1-based call number, `expected` the remaining arguments. */
	nthCall: (p: { n: string; expected: string; neg: boolean }) => string;
	/** A matcher without its own phrase; `words` is its name after `to`, read as lowercase words (`toMatchSnapshot` -> ["match", "snapshot"]). */
	otherMatcher: (p: { words: string[]; expected: string; neg: boolean }) => string;
	/** `expect(p).resolves.…` / `expect(p).rejects.…`: the subject the matcher then talks about. */
	resolved: (p: { subject: string }) => string;
	rejected: (p: { subject: string }) => string;
	/** `expect(p).rejects.toThrow(…)`. */
	rejectsWith: (p: { subject: string; expected: string; neg: boolean }) => string;
	/** `expect(() => run()).toThrow()`: the subject is the act of running the callback. */
	running: (p: { action: string }) => string;
	/** `expect.objectContaining({…})` and friends, used as expected values. */
	asymmetric: {
		objectContaining: (p: { value: string }) => string;
		arrayContaining: (p: { value: string }) => string;
		stringContaining: (p: { value: string }) => string;
		stringMatching: (p: { value: string }) => string;
		/** `expect.any(Ctor)`; `name` is the constructor as written, `type` its display words. */
		any: (p: { name: string; type: string }) => string;
		anything: string;
		/** `expect.not.objectContaining(…)` etc.: `matcher` is one of the phrases above. */
		not: (p: { matcher: string }) => string;
	};
	/** `expect.assertions(n)` / `expect.hasAssertions()`. */
	assertions: (p: { count: string | null }) => string;
	/** Jest-style mocks; `mock` is the rendered mock, `target` the spied-on method. */
	mocks: {
		spyOn: (p: { target: string }) => string;
		mockFunction: string;
		/** A mock function with an implementation, shown as a block. */
		mockRunning: string;
		/** `once`: only for the next call. `stmt`: run as a step rather than read as a value. The implementation follows as a block. */
		implementation: (p: { mock: string; once: boolean; stmt: boolean }) => string;
		returns: (p: { mock: string; value: string; once: boolean; stmt: boolean }) => string;
		resolves: (p: { mock: string; value: string; once: boolean; stmt: boolean }) => string;
		rejects: (p: { mock: string; value: string; once: boolean; stmt: boolean }) => string;
		restore: (p: { mock: string }) => string;
		clear: (p: { mock: string }) => string;
		reset: (p: { mock: string }) => string;
	};
	/** Block headings; `name` is the rendered test name, or null when there is none. */
	blocks: {
		describe: (p: { name: string | null }) => string;
		test: (p: { name: string | null }) => string;
		beforeAll: string;
		beforeEach: string;
		afterAll: string;
		afterEach: string;
		/** A heading with how the block runs: `test.skip`, `test.todo`, `test.only`, `test.if(c)`, `test.skipIf(c)`, `test.each(rows)`. */
		skipped: (p: { heading: string }) => string;
		only: (p: { heading: string }) => string;
		onlyWhen: (p: { heading: string; condition: string }) => string;
		skippedWhen: (p: { heading: string; condition: string }) => string;
		forEach: (p: { heading: string; rows: string }) => string;
		/** `test.each([...])` whose cases are too long to list inline. */
		forEachOf: (p: { heading: string; count: number }) => string;
	};
};
