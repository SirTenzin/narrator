import { capFirst, D, type Doc, type Line } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import {
	act,
	type Ctx,
	callbackParts,
	callbackStep,
	cbAction,
	cbValue,
	concurrency,
	duration,
	errorValue,
	form,
	isFn,
	isObj,
	type Mode,
	make,
	numbered,
	type OpTable,
	objProp,
	pipeStep,
	serviceName,
	step,
	stepIf,
	strLit,
} from "../context";
import type { EffectPhrases } from "../phrases";
import { scheduleHow } from "./schedule";

type Form = { noun: (p: any) => string; act: (p: any) => string };

/** A one-argument builder like `Effect.succeed(x)` with a noun and an action reading. */
const valueOp = (pick: (s: EffectPhrases) => Form, key: string, read: (c: Ctx, n: N) => Doc = (c, n) => c.e.noun(n)) =>
	make((c, args, mode) => {
		if (!args[0]) return null;
		const v = read(c, args[0]);
		return D(form(pick(c.say), mode, { [key]: v.t }), v.kids);
	});

/** `() => x` read as "x"; a function reference reads as itself. */
export const thunkValue = (c: Ctx, n: N): Doc => (isFn(n) ? cbValue(c, callbackParts(c, n)) : c.e.noun(n));
export const thunkAction = (c: Ctx, n: N): Doc => (isFn(n) ? cbAction(c, callbackParts(c, n)) : act(c, n));
/** `() => new Timeout()` or `new Timeout()` where only an error makes sense. */
export const errorThunk = (c: Ctx, n: N): Doc => {
	const ex = isFn(n) ? c.e.lambdaExpr(unwrap(n)) : n;
	return ex ? errorValue(c, ex) : thunkValue(c, n);
};

/** A callback's body as statement lines, for blocks that list what happens. */
export function actionLines(c: Ctx, fn: N): Line[] {
	if (unwrap(fn).body?.type === "BlockStatement") return c.e.body(unwrap(fn).body, 0);
	const parts = callbackParts(c, fn);
	if (parts.block) return c.e.body(parts.block, 0);
	const a = act(c, parts.expr);
	return [{ d: 0, text: `${capFirst(a.t)}${a.kids.length ? ":" : "."}`, start: -1, end: -1, kind: "stmt" }, ...a.kids.map((k) => ({ ...k, d: k.d + 1 }))];
}

const tryLike = (plain: (s: EffectPhrases) => Form, mapped: (s: EffectPhrases) => Form) =>
	make((c, [arg], mode) => {
		if (!arg) return null;
		const t = isObj(arg) ? objProp(arg, "try") : arg;
		const k = isObj(arg) ? objProp(arg, "catch") : null;
		if (!t) return null;
		const v = thunkValue(c, t);
		if (!k) return D(form(plain(c.say), mode, { value: v.t }), v.kids);
		const err = errorThunk(c, k);
		return D(form(mapped(c.say), mode, { value: v.t, error: err.t }), [...v.kids, ...err.kids]);
	});

const messages = (c: Ctx, args: N[]) => {
	const docs = args.map((a) => c.e.noun(a));
	return D(
		c.e.g.list(docs.map((d) => d.t)),
		docs.flatMap((d) => d.kids),
	);
};

const messageOp = (pick: (s: EffectPhrases) => Form) =>
	make((c, args, mode) => {
		if (!args.length) return null;
		const m = messages(c, args);
		return D(form(pick(c.say), mode, { message: m.t }), m.kids);
	});

const logAt = (level: keyof EffectPhrases["make"]["logLevels"]) =>
	make((c, args, mode) => {
		if (!args.length) return null;
		const m = messages(c, args);
		return D(form(c.say.make.logAt, mode, { message: m.t, level: c.say.make.logLevels[level] }), m.kids);
	});

