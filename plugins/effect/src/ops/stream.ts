import { D } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, callbackStep, concurrency, duration, isFn, make, type OpTable, step, stepIf } from "../context";
import type { EffectPhrases } from "../phrases";
import { predicate } from "./effect";
import { scheduleHow } from "./schedule";

const each = (c: Ctx, fn: N) => callbackStep(c, c.say.stream.each, fn, "action");

const withHow = (c: Ctx, doc: ReturnType<typeof each>, opts: N | undefined) =>
	opts ? D(c.say.steps.concurrent({ step: doc.t, how: concurrency(c, opts) }), doc.kids) : doc;

const nArg = (pick: (s: EffectPhrases) => (p: { n: string }) => string) => step(1, (c, [n]) => (n ? D(pick(c.say)({ n: c.e.noun(n).t })) : null));
const sink = (pick: (s: EffectPhrases) => string) =>
	stepIf(
		(a) => a.length > 0,
		(c) => D(pick(c.say)),
	);
const effectArg = (pick: (s: EffectPhrases) => (p: { effect: string }) => string) =>
	make((c, [x]) => {
		if (!x) return null;
		const v = c.e.noun(x);
		return D(pick(c.say)({ effect: v.t }), v.kids);
	});
const otherStream = (pick: (s: EffectPhrases) => (p: { other: string }) => string) =>
	step(1, (c, [x]) => {
		if (!x) return null;
		const v = c.e.noun(x);
		return D(pick(c.say)({ other: v.t }), v.kids);
	});

const shared: OpTable = {
	"Stream.make": make((c, args) => D(c.say.stream.make({ items: c.e.g.list(args.map((a) => c.e.noun(a).t)) }))),
	"Stream.fromIterable": make((c, [xs]) => (xs ? D(c.say.stream.fromIterable({ items: c.e.noun(xs).t })) : null)),
	"Stream.range": make((c, [a, b]) => (a && b ? D(c.say.stream.range({ from: c.e.noun(a).t, to: c.e.noun(b).t })) : null)),
	"Stream.fromEffect": effectArg((s) => s.stream.fromEffect),
	"Stream.tick": make((c, [d]) => (d ? D(c.say.stream.tick({ duration: duration(c, d).t })) : null)),
	"Stream.map": step(1, (c, [fn]) => (fn ? callbackStep(c, c.say.steps.map, fn, "value", { target: c.say.targets.item }) : null)),
	"Stream.mapEffect": stepIf(
		(a) => a.length > 0 && !isFn(a[0]),
		(c, [fn, opts]) => (fn ? withHow(c, each(c, fn), opts) : null),
	),
	"Stream.flatMap": stepIf(
		(a) => a.length > 0 && !isFn(a[0]),
		(c, [fn, opts]) => (fn ? withHow(c, each(c, fn), opts) : null),
	),
	"Stream.tap": step(1, (c, [fn]) => (fn ? each(c, fn) : null)),
	"Stream.runForEach": step(1, (c, [fn]) => (fn ? each(c, fn) : null)),
	"Stream.filter": step(1, (c, [fn]) => {
		if (!fn) return null;
		if (!isFn(fn)) return D(c.say.steps.filter.fn({ target: c.say.targets.items, fn: c.e.noun(fn).t }));
		const p = unwrap(fn).params[0];
		const name = p?.type === "Identifier" ? c.e.ref(p.name) : null;
		const cond = predicate(c, fn);
		return D(name ? c.say.steps.filter.named({ target: c.say.targets.items, name, cond }) : c.say.steps.filter.anon({ target: c.say.targets.items, cond }));
	}),
	"Stream.take": nArg((s) => s.stream.take),
	"Stream.drop": nArg((s) => s.stream.drop),
	"Stream.grouped": nArg((s) => s.stream.grouped),
	"Stream.runCollect": sink((s) => s.stream.runCollect),
	"Stream.runDrain": sink((s) => s.stream.runDrain),
	"Stream.runHead": sink((s) => s.stream.runHead),
	"Stream.runCount": sink((s) => s.stream.runCount),
	"Stream.runFold": step(2, (c, [init]) => (init ? D(c.say.stream.runFold({ initial: c.e.noun(init).t })) : null)),
	"Stream.merge": otherStream((s) => s.stream.merge),
	"Stream.concat": otherStream((s) => s.stream.concat),
	"Stream.schedule": step(1, (c, [s]) => {
		if (!s) return null;
		return D(c.say.stream.schedule({ how: scheduleHow(c, s) ?? c.e.noun(s).t }));
	}),
};

const catchAll = step(1, (c, [fn]) => (fn ? callbackStep(c, c.say.steps.catchAll, fn, "action") : null));

const v3: OpTable = {
	"Stream.repeatEffect": effectArg((s) => s.stream.repeatEffect),
	"Stream.catchAll": catchAll,
	"Stream.fromChunk": make((c, [xs]) => (xs ? D(c.say.stream.fromIterable({ items: c.e.noun(xs).t })) : null)),
};

const v4: OpTable = {
	"Stream.fromEffectRepeat": effectArg((s) => s.stream.repeatEffect),
	"Stream.catch": catchAll,
	"Stream.fromArray": make((c, [xs]) => (xs ? D(c.say.stream.fromIterable({ items: c.e.noun(xs).t })) : null)),
};

export const streamOps = { shared, v3, v4 };
