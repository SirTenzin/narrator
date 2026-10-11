import { D, type Doc, plain } from "@usenarrator/core";
import { type CallRule, definePlugin, type Engine, type N, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { en } from "./en";
import type { TestingPhrases } from "./phrases";

export type { TestingPhrases } from "./phrases";
export { en, en as testingEn };

/** A callback's body as statements: an expression body runs as a step when it's a call, and is given back otherwise. */
const fnBody = (fn: N): N => {
	if (fn.body.type === "BlockStatement") return fn.body;
	const wrapper =
		unwrap(fn.body).type === "CallExpression" ? { type: "ExpressionStatement", expression: fn.body } : { type: "ReturnStatement", argument: fn.body };
	return { ...wrapper, start: fn.body.start, end: fn.body.end };
};

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
				const truth = settle ? null : truthClaim({ m: last.m, args: last.args, neg });
				if (truth !== null && e.looksBoolean(cur.arguments[0])) {
					const cond = e.cond(cur.arguments[0], !truth);
					return D(say.checkThat({ condition: cond.t }), cond.kids);
				}
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

/** Whether a matcher asserts plain truth (`toBe(true)`, `toBeFalsy()`, …): true/false for which, null otherwise. */
function truthClaim({ m, args, neg }: { m: string; args: N[]; neg: boolean }): boolean | null {
	const a = unwrap(args[0]);
	const lit = a?.type === "Literal" && typeof a.value === "boolean" ? a.value : null;
	const said = /^(toBe|toEqual|toStrictEqual)$/.test(m)
		? lit
		: m === "toBeTruthy" || m === "toBeTrue"
			? true
			: m === "toBeFalsy" || m === "toBeFalse"
				? false
				: null;
	return said === null ? null : said !== neg;
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
	const lines = e.body(fnBody(f), 0);
	return lines.length ? D(`${title}:`, lines) : D(title);
}

type Mode = "plain" | "skip" | "only" | "if" | "skipIf" | "each";

/** `describe`/`test` and their variants; curried forms (`test.if(c)(…)`) read their extra argument off the inner call. */
const named =
	(block: "describe" | "test", mode: Mode = "plain"): CallRule<TestingPhrases> =>
	({ node, args: [name, fn], e, say }) => {
		const inner = unwrap(node.callee).type === "CallExpression" ? unwrap(node.callee).arguments[0] : null;
		if ((mode === "if" || mode === "skipIf" || mode === "each") && !inner) return null;
		const heading = () => {
			const h = say.blocks[block]({ name: name ? e.text(name) : null });
			const b = say.blocks;
			if (mode === "skip") return b.skipped({ heading: h });
			if (mode === "only") return b.only({ heading: h });
			if (mode === "if") return b.onlyWhen({ heading: h, condition: e.cond(inner).t });
			if (mode === "skipIf") return b.skippedWhen({ heading: h, condition: e.cond(inner).t });
			if (mode === "each") {
				const rows = e.noun(inner);
				if (!rows.kids.length) return b.forEach({ heading: h, rows: rows.t });
				const u = unwrap(inner);
				return u.type === "ArrayExpression" ? b.forEachOf({ heading: h, count: u.elements.length }) : b.forEach({ heading: h, rows: e.code(inner) });
			}
			return h;
		};
		if (mode === "skip" && !fn) return D(heading());
		return testBlock({ e, fn, heading });
	};

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

function variants(callee: string, block: "describe" | "test"): Record<string, CallRule<TestingPhrases>> {
	return {
		[callee]: named(block),
		[`${callee}.concurrent`]: named(block),
		[`${callee}.serial`]: named(block),
		[`${callee}.skip`]: named(block, "skip"),
		[`${callee}.todo`]: named(block, "skip"),
		[`${callee}.only`]: named(block, "only"),
		[`${callee}.if()`]: named(block, "if"),
		[`${callee}.skipIf()`]: named(block, "skipIf"),
		[`${callee}.each()`]: named(block, "each"),
	};
}

const isTestImport = (e: Engine, local: string) => /^(bun:test|vitest|@jest\/globals)$/.test(e.imports.get(local)?.from ?? "");

const mockSubject = (e: Engine, obj: N | null) => (obj ? e.noun(obj) : null);

const mockRule =
	(kind: "implementation" | "returns" | "resolves" | "rejects" | "restore" | "clear" | "reset", once = false): CallRule<TestingPhrases> =>
	({ obj, args, e, say, stmt }) => {
		const m = mockSubject(e, obj);
		if (!m) return null;
		const k = say.mocks;
		if (kind === "restore" || kind === "clear" || kind === "reset") return args.length ? null : D(k[kind]({ mock: m.t }), m.kids);
		if (kind === "implementation") {
			const fn = args[0] && unwrap(args[0]);
			if (!fn || !isFn(fn)) return null;
			return D(`${k.implementation({ mock: m.t, once, stmt })}:`, [...m.kids, ...e.body(fnBody(fn), 0)]);
		}
		const v = args[0] ? e.noun(args[0]) : D(e.say.expressions.nothing);
		return D(k[kind]({ mock: m.t, value: v.t, once, stmt }), [...m.kids, ...v.kids]);
	};

const spyOnRule: CallRule<TestingPhrases> = ({ args, e, say }) => {
	const [target, method] = args.map((a) => unwrap(a));
	if (!target || method?.type !== "Literal" || typeof method.value !== "string") return null;
	const t = e.noun(target);
	return D(say.mocks.spyOn({ target: e.say.expressions.member.chain({ path: [t.t, e.prop(method.value)] }) }), t.kids);
};

const mockRules: Record<string, CallRule<TestingPhrases>> = {
	spyOn: (ctx) => (isTestImport(ctx.e, "spyOn") ? spyOnRule(ctx) : null),
	"vi.spyOn": spyOnRule,
	"jest.spyOn": spyOnRule,
	"vi.fn": ({ args, say }) => (args.length ? null : D(say.mocks.mockFunction)),
	"jest.fn": ({ args, say }) => (args.length ? null : D(say.mocks.mockFunction)),
	mock: ({ args, e, say }) => {
		if (!isTestImport(e, "mock") || args.length > 1) return null;
		const fn = args[0] && unwrap(args[0]);
		if (!fn) return D(say.mocks.mockFunction);
		if (!isFn(fn)) return null;
		const lines = e.body(fnBody(fn), 0);
		return lines.length ? D(`${say.mocks.mockRunning}:`, lines) : D(say.mocks.mockFunction);
	},
	"*.mockImplementation": mockRule("implementation"),
	"*.mockImplementationOnce": mockRule("implementation", true),
	"*.mockReturnValue": mockRule("returns"),
	"*.mockReturnValueOnce": mockRule("returns", true),
	"*.mockResolvedValue": mockRule("resolves"),
	"*.mockResolvedValueOnce": mockRule("resolves", true),
	"*.mockRejectedValue": mockRule("rejects"),
	"*.mockRejectedValueOnce": mockRule("rejects", true),
	"*.mockRestore": mockRule("restore"),
	"*.mockClear": mockRule("clear"),
	"*.mockReset": mockRule("reset"),
};

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
	...variants("describe", "describe"),
	...variants("test", "test"),
	...variants("it", "test"),
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
	...mockRules,
};

/** bun:test, vitest and jest: `describe`/`test`/`it` blocks and `expect(...)` matchers. */
export const testing = (): TsPlugin<TestingPhrases> => definePlugin({ name: "testing", phrases: { en }, calls: testRules });

declare module "@usenarrator/core" {
	interface PluginPhrases {
		testing: TestingPhrases;
	}
}
