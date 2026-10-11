import { plain } from "@usenarrator/core";
import type { TestingPhrases } from "./phrases";

const not = (neg: boolean) => (neg ? " not" : "");
const sp = (s: string) => (s ? ` ${s}` : "");
const named =
	(label: string) =>
	({ name }: { name: string | null }) =>
		`${label}${name ? ` ${name}` : ""}`;

const times = (count: string) => {
	const n = plain(count);
	return n === "1" ? "once" : n === "2" ? "twice" : `${count} times`;
};

const thirdPerson = (verb: string) => {
	if (/(s|x|z|ch|sh)$/.test(verb)) return `${verb}es`;
	if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ies`;
	return `${verb}s`;
};

/** `["match", "snapshot"]` -> "matches snapshot"; `["be", "empty"]` -> "is empty"; `["have", "been", …]` -> "was …". */
const conjugate = (words: string[], neg: boolean) => {
	const [head = "", ...rest] = words;
	const tail = rest.join(" ");
	if (head === "be") return `is${not(neg)}${sp(tail)}`;
	if (head === "have" && rest[0] === "been") return `was${not(neg)}${sp(rest.slice(1).join(" "))}`;
	if (head === "have") return `${neg ? "does not have" : "has"}${sp(tail)}`;
	return `${neg ? `does not ${head}` : thirdPerson(head)}${sp(tail)}`;
};

const ANY_TYPE: Record<string, string> = {
	String: "any text",
	Number: "any number",
	Boolean: "any true/false value",
	Function: "any function",
	Object: "any object",
	Array: "any list",
	Date: "any date",
	BigInt: "any big number",
	Symbol: "any symbol",
};

export const en: TestingPhrases = {
	check: ({ subject, claim }) => `check that ${subject} ${claim}`,
	checkThat: ({ condition }) => `check that ${condition}`,
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
		toHaveLength: ({ expected, neg }) => {
			const n = plain(expected);
			if (n === "0") return neg ? "is not empty" : "is empty";
			return `${neg ? "does not have" : "has"} ${expected} ${n === "1" ? "item" : "items"}`;
		},
		toContain: ({ expected, neg }) => `${neg ? "does not contain" : "contains"} ${expected}`,
		toContainEqual: ({ expected, neg }) => `${neg ? "does not contain" : "contains"} an item equal to ${expected}`,
		toMatch: ({ expected, neg }) => `${neg ? "does not match" : "matches"} ${expected}`,
		toStartWith: ({ expected, neg }) => `${neg ? "does not start" : "starts"} with ${expected}`,
		toEndWith: ({ expected, neg }) => `${neg ? "does not end" : "ends"} with ${expected}`,
		toThrow: ({ expected, neg }) => (neg ? "does not throw" : `throws${expected ? ` ${expected}` : ""}`),
		toBeGreaterThan: ({ expected, neg }) => `is${not(neg)} more than ${expected}`,
		toBeLessThan: ({ expected, neg }) => `is${not(neg)} less than ${expected}`,
		toBeGreaterThanOrEqual: ({ expected, neg }) => `is${not(neg)} at least ${expected}`,
		toBeLessThanOrEqual: ({ expected, neg }) => `is${not(neg)} at most ${expected}`,
		toBeCloseTo: ({ expected, neg }) => `is${not(neg)} about ${expected}`,
		toHaveProperty: ({ expected, neg }) => `${neg ? "has no" : "has a"} ${expected} property`,
		toBeInstanceOf: ({ expected, neg, article }) => `is${not(neg)} ${article} ${expected}`,
		toSatisfy: ({ expected, neg }) => `${neg ? "does not pass" : "passes"} ${expected}`,
		toHaveBeenCalled: ({ neg }) => (neg ? "was never called" : "was called"),
		toHaveBeenCalledTimes: ({ expected, neg }) => `was${not(neg)} called ${times(expected)}`,
		toHaveBeenCalledWith: ({ expected, neg }) =>
			expected ? `was ${neg ? "never " : ""}called with ${expected}` : `was ${neg ? "never " : ""}called with nothing`,
		toHaveBeenLastCalledWith: ({ expected, neg }) => `was${not(neg)} last called with ${expected || "nothing"}`,
		toHaveBeenNthCalledWith: ({ expected, neg }) => `was${not(neg)} called with ${expected || "nothing"}`,
	},
	nthCall: ({ n, expected, neg }) => {
		const k = plain(n);
		const ord = { "1": "first", "2": "second", "3": "third", "4": "fourth", "5": "fifth" }[k];
		return `${ord ? `was${not(neg)} called with ${expected || "nothing"} the ${ord} time` : `was${not(neg)} called with ${expected || "nothing"} on call ${n}`}`;
	},
	otherMatcher: ({ words, expected, neg }) => `${conjugate(words, neg)}${sp(expected)}`,
	resolved: ({ subject }) => `the result of ${subject}`,
	rejected: ({ subject }) => `the error from ${subject}`,
	rejectsWith: ({ subject, expected, neg }) =>
		neg ? `check that ${subject} does not fail` : `check that ${subject} fails${expected ? ` with ${expected}` : ""}`,
	running: ({ action }) => `running ${action}`,
	asymmetric: {
		objectContaining: ({ value }) => `an object containing ${value}`,
		arrayContaining: ({ value }) => `a list containing ${value}`,
		stringContaining: ({ value }) => `text containing ${value}`,
		stringMatching: ({ value }) => `text matching ${value}`,
		any: ({ name, type }) => ANY_TYPE[name] ?? `any ${type}`,
		anything: "anything",
		not: ({ matcher }) => `not ${matcher}`,
	},
	assertions: ({ count }) => (count ? `expect ${count} ${plain(count) === "1" ? "check" : "checks"} to run` : "expect at least one check to run"),
	mocks: {
		spyOn: ({ target }) => `a spy on ${target}`,
		mockFunction: "a mock function",
		implementation: ({ mock, once, stmt }) => `${stmt ? `make ${mock} run` : `${mock}, which runs`} this${once ? " (once)" : ""}`,
		returns: ({ mock, value, once, stmt }) => `${stmt ? `make ${mock} return` : `${mock}, returning`} ${value}${once ? " (once)" : ""}`,
		resolves: ({ mock, value, once, stmt }) => `${stmt ? `make ${mock} resolve to` : `${mock}, resolving to`} ${value}${once ? " (once)" : ""}`,
		rejects: ({ mock, value, once, stmt }) => `${stmt ? `make ${mock} fail with` : `${mock}, failing with`} ${value}${once ? " (once)" : ""}`,
		restore: ({ mock }) => `put back what ${mock} replaced`,
		clear: ({ mock }) => `clear the calls recorded by ${mock}`,
		reset: ({ mock }) => `reset ${mock}`,
	},
	blocks: {
		describe: named("Test group"),
		test: named("Test"),
		beforeAll: "Before all tests",
		beforeEach: "Before each test",
		afterAll: "After all tests",
		afterEach: "After each test",
		skipped: ({ heading }) => `${heading} (skipped)`,
		only: ({ heading }) => `${heading} (run on its own)`,
		onlyWhen: ({ heading, condition }) => `${heading} (only when ${condition})`,
		skippedWhen: ({ heading, condition }) => `${heading} (skipped when ${condition})`,
		forEach: ({ heading, rows }) => `${heading}, for each case in ${rows}`,
		forEachOf: ({ heading, count }) => `${heading}, for each of ${count} ${count === 1 ? "case" : "cases"}`,
	},
};
