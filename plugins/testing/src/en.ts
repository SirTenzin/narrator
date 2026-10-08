import type { TestingPhrases } from "./phrases";

const not = (neg: boolean) => (neg ? " not" : "");
const named =
	(label: string) =>
	({ name }: { name: string | null }) =>
		`${label}${name ? ` ${name}` : ""}`;

export const en: TestingPhrases = {
	check: ({ subject, claim }) => `check that ${subject} ${claim}`,
	matchers: {
		toBe: ({ expected, neg }) => `is${not(neg)} ${expected}`,
		toEqual: ({ expected, neg }) => `${neg ? "does not equal" : "equals"} ${expected}`,
		toStrictEqual: ({ expected, neg }) => `${neg ? "does not equal" : "equals"} ${expected}`,
		toMatchObject: ({ expected, neg }) => `${neg ? "does not match" : "matches"} ${expected}`,
		toBeDefined: ({ neg }) => (neg ? "is missing" : "is set"),
		toBeUndefined: ({ neg }) => (neg ? "is set" : "is missing"),
		toBeNull: ({ neg }) => (neg ? "is not null" : "is null"),
		toBeTruthy: ({ neg }) => (neg ? "is falsy" : "is truthy"),
		toBeFalsy: ({ neg }) => (neg ? "is truthy" : "is falsy"),
		toHaveLength: ({ expected, neg }) => `has${not(neg)} ${expected} item(s)`,
		toContain: ({ expected, neg }) => `${neg ? "does not contain" : "contains"} ${expected}`,
		toThrow: ({ expected, neg }) => (neg ? "does not throw" : `throws${expected ? ` ${expected}` : ""}`),
		toBeGreaterThan: ({ expected, neg }) => `is${not(neg)} more than ${expected}`,
		toBeLessThan: ({ expected, neg }) => `is${not(neg)} less than ${expected}`,
		toBeGreaterThanOrEqual: ({ expected, neg }) => `is${not(neg)} at least ${expected}`,
		toBeLessThanOrEqual: ({ expected, neg }) => `is${not(neg)} at most ${expected}`,
		toBeCloseTo: ({ expected, neg }) => `is${not(neg)} about ${expected}`,
		toHaveProperty: ({ expected, neg }) => `has${not(neg)} a ${expected} property`,
		toBeInstanceOf: ({ expected, neg }) => `is${not(neg)} a ${expected}`,
		toHaveBeenCalled: ({ neg }) => (neg ? "was never called" : "was called"),
		toHaveBeenCalledTimes: ({ expected }) => `was called ${expected} time(s)`,
		toHaveBeenCalledWith: ({ expected }) => `was called with ${expected}`,
	},
	otherMatcher: ({ matcher, expected, neg }) => `${matcher}${not(neg)} ${expected}`,
	blocks: {
		describe: named("Test group"),
		test: named("Test"),
		beforeAll: "Before all tests",
		beforeEach: "Before each test",
		afterAll: "After all tests",
		afterEach: "After each test",
	},
};
