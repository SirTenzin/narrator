import { D, type Doc, plain } from "@usenarrator/core";
import { type CallRule, definePlugin, type Engine, type N, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { en } from "./en";
import type { TestingPhrases } from "./phrases";

export type { TestingPhrases } from "./phrases";
export { en as testingEn };

const isFn = (n: N) => n && (unwrap(n).type === "ArrowFunctionExpression" || unwrap(n).type === "FunctionExpression");

type Matcher = keyof TestingPhrases["matchers"];

/** Matchers whose arguments are all call arguments, read together as one list. */
const CALL_ARGS = new Set(["toHaveBeenCalledWith", "toHaveBeenLastCalledWith", "toHaveBeenNthCalledWith"]);

/** `expect(() => run(x))` reads as "running run (x)"; other subjects read as themselves. */
function subjectOf({ e, node, say }: { e: Engine; node: N; say: TestingPhrases }): Doc {
	const u = unwrap(node);
	if (isFn(u) && !u.params.length && u.body.type !== "BlockStatement") {
		const body = unwrap(u.body);
		const act = body.type === "CallExpression" ? e.call(body, true) : e.noun(body);
		return D(say.running({ action: act.t }), act.kids);
	}
	return e.noun(node);
}

/** `expect(x).not.toBe(y)` -> "check that x is not y". */
function expectChain({ e, node, say }: { e: Engine; node: N; say: TestingPhrases }): Doc | null {
	const steps: { m: string; args: N[] }[] = [];
	let cur = unwrap(node);
	let neg = false;
	let settle: "resolves" | "rejects" | null = null;
	while (cur && (cur.type === "CallExpression" || cur.type === "MemberExpression")) {
		if (cur.type === "CallExpression") {
			const c = unwrap(cur.callee);
			if (c.type === "Identifier" && c.name === "expect") {
				const last = steps[0];
				if (!last) return null;
				return claimDoc({ e, say, subject: subjectOf({ e, node: cur.arguments[0], say }), matcher: last.m, args: last.args, neg, settle });
			}
			const m = c.type === "MemberExpression" ? c.property.name : null;
			if (!m) return null;
			steps.unshift({ m, args: cur.arguments });
			cur = unwrap(c.object);
			continue;
		}
		const p = cur.property?.name;
		if (p === "not") neg = !neg;
		else if (p === "resolves" || p === "rejects") settle = p;
		else return null;
		cur = unwrap(cur.object);
	}
	return null;
}

function claimDoc({
	e,
	say,
	subject,
	matcher,
	args,
	neg,
	settle,
}: {
	e: Engine;
	say: TestingPhrases;
	subject: Doc;
	matcher: string;
	args: N[];
	neg: boolean;
	settle: "resolves" | "rejects" | null;
}): Doc {
	const nth = matcher === "toHaveBeenNthCalledWith" ? args[0] : null;
	const shown = (nth ? args.slice(1) : CALL_ARGS.has(matcher) ? args : args.slice(0, 1)).map((a) => e.noun(a));
	const expected = e.g.list(shown.map((a) => a.t));
	const kids = [...subject.kids, ...shown.flatMap((a) => a.kids)];
	if (settle === "rejects" && /^toThrow/.test(matcher)) return D(say.rejectsWith({ subject: subject.t, expected, neg }), kids);
	const about = settle === "resolves" ? say.resolved({ subject: subject.t }) : settle === "rejects" ? say.rejected({ subject: subject.t }) : subject.t;
	const claim = nth
		? say.nthCall({ n: e.text(nth), expected, neg })
		: Object.hasOwn(say.matchers, matcher)
			? say.matchers[matcher as Matcher]({ expected, neg, article: e.g.article(plain(expected)) })
			: say.otherMatcher({ words: e.lex.humanize(matcher.slice(2)).split(" "), expected, neg });
	return D(say.check({ subject: about, claim }), kids);
}

/** A test or hook block; `heading` is only rendered once the callback is known to be a function. */
function testBlock({ e, fn, heading }: { e: Engine; fn: N; heading: () => string }): Doc | null {
	const f = fn && unwrap(fn);
	if (!f || !isFn(f)) return null;
	const title = heading();
	const body = f.body.type === "BlockStatement" ? f.body : { type: "ExpressionStatement", expression: f.body, start: f.body.start, end: f.body.end };
	return D(`${title}:`, e.body(body, 0));
}

const named =
	(block: "describe" | "test"): CallRule<TestingPhrases> =>
	({ args: [name, fn], e, say }) =>
		testBlock({ e, fn, heading: () => say.blocks[block]({ name: name ? e.text(name) : null }) });

const hook =
	(block: "beforeAll" | "beforeEach" | "afterAll" | "afterEach"): CallRule<TestingPhrases> =>
	({ args, e, say }) =>
		testBlock({ e, fn: args[0], heading: () => say.blocks[block] });

/** Matchers read through `otherMatcher`: their name after `to` conjugates into English on its own. */
const OTHER_MATCHERS = [
	"toMatchSnapshot",
	"toMatchInlineSnapshot",
	"toThrowError",
	"toThrowErrorMatchingSnapshot",
	"toThrowErrorMatchingInlineSnapshot",
	"toHaveBeenCalledOnce",
	"toHaveBeenCalledExactlyOnceWith",
	"toHaveReturned",
	"toHaveReturnedTimes",
	"toHaveReturnedWith",
	"toHaveLastReturnedWith",
	"toBeTypeOf",
	"toBeOneOf",
	"toBeEmpty",
	"toBeArray",
	"toBeArrayOfSize",
	"toBeString",
	"toBeNumber",
	"toBeBoolean",
	"toBeFunction",
	"toBeObject",
	"toBeTrue",
	"toBeFalse",
	"toBeDate",
	"toBeInteger",
	"toBeFinite",
	"toBePositive",
	"toBeNegative",
	"toBeEven",
	"toBeOdd",
	"toBeWithin",
	"toBeNil",
	"toInclude",
	"toHaveKey",
	"toContainKey",
	"toContainKeys",
	"toContainValue",
	"toContainAllKeys",
	"toContainAnyKeys",
	"toResolve",
	"toReject",
];

const expectRule: CallRule<TestingPhrases> = ({ node, e, say }) => expectChain({ e, node, say });

const asymmetric =
	(kind: "objectContaining" | "arrayContaining" | "stringContaining" | "stringMatching"): CallRule<TestingPhrases> =>
	({ args, e, say, obj }) => {
		const negated = !!obj && unwrap(obj).type === "MemberExpression" && unwrap(obj).property?.name === "not";
		const wrap = (t: string) => (negated ? say.asymmetric.not({ matcher: t }) : t);
		if (kind !== "objectContaining" || unwrap(args[0])?.type !== "ObjectExpression") {
			const v = e.noun(args[0]);
			return D(wrap(say.asymmetric[kind]({ value: v.t })), v.kids);
		}
		const { items, joined, inline } = e.argItems(args);
		if (inline) return D(wrap(say.asymmetric.objectContaining({ value: joined })));
		return D(
			`${wrap(say.asymmetric.objectContaining({ value: "" })).trimEnd()}:`,
			items.flatMap((i) => e.bullet(i)),
		);
	};

const testRules: Record<string, CallRule<TestingPhrases>> = {
	describe: named("describe"),
	test: named("test"),
	it: named("test"),
	beforeAll: hook("beforeAll"),
	beforeEach: hook("beforeEach"),
	afterAll: hook("afterAll"),
	afterEach: hook("afterEach"),
	...Object.fromEntries([...Object.keys(en.matchers), ...OTHER_MATCHERS].map((m) => [`*.${m}`, expectRule])),
	"expect.objectContaining": asymmetric("objectContaining"),
	"expect.arrayContaining": asymmetric("arrayContaining"),
	"expect.stringContaining": asymmetric("stringContaining"),
	"expect.stringMatching": asymmetric("stringMatching"),
	"*.not.objectContaining": asymmetric("objectContaining"),
	"*.not.arrayContaining": asymmetric("arrayContaining"),
	"*.not.stringContaining": asymmetric("stringContaining"),
	"*.not.stringMatching": asymmetric("stringMatching"),
	"expect.any": ({ args, e, say }) => {
		const t = unwrap(args[0]);
		if (t?.type !== "Identifier") return null;
		return D(say.asymmetric.any({ name: t.name, type: e.noun(t).t }));
	},
	"expect.anything": ({ say }) => D(say.asymmetric.anything),
	"expect.assertions": ({ args, e, say }) => D(say.assertions({ count: args[0] ? e.text(args[0]) : null })),
	"expect.hasAssertions": ({ say }) => D(say.assertions({ count: null })),
};

/** bun:test, vitest and jest: `describe`/`test`/`it` blocks and `expect(...)` matchers. */
export const testing = (): TsPlugin<TestingPhrases> => definePlugin({ name: "testing", phrases: { en }, calls: testRules });
