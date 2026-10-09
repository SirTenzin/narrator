import { D } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, calleeKey, duration, make, memberKey, type OpTable } from "../context";

const pred = (c: Ctx, fn: N) => {
	const u = unwrap(fn);
	const ex = u && (u.type === "ArrowFunctionExpression" || u.type === "FunctionExpression") ? c.e.lambdaExpr(u) : null;
	return ex ? c.e.cond(ex).t : c.e.noun(fn).t;
};

/** Combinators that take another schedule and add it alongside this one. */
const ALONGSIDE = new Set(["Schedule.intersect", "Schedule.both", "Schedule.compose", "Schedule.andThen", "Schedule.zipWith"]);

/** One schedule part as an adverbial ("every 1 second"), or null when `n` isn't a schedule. */
function part(c: Ctx, n: N): string[] | null {
	const s = c.say.schedule;
	const u = unwrap(n);
	const bare = memberKey(u);
	if (bare === "Schedule.forever") return [s.forever];
	if (bare === "Schedule.once") return [s.once];
	if (bare === "Schedule.jittered") return [s.jittered];
	if (u?.type !== "CallExpression") return null;
	const key = calleeKey(u);
	const [a, b] = u.arguments;
	switch (key) {
		case "Schedule.exponential":
			return [b ? s.exponentialFactor({ base: duration(c, a).t, factor: c.e.noun(b).t }) : s.exponential({ base: duration(c, a).t })];
		case "Schedule.fibonacci":
			return [s.fibonacci({ base: duration(c, a).t })];
		case "Schedule.spaced":
			return [s.spaced({ duration: duration(c, a).t })];
		case "Schedule.fixed":
			return [s.fixed({ duration: duration(c, a).t })];
		case "Schedule.recurs":
			return [s.recurs({ n: c.e.noun(a).t })];
		case "Schedule.jittered":
			return a ? [...(part(c, a) ?? []), s.jittered] : [s.jittered];
		case "Schedule.upTo":
			return b ? [...(part(c, a) ?? []), s.upTo({ duration: duration(c, b).t })] : [s.upTo({ duration: duration(c, a).t })];
		case "Schedule.whileInput":
		case "Schedule.while":
			return [s.while({ cond: pred(c, b ?? a) })];
		case "Schedule.untilInput":
		case "Schedule.until":
			return [s.until({ cond: pred(c, b ?? a) })];
		case "Schedule.union":
		case "Schedule.either": {
			const parts = [a, b].filter(Boolean).map((x) => (part(c, x) ?? [c.e.noun(x).t]).join(", "));
			return [s.whichever({ options: c.e.g.list(parts, "or") })];
		}
	}
	if (key && ALONGSIDE.has(key)) return [a, b].filter(Boolean).flatMap((x) => part(c, x) ?? [c.e.noun(x).t]);
	if (unwrap(u.callee).type === "MemberExpression" && unwrap(u.callee).property.name === "pipe") {
		const head = part(c, unwrap(u.callee).object);
		if (!head) return null;
		return [...head, ...u.arguments.flatMap((x: N) => part(c, x) ?? [])];
	}
	return null;
}

/** A schedule expression as an adverbial phrase for `retry` / `repeat`, or null. */
export function scheduleHow(c: Ctx, n: N): string | null {
	const parts = part(c, n);
	return parts?.length ? c.e.g.list(parts) : null;
}

const asNoun = make((c, _args, _mode, node) => {
	const how = scheduleHow(c, node);
	return how ? D(c.say.schedule.noun({ how })) : null;
});

export const scheduleOps: OpTable = Object.fromEntries(
	[
		"exponential",
		"fibonacci",
		"spaced",
		"fixed",
		"recurs",
		"jittered",
		"upTo",
		"intersect",
		"both",
		"union",
		"either",
		"compose",
		"andThen",
		"whileInput",
		"untilInput",
	].map((m) => [`Schedule.${m}`, asNoun]),
);
