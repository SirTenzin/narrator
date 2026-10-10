import { D, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, errorValue, form, isObj, make, type OpTable, objProp, step, stepIf, strLit } from "../context";
import type { EffectPhrases } from "../phrases";

type Pick1<K extends string> = (s: EffectPhrases) => (p: { [k in K]: string }) => string;
const t = (c: Ctx, n: N) => c.e.noun(n).t;

/** `"http_requests"` or v3's `{ name: "http_requests" }`. */
const metricName = (c: Ctx, n: N | undefined) => {
	if (!n) return null;
	const named = isObj(n) ? objProp(n, "name") : n;
	if (!named) return null;
	const s = strLit(named);
	return s !== null ? mk("l", `"${s}"`) : t(c, named);
};

const metric = (pick: Pick1<"name">) =>
	make((c, [n], mode) => {
		const name = metricName(c, n);
		if (!name) return null;
		const thing = pick(c.say)({ name });
		return D(mode === "act" ? c.say.common.create({ thing }) : thing);
	});

const on = <K extends string>(pick: Pick1<"metric" | K>, key: K) =>
	make((c, [m, v]) => (m && v ? D(pick(c.say)({ metric: t(c, m), [key]: t(c, v) } as { [k in "metric" | K]: string })) : null));

const metricStep = (pick: Pick1<"metric">) => step(1, (c, [m]) => (m ? D(pick(c.say)({ metric: t(c, m) })) : null));

/** `("key", value)` or `({ key: value })` as "key: value" entries. */
const entries = (c: Ctx, args: N[]) =>
	isObj(args[0])
		? c.e.g.list(
				unwrap(args[0]).properties.map((p: N) =>
					p.type === "Property" ? c.say.common.labeled({ label: c.e.prop(p.key?.name ?? String(p.key?.value)), value: t(c, p.value) }) : t(c, p),
				),
			)
		: c.say.common.labeled({ label: t(c, args[0]), value: args[1] ? t(c, args[1]) : "" });

const one = (pick: Pick1<"cause">) => make((c, [x]) => (x ? D(pick(c.say)({ cause: t(c, x) })) : null));
const holding = <K extends string>(pick: Pick1<K>, key: K, read: (c: Ctx, n: N) => ReturnType<typeof c.e.noun> = (c, n) => c.e.noun(n)) =>
	make((c, [x]) => {
		if (!x) return null;
		const v = read(c, x);
		return D(pick(c.say)({ [key]: v.t } as { [k in K]: string }), v.kids);
	});

const shared: OpTable = {
	"Metric.counter": metric((s) => s.metric.counter),
	"Metric.gauge": metric((s) => s.metric.gauge),
	"Metric.histogram": metric((s) => s.metric.histogram),
	"Metric.summary": metric((s) => s.metric.summary),
	"Metric.frequency": metric((s) => s.metric.frequency),
	"Metric.timer": metric((s) => s.metric.timer),
	"Metric.update": on((s) => s.metric.update, "value"),
	"Metric.value": make((c, [m], mode) => (m ? D(form(c.say.metric.value, mode, { metric: t(c, m) })) : null)),
	"Effect.annotateCurrentSpan": make((c, args) => (args.length ? D(c.say.span.annotate({ entries: entries(c, args) })) : null)),

	"Cause.pretty": one((s) => s.cause.pretty),
	"Cause.squash": one((s) => s.cause.squash),
	"Cause.fail": holding((s) => s.cause.fail, "error", errorValue),
	"Cause.die": holding((s) => s.cause.die, "defect"),
	"Exit.succeed": holding((s) => s.exit.succeed, "value"),
	"Exit.fail": holding((s) => s.exit.fail, "error", errorValue),
	"Exit.die": holding((s) => s.exit.die, "defect"),
};

const v3: OpTable = {
	"Metric.increment": make((c, [m]) => (m ? D(c.say.metric.increment({ metric: t(c, m) })) : null)),
	"Metric.incrementBy": on((s) => s.metric.incrementBy, "n"),
	"Metric.set": on((s) => s.metric.set, "value"),
	"Metric.trackDuration": metricStep((s) => s.metric.trackDuration),
	"Metric.trackSuccess": metricStep((s) => s.metric.track),
	"Metric.tagged": stepIf(
		(a) => a.length > 2,
		(c, args) => (args.length ? D(c.say.metric.tagged({ entries: entries(c, args) })) : null),
	),
	"Cause.failureOption": one((s) => s.cause.failureOption),
};

const v4: OpTable = {
	"Effect.trackDuration": metricStep((s) => s.metric.trackDuration),
	"Effect.trackSuccesses": metricStep((s) => s.metric.track),
	"Metric.modify": on((s) => s.metric.incrementBy, "n"),
	"Metric.withAttributes": stepIf(
		(a) => a.length > 1,
		(c, args) => (args.length ? D(c.say.metric.tagged({ entries: entries(c, args) })) : null),
	),
	"Cause.findErrorOption": one((s) => s.cause.failureOption),
};

/** Metrics, trace spans, and reading a `Cause` / `Exit`. */
export const observeOps = { shared, v3, v4 };