/** `Effect.all([...])` / `Effect.all({ a, b })`: each entry is something to run. */
const all = make((c, [items, opts], mode) => {
	if (!items) return null;
	const how = concurrency(c, opts ?? null);
	const u = unwrap(items);
	let entries: Doc[];
	if (u.type === "ArrayExpression") entries = u.elements.filter(Boolean).map((el: N) => act(c, el));
	else if (u.type === "ObjectExpression")
		entries = u.properties.map((p: N) => {
			if (p.type !== "Property") return act(c, p);
			const a = act(c, p.value);
			return D(c.say.common.labeled({ label: c.e.prop(p.key.name ?? String(p.key.value)), value: a.t }), a.kids);
		});
	else entries = [act(c, u)];
	return D(
		form(c.say.make.all, mode, { how }),
		entries.flatMap((x) => c.e.bullet(x)),
	);
});

const forEach = make((c, [items, fn, opts], mode) => {
	if (!items || !fn) return null;
	const how = concurrency(c, opts ?? null);
	const list = c.e.noun(items);
	if (!isFn(fn)) {
		const f = c.e.noun(fn);
		return D(form(c.say.make.forEachFn, mode, { items: list.t, fn: f.t, how }), [...list.kids, ...f.kids]);
	}
	const p = unwrap(fn).params[0];
	const item = p ? c.e.g.list(c.e.patternNames(p)) : c.say.common.it;
	return D(form(c.say.make.forEach, mode, { item, items: list.t, how }), [...list.kids, ...actionLines(c, fn)]);
});

/** `Effect.gen(function* () { ... })`, also with a leading `this` / `{ self }` argument. */
const gen = make((c, args, mode) => {
	const fn = [...args].reverse().find(isFn);
	if (!fn) return null;
	return D(c.say.program.gen[mode], c.e.body(unwrap(fn).body, 0));
});

/** `Effect.fn("name")(function* (a) {...}, ...steps)` and `Effect.fn(function* ...)`. */
export function effectFn(c: Ctx, fnArgs: N[]): Doc | null {
	const [fn, ...pipes] = fnArgs;
	if (!fn || !isFn(fn)) return null;
	const f = unwrap(fn);
	const given = f.params.flatMap((p: N) => c.e.patternNames(p));
	const head = given.length ? c.say.program.fn({ given: c.e.g.list(given) }) : c.say.program.fnBare;
	return D(head, [...actionLines(c, f), ...afterLines(c, pipes)]);
}

/** The steps an `Effect.fn` applies around its body, as a trailing numbered block. */
export function afterLines(c: Ctx, pipes: N[]): Line[] {
	if (!pipes.length) return [];
	return [
		{ d: 0, text: `${c.say.program.fnAfter}:`, start: -1, end: -1, kind: "stmt" },
		...numbered(
			c,
			pipes.map((p) => pipeStep(c, p)),
		).map((l) => ({ ...l, d: l.d + 1 })),
	];
}

const fnOp = {
	kind: "curried" as const,
	render: (c: Ctx, inner: N[], outer: N[] | null) => (outer ? effectFn(c, outer) : isFn(inner[0]) ? effectFn(c, inner) : null),
};

/** A predicate callback as a condition. */
export function predicate(c: Ctx, fn: N): string {
	if (!isFn(fn)) return c.e.cond(fn).t;
	const ex = c.e.lambdaExpr(unwrap(fn));
	return ex ? c.e.cond(ex).t : c.e.noun(fn).t;
}

/** `Effect.retry(Schedule...)` or `Effect.retry({ times, while })`. */
function policy(c: Ctx, p: N, pick: { how: (x: { how: string }) => string; with: (x: { policy: string }) => string }): Doc {
	const how = scheduleHow(c, p);
	if (how) return D(pick.how({ how }));
	if (isObj(p)) {
		const parts: string[] = [];
		const sched = objProp(p, "schedule");
		const times = objProp(p, "times");
		const w = objProp(p, "while");
		const u = objProp(p, "until");
		if (sched) parts.push(scheduleHow(c, sched) ?? c.e.noun(sched).t);
		if (times) parts.push(c.say.schedule.recurs({ n: c.e.noun(times).t }));
		if (w) parts.push(c.say.schedule.while({ cond: predicate(c, w) }));
		if (u) parts.push(c.say.schedule.until({ cond: predicate(c, u) }));
		if (parts.length) return D(pick.how({ how: c.e.g.list(parts) }));
	}
	const pol = c.e.noun(p);
	return D(pick.with({ policy: pol.t }), pol.kids);
}

