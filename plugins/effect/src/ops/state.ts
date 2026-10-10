import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { act, type Ctx, callbackStep, errorValue, form, make, type OpTable, step } from "../context";
import type { EffectPhrases } from "../phrases";
import { thunkAction, thunkValue } from "./effect";

type Pick1<K extends string> = (s: EffectPhrases) => (p: { [k in K]: string }) => string;
type PickForm<K extends string> = (s: EffectPhrases) => { noun: (p: { [k in K]: string }) => string; act: (p: { [k in K]: string }) => string };

const t = (c: Ctx, n: N) => c.e.noun(n).t;
const list = (c: Ctx, n: N) => {
	const u = unwrap(n);
	return u?.type === "ArrayExpression" ? c.e.g.list(u.elements.map((x: N) => t(c, x))) : t(c, u);
};

/** `X.op(subject)` with a noun and an action reading of one named argument. */
const one = <K extends string>(pick: PickForm<K>, key: K) => make((c, [x], mode) => (x ? D(form(pick(c.say), mode, { [key]: t(c, x) })) : null));
/** `X.op(subject)` read as an action (or a noun phrase) with one named argument. */
const just = <K extends string>(pick: Pick1<K>, key: K) => make((c, [x]) => (x ? D(pick(c.say)({ [key]: t(c, x) } as { [k in K]: string })) : null));
/** `X.op(target, value)` where the value reads plainly. */
const pair = <A extends string, B extends string>(pick: Pick1<A | B>, a: A, b: B, read: (c: Ctx, n: N) => Doc = (c, n) => c.e.noun(n)) =>
	make((c, [x, y]) => {
		if (!x || !y) return null;
		const v = read(c, y);
		return D(pick(c.say)({ [a]: t(c, x), [b]: v.t } as { [k in A | B]: string }), v.kids);
	});
const constant = (pick: (s: EffectPhrases) => string) => make((c, _a, mode) => D(mode === "act" ? c.say.common.create({ thing: pick(c.say) }) : pick(c.say)));
/** A constructor like `Queue.bounded(n)`: a noun, or "create …" as a step. */
const built = <K extends string>(pick: Pick1<K>, key: K) =>
	make((c, [x], mode) => {
		if (!x) return null;
		const thing = pick(c.say)({ [key]: t(c, x) } as { [k in K]: string });
		return D(mode === "act" ? c.say.common.create({ thing }) : thing);
	});

const refOps = (makePick: PickForm<"value">): OpTable => ({
	make: one(makePick, "value"),
	get: one((s) => s.ref.get, "ref"),
	set: pair((s) => s.ref.set, "ref", "value"),
	update: pair((s) => s.ref.update, "ref", "value", thunkValue),
	getAndSet: pair((s) => s.ref.getAndSet, "ref", "value"),
	getAndUpdate: pair((s) => s.ref.getAndUpdate, "ref", "value", thunkValue),
	updateAndGet: pair((s) => s.ref.updateAndGet, "ref", "value", thunkValue),
	modify: pair((s) => s.ref.modify, "ref", "fn"),
});
const prefixed = (module: string, ops: OpTable): OpTable => Object.fromEntries(Object.entries(ops).map(([k, op]) => [`${module}.${k}`, op]));
const effectful = pair((s) => s.ref.updateEffect, "ref", "action", thunkAction);

const raceAll = make((c, [xs], mode) => {
	const u = unwrap(xs);
	if (u?.type !== "ArrayExpression") return null;
	return D(
		c.say.race.all[mode],
		u.elements.flatMap((x: N) => c.e.bullet(act(c, x))),
	);
});

