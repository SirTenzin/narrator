import { D, type Doc } from "@usenarrator/core";
import { type CallRule, definePlugin, type Engine, type N, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { en } from "./en";
import type { TestingPhrases } from "./phrases";

export type { TestingPhrases } from "./phrases";
export { en, en as testingEn };

const isFn = (n: N) => n && (unwrap(n).type === "ArrowFunctionExpression" || unwrap(n).type === "FunctionExpression");

/** `expect(x).not.toBe(y)` -> "check that x is not y". */
function expectChain({ e, node, say }: { e: Engine; node: N; say: TestingPhrases }): Doc | null {
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
				const expected = last.args[0] ? e.text(last.args[0]) : "";
				const claim = Object.hasOwn(say.matchers, last.m)
					? say.matchers[last.m as keyof TestingPhrases["matchers"]]({ expected, neg })
					: say.otherMatcher({ matcher: e.lex.humanize(last.m), expected, neg });
				return D(say.check({ subject: subject.t, claim }), subject.kids);
			}
			const m = c.type === "MemberExpression" ? c.property.name : null;
			if (!m) return null;
			steps.unshift({ m, args: cur.arguments });
			cur = unwrap(c.object);
			continue;
		}
		if (cur.property?.name === "not") neg = !neg;
		else if (cur.property?.name !== "resolves" && cur.property?.name !== "rejects") return null;
		cur = unwrap(cur.object);
	}
	return null;
}

/** A test or hook block; `heading` is only rendered once the callback is known to be a function. */
function testBlock({ e, fn, heading }: { e: Engine; fn: N; heading: () => string }): Doc | null {
	const f = fn && unwrap(fn);
	if (!f || !isFn(f)) return null;
	const title = heading();
	const ex = f.body.type === "BlockStatement" ? null : f.body;
	const lines = ex ? [{ d: 0, text: e.text(ex), start: -1, end: -1, kind: "stmt" as const }] : e.body(f.body, 0);
	return D(`${title}:`, lines);
}

const named =
	(block: "describe" | "test"): CallRule<TestingPhrases> =>
	({ args: [name, fn], e, say }) =>
		testBlock({ e, fn, heading: () => say.blocks[block]({ name: name ? e.text(name) : null }) });

const hook =
	(block: "beforeAll" | "beforeEach" | "afterAll" | "afterEach"): CallRule<TestingPhrases> =>
	({ args, e, say }) =>
		testBlock({ e, fn: args[0], heading: () => say.blocks[block] });

const MATCHERS: (keyof TestingPhrases["matchers"])[] = [
	"toBe",
	"toEqual",
	"toStrictEqual",
	"toMatchObject",
	"toBeDefined",
	"toBeUndefined",
	"toBeNull",
	"toBeTruthy",
	"toBeFalsy",
	"toHaveLength",
	"toContain",
	"toThrow",
	"toBeGreaterThan",
	"toBeLessThan",
	"toBeGreaterThanOrEqual",
	"toBeLessThanOrEqual",
	"toBeCloseTo",
	"toHaveProperty",
	"toBeInstanceOf",
];

const expectRule: CallRule<TestingPhrases> = ({ node, e, say }) => expectChain({ e, node, say });

const testRules: Record<string, CallRule<TestingPhrases>> = {
	describe: named("describe"),
	test: named("test"),
	it: named("test"),
	beforeAll: hook("beforeAll"),
	beforeEach: hook("beforeEach"),
	afterAll: hook("afterAll"),
	afterEach: hook("afterEach"),
	...Object.fromEntries(MATCHERS.map((m) => [`*.${m}`, expectRule])),
};

/** bun:test, vitest and jest: `describe`/`test`/`it` blocks and `expect(...)` matchers. */
export const testing = (): TsPlugin<TestingPhrases> => definePlugin({ name: "testing", phrases: { en }, calls: testRules });

declare module "@usenarrator/core" {
	interface PluginPhrases {
		testing: TestingPhrases;
	}
}