const tagsOf = (c: Ctx, args: N[]) =>
	c.e.g.list(
		args.flatMap((a) => (unwrap(a).type === "ArrayExpression" ? unwrap(a).elements : [a])).map((a: N) => c.e.noun(a).t),
		"or",
	);

const catchTag = stepIf(
	(a) => a.length > 0 && strLit(a[0]) === null && unwrap(a[0]).type !== "ArrayExpression",
	(c, args) => {
		const fn = args.at(-1);
		if (!fn || args.length < 2) return null;
		return callbackStep(c, c.say.steps.catchTag, fn, "action", { tags: tagsOf(c, args.slice(0, -1)) });
	},
);

const keyLiteral = (c: Ctx, key: N) => c.e.literal({ type: "Literal", value: key.name ?? String(key.value) });

const catchTags = step(1, (c, [cases]) => {
	const u = unwrap(cases);
	if (u?.type !== "ObjectExpression") return null;
	const lines = u.properties.flatMap((p: N) =>
		p.type === "Property" ? c.e.bullet(callbackStep(c, c.say.steps.catchTag, p.value, "action", { tags: keyLiteral(c, p.key) })) : [],
	);
	return D(c.say.steps.catchTags, lines);
});

const catchAll = step(1, (c, [fn]) => (fn ? callbackStep(c, c.say.steps.catchAll, fn, "action") : null));
const catchCause = step(1, (c, [fn]) => (fn ? callbackStep(c, c.say.steps.catchCause, fn, "action") : null));

/** v3 `Effect.catch("_tag", { failure: "NotFound", onFailure })`. */
const catchV3 = stepIf(
	(a) => a.length > 2,
	(c, [, opts]) => {
		const failure = opts ? objProp(opts, "failure") : null;
		const on = opts ? objProp(opts, "onFailure") : null;
		if (!failure || !on) return null;
		return callbackStep(c, c.say.steps.catchTag, on, "action", { tags: c.e.noun(failure).t });
	},
);
const isV3CatchShape = (a: N[]) => a.some((x) => strLit(x) !== null) && isObj(a.at(-1)) && !!objProp(a.at(-1), "onFailure");
const catchAuto = stepIf(
	(a) => (isV3CatchShape(a) ? a.length > 2 : a.length > 1),
	(c, a) => (isV3CatchShape(a) ? catchV3.render(c, a) : catchAll.render(c, a)),
);

/** Steps that take no arguments, or only an options object (`Effect.forkChild({ startImmediately })`). */
const bare = (pick: (s: EffectPhrases) => string) =>
	stepIf(
		(a) => a.length > 0 && !isObj(a[0]),
		(c) => D(pick(c.say)),
	);

/** `Effect.fork(task)` reads as "start task in the background" rather than "run task, then start it…". */
const forkOp = (pick: (s: EffectPhrases) => string) => ({
	...bare(pick),
	first: (c: Ctx, [eff]: N[], mode: Mode) => {
		const v = c.e.noun(eff);
		return D(form(c.say.run.fork, mode, { effect: v.t }), v.kids);
	},
});

const runner = (pick: (s: EffectPhrases) => Form) =>
	make((c, [eff], mode) => {
		const v = eff ? c.e.noun(eff) : D(c.say.common.it);
		return D(form(pick(c.say), mode, { effect: v.t }), v.kids);
	});

const durationStep = (pick: (s: EffectPhrases) => (p: { duration: string }) => string) =>
	step(1, (c, [d]) => {
		if (!d) return null;
		const t = duration(c, d);
		return D(pick(c.say)({ duration: t.t }), t.kids);
	});

const flatMapLike = (pick: (s: EffectPhrases) => EffectPhrases["steps"]["flatMap"]) =>
	step(1, (c, [fn]) => {
		if (!fn) return null;
		const phrases = pick(c.say);
		if (isFn(fn) || unwrap(fn).type === "Identifier") return callbackStep(c, phrases, fn, "action", { target: c.say.targets.result });
		const a = act(c, fn);
		return D(phrases.anon({ action: a.t, target: c.say.targets.result }), a.kids);
	});

