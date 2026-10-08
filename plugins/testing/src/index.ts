import { D, type Doc } from "@narrate/core";
import { definePlugin, type Engine, type N, type TsPlugin, unwrap } from "@narrate/lang-ts";

const isFn = (n: N) => n && (unwrap(n).type === "ArrowFunctionExpression" || unwrap(n).type === "FunctionExpression");

/** bun:test / vitest / jest. */
function expectChain(e: Engine, node: N): Doc | null {
	const steps: { m: string; args: N[] }[] = [];
	let cur = unwrap(node);
	let neg = false;
	while (cur && (cur.type === "CallExpression" || cur.type === "MemberExpression")) {
		if (cur.type === "CallExpression") {
			const c = unwrap(cur.callee);
			if (c.type === "Identifier" && c.name === "expect") {
				const subject = e.noun(cur.arguments[0]);
				const last = steps[0];
				if (!last) return null;
				const arg = last.args[0] ? e.text(last.args[0]) : "";
				const not = neg ? " not" : "";
				const M: Record<string, string> = {
					toBe: `is${not} ${arg}`,
					toEqual: `${neg ? "does not equal" : "equals"} ${arg}`,
					toStrictEqual: `${neg ? "does not equal" : "equals"} ${arg}`,
					toMatchObject: `${neg ? "does not match" : "matches"} ${arg}`,
					toBeDefined: neg ? "is missing" : "is set",
					toBeUndefined: neg ? "is set" : "is missing",
					toBeNull: neg ? "is not null" : "is null",
					toBeTruthy: neg ? "is falsy" : "is truthy",
					toBeFalsy: neg ? "is truthy" : "is falsy",
					toHaveLength: `has${not} ${arg} item(s)`,
					toContain: `${neg ? "does not contain" : "contains"} ${arg}`,
					toThrow: neg ? "does not throw" : `throws${arg ? ` ${arg}` : ""}`,
					toBeGreaterThan: `is${not} more than ${arg}`,
					toBeLessThan: `is${not} less than ${arg}`,
					toBeGreaterThanOrEqual: `is${not} at least ${arg}`,
					toBeLessThanOrEqual: `is${not} at most ${arg}`,
					toBeCloseTo: `is${not} about ${arg}`,
					toHaveProperty: `has${not} a ${arg} property`,
					toBeInstanceOf: `is${not} a ${arg}`,
					toHaveBeenCalled: neg ? "was never called" : "was called",
					toHaveBeenCalledTimes: `was called ${arg} time(s)`,
					toHaveBeenCalledWith: `was called with ${arg}`,
				};
				const verb = M[last.m] ?? `${e.lex.humanize(last.m)}${not} ${arg}`;
				return D(`check that ${subject.t} ${verb}`, subject.kids);
			}
			const m = c.type === "MemberExpression" ? c.property.name : null;
			if (!m) return null;
			steps.unshift({ m, args: cur.arguments });
			cur = unwrap(c.object);
			continue;
		}
		if (cur.property?.name === "not") neg = !neg;
		else if (cur.property?.name === "resolves" || cur.property?.name === "rejects") {
		} else return null;
		cur = unwrap(cur.object);
	}
	return null;
}

const testRules: TsPlugin["calls"] = {
	describe: ({ args, e }) => testBlock(e, "Test group", args),
	test: ({ args, e }) => testBlock(e, "Test", args),
	it: ({ args, e }) => testBlock(e, "Test", args),
	beforeAll: ({ args, e }) => testBlock(e, "Before all tests", [null, ...args]),
	beforeEach: ({ args, e }) => testBlock(e, "Before each test", [null, ...args]),
	afterAll: ({ args, e }) => testBlock(e, "After all tests", [null, ...args]),
	afterEach: ({ args, e }) => testBlock(e, "After each test", [null, ...args]),
	"*.toBe": ({ node, e }) => expectChain(e, node),
	"*.toEqual": ({ node, e }) => expectChain(e, node),
	"*.toStrictEqual": ({ node, e }) => expectChain(e, node),
	"*.toMatchObject": ({ node, e }) => expectChain(e, node),
	"*.toBeDefined": ({ node, e }) => expectChain(e, node),
	"*.toBeUndefined": ({ node, e }) => expectChain(e, node),
	"*.toBeNull": ({ node, e }) => expectChain(e, node),
	"*.toBeTruthy": ({ node, e }) => expectChain(e, node),
	"*.toBeFalsy": ({ node, e }) => expectChain(e, node),
	"*.toHaveLength": ({ node, e }) => expectChain(e, node),
	"*.toContain": ({ node, e }) => expectChain(e, node),
	"*.toThrow": ({ node, e }) => expectChain(e, node),
	"*.toBeGreaterThan": ({ node, e }) => expectChain(e, node),
	"*.toBeLessThan": ({ node, e }) => expectChain(e, node),
	"*.toBeGreaterThanOrEqual": ({ node, e }) => expectChain(e, node),
	"*.toBeLessThanOrEqual": ({ node, e }) => expectChain(e, node),
	"*.toBeCloseTo": ({ node, e }) => expectChain(e, node),
	"*.toHaveProperty": ({ node, e }) => expectChain(e, node),
	"*.toBeInstanceOf": ({ node, e }) => expectChain(e, node),
};

function testBlock(e: Engine, label: string, args: (N | null)[]): Doc | null {
	const [name, fn] = args;
	const f = fn && unwrap(fn);
	if (!f || !isFn(f)) return null;
	const title = name ? ` ${e.text(name)}` : "";
	const ex = f.body.type === "BlockStatement" ? null : f.body;
	const lines = ex ? [{ d: 0, text: e.text(ex), start: -1, end: -1, kind: "stmt" as const }] : e.body(f.body, 0);
	return D(`${label}${title}:`, lines);
}

/** bun:test, vitest and jest: `describe`/`test`/`it` blocks and `expect(...)` matchers. */
export const testing = (): TsPlugin => definePlugin({ name: "testing", calls: testRules });
