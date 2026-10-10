import { D, type Doc, type Line, mk } from "@usenarrator/core";
import { type CallRule, definePlugin, type Engine, type N, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { calleeKey, isFn, readImports, strLit } from "../context";

type P<K extends string> = (p: { [k in K]: string }) => string;

/** Every English fragment of the Effect testing companion plugin (`@usenarrator/plugin-effect/testing`). */
export type EffectTestingPhrases = {
	test: P<"name">;
	scopedTest: P<"name">;
	liveTest: P<"name">;
	withLayer: P<"layer" | "name">;
	adjust: P<"duration">;
	setTime: P<"time">;
	equal: P<"actual" | "expected">;
	isTrue: P<"value">;
	isFalse: P<"value">;
};

export const en: EffectTestingPhrases = {
	test: ({ name }) => `Test ${name}, run as an effect`,
	scopedTest: ({ name }) => `Test ${name}, run as an effect with its own scope`,
	liveTest: ({ name }) => `Test ${name}, run as an effect with the real clock`,
	withLayer: ({ layer, name }) => `Tests ${name}, sharing ${layer}`,
	adjust: ({ duration }) => `move the test clock forward ${duration}`,
	setTime: ({ time }) => `set the test clock to ${time}`,
	equal: ({ actual, expected }) => `check that ${actual} equals ${expected}`,
	isTrue: ({ value }) => `check that ${value}`,
	isFalse: ({ value }) => `check that ${value}`,
};

/** A test body: the steps of `() => Effect.gen(function* () {...})`, or whatever the callback does. */
function bodyLines(e: Engine, fn: N): Line[] | null {
	const f = unwrap(fn);
	if (!f || !isFn(f)) return null;
	const ex = e.lambdaExpr(f);
	const gen = ex && calleeKey(ex) === "Effect.gen" ? unwrap(ex).arguments.find((a: N) => isFn(a)) : null;
	if (gen) return e.body(unwrap(gen).body, 0);
	if (ex) {
		const d = e.call(unwrap(ex), true);
		return e.bullet(d);
	}
	return e.body(f.body, 0);
}

const EFFECT_VITEST = /^@effect\/vitest$/;

/** `@effect/vitest` (`it.effect`, `layer(...)`, `assert`) and `TestClock`, v3 (`effect/TestClock`) and v4 (`effect/testing`). */
export const effectTesting = (): TsPlugin<EffectTestingPhrases> => {
	let src = "\0";
	let imp = readImports("");
	const fromVitest = (e: Engine, name: string) => {
		if (e.src !== src) {
			src = e.src;
			imp = readImports(src);
		}
		return imp.effectNames.has(name) && [...imp.modules].some((m) => EFFECT_VITEST.test(m));
	};
	const testRule =
		(pick: (s: EffectTestingPhrases) => P<"name">): CallRule<EffectTestingPhrases> =>
		({ args: [name, fn], e, say }) => {
			if (!fromVitest(e, "it") || !name || !fn) return null;
			const lines = bodyLines(e, fn);
			return lines ? D(`${pick(say)({ name: e.text(name) })}:`, lines) : null;
		};
	const suite: CallRule<EffectTestingPhrases> = ({ node, args: [name, fn], e, say }) => {
		const [layer] = unwrap(node.callee).arguments;
		const f = fn && unwrap(fn);
		if (!layer || !name || !f || !isFn(f)) return null;
		return D(`${say.withLayer({ layer: e.text(layer), name: e.text(name) })}:`, e.body(f.body, 0));
	};
	const clock =
		(f: (e: Engine, say: EffectTestingPhrases, x: N) => string): CallRule<EffectTestingPhrases> =>
		({ args: [x], e, say }) => {
			if (!x) return null;
			if (e.src !== src) {
				src = e.src;
				imp = readImports(src);
			}
			return imp.effectNames.has("TestClock") ? D(f(e, say, x)) : null;
		};
	const calls: Record<string, CallRule<EffectTestingPhrases>> = {
		"it.effect": testRule((s) => s.test),
		"it.scoped": testRule((s) => s.scopedTest),
		"it.live": testRule((s) => s.liveTest),
		"it.scopedLive": testRule((s) => s.liveTest),
		"layer()": (x) => (fromVitest(x.e, "layer") ? suite(x) : null),
		"it.layer()": (x) => (fromVitest(x.e, "it") ? suite(x) : null),
		"TestClock.adjust": clock((e, say, x) => say.adjust({ duration: strLit(x) !== null ? mk("l", strLit(x)!) : e.text(x) })),
		"TestClock.setTime": clock((e, say, x) => say.setTime({ time: e.text(x) })),
	};
	for (const m of ["strictEqual", "deepStrictEqual", "equal", "deepEqual"])
		calls[`assert.${m}`] = ({ args: [a, b], e, say }): Doc | null =>
			fromVitest(e, "assert") && a && b ? D(say.equal({ actual: e.text(a), expected: e.text(b) })) : null;
	calls["assert.isTrue"] = ({ args: [a], e, say }) => (fromVitest(e, "assert") && a ? D(say.isTrue({ value: e.cond(a).t })) : null);
	calls["assert.isFalse"] = ({ args: [a], e, say }) => (fromVitest(e, "assert") && a ? D(say.isFalse({ value: e.cond(a, true).t })) : null);
	return definePlugin<EffectTestingPhrases>({
		name: "effect-testing",
		library: { name: "@effect/vitest", versions: ">=0.20 <1 || >=4 <5" },
		phrases: { en },
		calls,
	});
};