const actionStep = (pick: (s: EffectPhrases) => (p: { action: string }) => string) =>
	step(1, (c, [x]) => {
		if (!x) return null;
		const a = thunkAction(c, x);
		return D(pick(c.say)({ action: a.t }), a.kids);
	});

const matchCases = (c: Ctx, cases: N, asAction: boolean): Line[] => {
	const u = unwrap(cases);
	if (u?.type !== "ObjectExpression") return [];
	return u.properties.flatMap((p: N) => {
		const when = c.say.match.when[p.key?.name as keyof EffectPhrases["match"]["when"]];
		if (!when || p.type !== "Property") return [];
		if (!isFn(p.value)) return c.e.bullet(D(c.say.match.line({ when, then: c.e.noun(p.value).t })));
		const parts = callbackParts(c, p.value);
		const body = asAction ? cbAction(c, parts) : cbValue(c, parts);
		const label = parts.name ? c.say.match.named({ when, name: parts.name }) : when;
		return c.e.bullet(D(c.say.match.line({ when: label, then: body.t }), body.kids));
	});
};

/** `X.match(value, { onA, onB })` (data-first) or `X.match({ ... })` as a pipe step. */
export const matchOp = (asAction: boolean) =>
	stepIf(
		(a) => a.length > 1,
		(c, [cases]) => (cases ? D(c.say.match.step, matchCases(c, cases, asAction)) : null),
	);

/** Data-first matches read better as "depending on X" than as a pipeline. */
export const matchFirst = (asAction: boolean) => ({
	...matchOp(asAction),
	first: (c: Ctx, args: N[]) => {
		const subj = c.e.noun(args[0]);
		return D(c.say.match.header({ subject: subj.t }), [...subj.kids, ...matchCases(c, args[1], asAction)]);
	},
});

function resource(c: Ctx, mode: Mode, acquire: N, use: N | null, release: N): Doc | null {
	if (!acquire || !release) return null;
	const a = act(c, acquire);
	const lines = c.e.bullet(D(c.say.scope.acquire({ action: a.t }), a.kids));
	if (use) {
		const u = thunkAction(c, use);
		lines.push(...c.e.bullet(D(c.say.scope.use({ action: u.t }), u.kids)));
	}
	const r = thunkAction(c, release);
	lines.push(...c.e.bullet(D(c.say.scope.release({ action: r.t }), r.kids)));
	return D(c.say.scope.resource[mode], lines);
}

