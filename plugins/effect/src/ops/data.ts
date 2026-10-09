import { D } from "@usenarrator/core";
import type { N } from "@usenarrator/lang-ts";
import { type Ctx, callbackStep, fixed, make, noun, type OpTable, step } from "../context";
import type { EffectPhrases } from "../phrases";
import { matchFirst, thunkValue } from "./effect";

const one = (pick: (s: EffectPhrases) => (p: any) => string, key: string) =>
	make((c, [x]) => {
		if (!x) return null;
		const v = noun(c, x);
		return D(pick(c.say)({ [key]: v.t }), v.kids);
	});

const mapValue = step(1, (c, [fn]) => (fn ? callbackStep(c, c.say.steps.map, fn, "value", { target: c.say.targets.value }) : null));
const flatMapValue = step(1, (c, [fn]) => (fn ? callbackStep(c, c.say.steps.flatMap, fn, "action", { target: c.say.targets.value }) : null));

/** Option, Either (v3) and Result (v4) basics. */
const shared: OpTable = {
	"Option.some": one((s) => s.option.some, "value"),
	"Option.none": make((c) => D(c.say.option.none)),
	"Option.fromNullable": one((s) => s.option.fromNullable, "value"),
	"Option.getOrElse": step(1, (c, [fn]) => {
		if (!fn) return null;
		const v = thunkValue(c, fn);
		return D(c.say.option.getOrElse({ value: v.t }), v.kids);
	}),
	"Option.getOrNull": fixed((s) => s.option.getOrNull),
	"Option.getOrUndefined": fixed((s) => s.option.getOrUndefined),
	"Option.getOrThrow": fixed((s) => s.option.getOrThrow),
	"Option.map": mapValue,
	"Option.flatMap": flatMapValue,
	"Option.match": matchFirst(false),
	"Exit.match": matchFirst(false),
};

const v3: OpTable = {
	"Either.right": one((s) => s.outcome.right, "value"),
	"Either.left": one((s) => s.outcome.left, "error"),
	"Either.map": mapValue,
	"Either.match": matchFirst(false),
};

const v4: OpTable = {
	"Result.succeed": one((s) => s.outcome.success, "value"),
	"Result.fail": one((s) => s.outcome.failure, "error"),
	"Result.map": mapValue,
	"Result.match": matchFirst(false),
};

export const dataOps = { shared, v3, v4 };

type CondPick = (s: EffectPhrases) => (p: { subject: string; neg: boolean }) => string;

/** Yes/no checks on Option / Either / Result / Exit values, keyed like call rules. */
export const dataConditions = (version: 3 | 4 | "auto"): Record<string, CondPick> => ({
	"Option.isSome": (s) => s.option.hasValue,
	"Option.isNone": (s) => s.option.isEmpty,
	"Exit.isSuccess": (s) => s.outcome.succeeded,
	"Exit.isFailure": (s) => s.outcome.failed,
	...(version !== 4 ? { "Either.isRight": (s: EffectPhrases) => s.outcome.succeeded, "Either.isLeft": (s: EffectPhrases) => s.outcome.failed } : {}),
	...(version !== 3 ? { "Result.isSuccess": (s: EffectPhrases) => s.outcome.succeeded, "Result.isFailure": (s: EffectPhrases) => s.outcome.failed } : {}),
});