const shared: OpTable = {
	...prefixed(
		"Ref",
		refOps((s) => s.ref.make),
	),
	...prefixed("SynchronizedRef", { ...refOps((s) => s.ref.makeSynchronized), updateEffect: effectful, modifyEffect: effectful }),
	...prefixed("SubscriptionRef", { ...refOps((s) => s.ref.makeSubscription), updateEffect: effectful, changes: just((s) => s.ref.changes, "ref") }),

	"Queue.bounded": built((s) => s.queue.bounded, "n"),
	"Queue.unbounded": constant((s) => s.queue.unbounded),
	"Queue.dropping": built((s) => s.queue.dropping, "n"),
	"Queue.sliding": built((s) => s.queue.sliding, "n"),
	"Queue.offer": pair((s) => (p) => s.queue.offer({ queue: p.queue, item: p.item }), "queue", "item"),
	"Queue.offerAll": pair((s) => (p) => s.queue.offerAll({ queue: p.queue, items: p.items }), "queue", "items"),
	"Queue.take": one((s) => s.queue.take, "queue"),
	"Queue.takeAll": one((s) => s.queue.takeAll, "queue"),
	"Queue.takeN": make((c, [q, n], mode) => (q && n ? D(form(c.say.queue.takeN, mode, { queue: t(c, q), n: t(c, n) })) : null)),
	"Queue.poll": one((s) => s.queue.poll, "queue"),
	"Queue.size": just((s) => s.queue.size, "queue"),
	"Queue.shutdown": just((s) => s.queue.shutdown, "queue"),

	"PubSub.bounded": built((s) => s.pubsub.bounded, "n"),
	"PubSub.dropping": built((s) => s.pubsub.bounded, "n"),
	"PubSub.sliding": built((s) => s.pubsub.bounded, "n"),
	"PubSub.unbounded": constant((s) => s.pubsub.unbounded),
	"PubSub.publish": pair((s) => s.pubsub.publish, "hub", "message"),
	"PubSub.publishAll": pair((s) => s.pubsub.publishAll, "hub", "messages"),
	"PubSub.subscribe": one((s) => s.pubsub.subscribe, "hub"),
	"PubSub.shutdown": just((s) => s.queue.shutdown, "queue"),

	"Deferred.make": make((c, _a, mode) => D(c.say.deferred.make[mode])),
	"Deferred.succeed": pair((s) => s.deferred.succeed, "deferred", "value"),
	"Deferred.fail": pair((s) => s.deferred.fail, "deferred", "error", errorValue),
	"Deferred.complete": pair(
		(s) => s.deferred.complete,
		"deferred",
		"action",
		(c, n) => act(c, n),
	),
	"Deferred.await": one((s) => s.deferred.await, "deferred"),

	"Fiber.join": one((s) => s.fiber.join, "fiber"),
	"Fiber.interrupt": just((s) => s.fiber.interrupt, "fiber"),
	"Fiber.await": one((s) => s.fiber.await, "fiber"),
	"Fiber.joinAll": make((c, [f], mode) => (f ? D(form(c.say.fiber.joinAll, mode, { fibers: list(c, f) })) : null)),
	"Fiber.awaitAll": make((c, [f], mode) => (f ? D(form(c.say.fiber.awaitAll, mode, { fibers: list(c, f) })) : null)),
	"Fiber.interruptAll": make((c, [f]) => (f ? D(c.say.fiber.interruptAll({ fibers: list(c, f) })) : null)),

	"Effect.raceAll": raceAll,
	"Effect.race": {
		kind: "step",
		dataFirst: (a) => a.length > 1,
		render: (c, [other]) => (other ? D(c.say.race.with({ other: t(c, other) })) : null),
		first: (c, args, mode) =>
			D(
				c.say.race.all[mode],
				args.flatMap((x) => c.e.bullet(act(c, x))),
			),
	},
	"Effect.interruptible": step(0, (c) => D(c.say.race.interruptible)),
	"Effect.uninterruptible": step(0, (c) => D(c.say.race.uninterruptible)),
	"Effect.onInterrupt": step(1, (c, [fn]) => {
		if (!fn) return null;
		const a = thunkAction(c, fn);
		return D(c.say.race.onInterrupt({ action: a.t }), a.kids);
	}),
	"Effect.forkIn": step(1, (c, [scope]) => (scope ? D(c.say.race.forkIn({ scope: t(c, scope) })) : null)),
	"Effect.awaitAllChildren": step(0, (c) => D(c.say.race.awaitAllChildren)),
	"Effect.yieldNow": make((c, _a, mode) => D(mode === "act" ? c.say.program.yieldNow : (c.say.constants["Effect.yieldNow"] ?? c.say.program.yieldNow))),

	"Effect.request": make((c, [req, resolver], mode) => {
		if (!req || !resolver) return null;
		return D(form(c.say.request.request, mode, { request: t(c, req), resolver: t(c, resolver) }));
	}),
	"Request.tagged": make((c, [tag]) => (tag ? D(c.say.request.tagged({ tag: t(c, tag) })) : null)),
	"Request.succeed": pair((s) => s.request.complete, "request", "value"),
	"Request.complete": pair((s) => s.request.complete, "request", "value"),
	"Request.fail": pair((s) => s.request.completeFail, "request", "error", errorValue),
	"RequestResolver.fromEffect": make((c, [fn]) => (fn ? callbackStep(c, c.say.request.single, fn, "action") : null)),
	"RequestResolver.fromFunction": make((c, [fn]) => (fn ? callbackStep(c, c.say.request.single, fn, "value" as const) : null)),
	"RequestResolver.make": make((c, [fn]) => (fn ? callbackStep(c, c.say.request.batched, fn, "action") : null)),
	"RequestResolver.batchN": step(1, (c, [n]) => (n ? D(c.say.request.batchN({ n: t(c, n) })) : null)),
};

const v3: OpTable = {
	"RequestResolver.makeBatched": make((c, [fn]) => (fn ? callbackStep(c, c.say.request.batched, fn, "action") : null)),
	"RequestResolver.fromFunctionBatched": make((c, [fn]) => (fn ? callbackStep(c, c.say.request.batched, fn, "value" as const) : null)),
};

const v4: OpTable = {
	"Queue.end": just((s) => s.queue.end, "queue"),
	"PubSub.take": one((s) => s.queue.take, "queue"),
	"PubSub.takeAll": one((s) => s.queue.takeAll, "queue"),
};

/** Mutable state, queues, hubs, deferreds, fibers, races and batched requests. */
export const stateOps = { shared, v3, v4 };