const shared: OpTable = {
	"Effect.gen": gen,
	"Effect.fn": fnOp,
	"Effect.fnUntraced": fnOp,
	"Effect.succeed": valueOp((s) => s.make.succeed, "value"),
	"Effect.fail": valueOp((s) => s.make.fail, "error", errorValue),
	"Effect.failSync": valueOp((s) => s.make.fail, "error", errorThunk),
	"Effect.die": valueOp((s) => s.make.die, "defect"),
	"Effect.dieMessage": valueOp((s) => s.make.die, "defect"),
	"Effect.sync": make((c, [fn], mode) => {
		if (!fn) return null;
		const ex = isFn(fn) ? c.e.lambdaExpr(unwrap(fn)) : null;
		if (mode === "act" && unwrap(ex)?.type === "CallExpression") return act(c, ex);
		const v = thunkValue(c, fn);
		return D(form(c.say.make.sync, mode, { value: v.t }), v.kids);
	}),
	"Effect.promise": valueOp((s) => s.make.promise, "value", thunkValue),
	"Effect.suspend": valueOp((s) => s.make.suspend, "value", thunkValue),
	"Effect.fromNullable": valueOp((s) => s.make.fromNullable, "value"),
	"Effect.tryPromise": tryLike(
		(s) => s.make.tryPromise,
		(s) => s.make.tryPromiseMapped,
	),
	"Effect.try": tryLike(
		(s) => s.make.try,
		(s) => s.make.tryMapped,
	),
	"Effect.log": messageOp((s) => s.make.log),
	"Effect.logInfo": logAt("info"),
	"Effect.logWarning": logAt("warning"),
	"Effect.logError": logAt("error"),
	"Effect.logDebug": logAt("debug"),
	"Effect.logTrace": logAt("trace"),
	"Effect.logFatal": logAt("fatal"),
	"Console.log": messageOp((s) => s.make.console),
	"Console.error": messageOp((s) => s.make.consoleError),
	"Effect.sleep": valueOp((s) => s.make.sleep, "duration", duration),
	"Effect.all": all,
	"Effect.forEach": forEach,

	"Effect.map": step(1, (c, [fn]) => (fn ? callbackStep(c, c.say.steps.map, fn, "value", { target: c.say.targets.result }) : null)),
	"Effect.flatMap": flatMapLike((s) => s.steps.flatMap),
	"Effect.andThen": flatMapLike((s) => s.steps.flatMap),
	"Effect.tap": flatMapLike((s) => s.steps.tap),
	"Effect.catchTag": catchTag,
	"Effect.catchTags": catchTags,
	"Effect.catchIf": step(2, (c, [pred, fn]) => (pred && fn ? callbackStep(c, c.say.steps.catchTag, fn, "action", { tags: predicate(c, pred) }) : null)),
	"Effect.tapError": step(1, (c, [fn]) => (fn ? callbackStep(c, c.say.steps.tapError, fn, "action") : null)),
	"Effect.mapError": step(1, (c, [fn]) => (fn ? callbackStep(c, c.say.steps.mapError, fn, "value", {}, errorValue) : null)),
	"Effect.orElse": actionStep((s) => s.steps.orElse),
	"Effect.orElseSucceed": step(1, (c, [fn]) => {
		if (!fn) return null;
		const v = thunkValue(c, fn);
		return D(c.say.steps.orElseSucceed({ value: v.t }), v.kids);
	}),
	"Effect.orElseFail": step(1, (c, [fn]) => {
		if (!fn) return null;
		const v = errorThunk(c, fn);
		return D(c.say.steps.orElseFail({ error: v.t }), v.kids);
	}),
	"Effect.orDie": bare((s) => s.steps.orDie),
	"Effect.asVoid": bare((s) => s.steps.asVoid),
	"Effect.ignore": bare((s) => s.steps.ignore),
	"Effect.option": bare((s) => s.steps.option),
	"Effect.exit": bare((s) => s.steps.exit),
	"Effect.flatten": bare((s) => s.steps.flatten),
	"Effect.scoped": bare((s) => s.steps.scoped),
	"Effect.forkScoped": bare((s) => s.steps.forkScoped),
	"Effect.as": step(1, (c, [v]) => (v ? D(c.say.steps.as({ value: c.e.noun(v).t })) : null)),
	"Effect.retry": step(1, (c, [p]) => (p ? policy(c, p, { how: c.say.steps.retry, with: c.say.steps.retryWith }) : null)),
	"Effect.repeat": step(1, (c, [p]) => (p ? policy(c, p, { how: c.say.steps.repeat, with: c.say.steps.repeatWith }) : null)),
	"Effect.timeout": durationStep((s) => s.steps.timeout),
	"Effect.delay": durationStep((s) => s.steps.delay),
	"Effect.timeoutFail": step(1, (c, [opts]) => {
		const d = opts ? objProp(opts, "duration") : null;
		const on = opts ? objProp(opts, "onTimeout") : null;
		if (!d || !on) return null;
		return D(c.say.steps.timeoutFail({ duration: duration(c, d).t, error: errorThunk(c, on).t }));
	}),
	"Effect.provide": step(1, (c, [what]) => {
		if (!what) return null;
		const u = unwrap(what);
		const t = u.type === "ArrayExpression" ? c.e.g.list(u.elements.map((x: N) => c.e.noun(x).t)) : c.e.noun(u).t;
		return D(c.say.steps.provide({ what: t }));
	}),
	"Effect.provideService": step(2, (c, [tag, impl]) => {
		if (!tag || !impl) return null;
		const i = c.e.noun(impl);
		return D(c.say.steps.provideService({ service: serviceName(c, tag), impl: i.t }), i.kids);
	}),
	"Effect.withSpan": stepIf(
		(a) => a.length > 0 && strLit(a[0]) === null,
		(c, [name]) => (name ? D(c.say.steps.withSpan({ name: c.e.noun(name).t })) : null),
	),
	"Effect.withLogSpan": stepIf(
		(a) => a.length > 0 && strLit(a[0]) === null,
		(c, [name]) => (name ? D(c.say.steps.withLogSpan({ name: c.e.noun(name).t })) : null),
	),
	"Effect.annotateLogs": stepIf(
		(a) => a.length > 0 && strLit(a[0]) === null && !isObj(a[0]),
		(c, args) => {
			if (!args.length) return null;
			const entries = isObj(args[0])
				? c.e.g.list(
						unwrap(args[0]).properties.map((p: N) =>
							p.type === "Property"
								? c.say.common.labeled({ label: c.e.prop(p.key?.name ?? String(p.key?.value)), value: c.e.noun(p.value).t })
								: c.e.noun(p).t,
						),
					)
				: c.say.common.labeled({ label: c.e.noun(args[0]).t, value: c.e.noun(args[1]).t });
			return D(c.say.steps.annotateLogs({ entries }));
		},
	),
	"Effect.ensuring": actionStep((s) => s.steps.ensuring),
	"Effect.when": step(1, (c, [cond]) => (cond ? D(c.say.steps.when({ cond: predicate(c, cond) })) : null)),
	"Effect.filterOrFail": stepIf(
		(a) => a.length > 0 && !isFn(a[0]),
		(c, [pred, orFail]) => {
			if (!pred) return null;
			const cond = predicate(c, pred);
			if (!orFail) return D(c.say.steps.filterOrFailBare({ cond }));
			return D(c.say.steps.filterOrFail({ cond, error: errorThunk(c, orFail).t }));
		},
	),
	"Effect.match": matchFirst(false),
	"Effect.matchEffect": matchFirst(true),
	"Effect.runPromise": runner((s) => s.run.promise),
	"Effect.runPromiseExit": runner((s) => s.run.promiseExit),
	"Effect.runSync": runner((s) => s.run.sync),
	"Effect.runSyncExit": runner((s) => s.run.syncExit),
	"Effect.runFork": runner((s) => s.run.fork),
	"NodeRuntime.runMain": runner((s) => s.run.main),
	"BunRuntime.runMain": runner((s) => s.run.main),
	"Effect.addFinalizer": make((c, [fn], mode) => {
		if (!fn) return null;
		const a = thunkAction(c, fn);
		return D(form(c.say.scope.addFinalizer, mode, { action: a.t }), a.kids);
	}),
	"Effect.acquireRelease": make((c, [acquire, release], mode) => resource(c, mode, acquire, null, release)),
	"Effect.acquireUseRelease": make((c, [acquire, use, release], mode) => resource(c, mode, acquire, use ?? null, release)),
};

/** Removed or renamed in v4 (effect-smol migration/v3-to-v4.md, error-handling.md, forking.md). */
const v3: OpTable = {
	"Effect.catchAll": catchAll,
	"Effect.catchAllCause": catchCause,
	"Effect.catchSome": catchAll,
	"Effect.either": bare((s) => s.steps.either),
	"Effect.zipRight": actionStep((s) => s.steps.andThen),
	"Effect.zipLeft": actionStep((s) => s.steps.zipLeft),
	"Effect.fork": forkOp((s) => s.steps.fork),
	"Effect.forkDaemon": bare((s) => s.steps.forkDaemon),
	"Effect.async": make((c, _a, mode) => D(c.say.make.callback[mode])),
	"Effect.catch": catchV3,
};

/** New names in v4. */
const v4: OpTable = {
	"Effect.catch": catchAll,
	"Effect.catchCause": catchCause,
	"Effect.catchFilter": catchAll,
	"Effect.result": bare((s) => s.steps.result),
	"Effect.forkChild": forkOp((s) => s.steps.fork),
	"Effect.forkDetach": bare((s) => s.steps.forkDaemon),
	"Effect.callback": make((c, _a, mode) => D(c.say.make.callback[mode])),
};

/** `Effect.catch` means different things in v3 and v4; auto mode decides by argument shape. */
export const effectOps = { shared, v3, v4, auto: { "Effect.catch": catchAuto } as OpTable };
