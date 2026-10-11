import { D, type Doc, type Line } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import type { BullEvent } from "./phrases";
import { queueDetails, queueRef } from "./queue";
import {
	type Ctx,
	ctorKind,
	detailed,
	fnLines,
	genericOption,
	isFn,
	isJob,
	isQueue,
	isQueueEvents,
	isTrue,
	isWorker,
	keyOf,
	ms,
	objectArg,
	perMs,
	propOf,
	type Rule,
	str,
} from "./shared";

/** Worker options: concurrency, rate limiting, locks and stall checks, retention. */
function workerDetails(c: Ctx, n: N | undefined): string[] {
	const { e, say } = c;
	const w = say.worker;
	const o = objectArg(n);
	if (!o) return n ? [e.text(n)] : [];
	return o.properties.flatMap((p: N): string[] => {
		const k = keyOf(p);
		const v = p.value;
		switch (k) {
			case "concurrency":
				return [w.concurrency({ n: p.shorthand ? e.ref(k) : e.text(v) })];
			case "limiter": {
				const l = objectArg(v);
				if (!l || !propOf(l, "max") || !propOf(l, "duration")) return [genericOption(c, p)];
				const max = e.text(propOf(l, "max"));
				const duration = perMs(c, propOf(l, "duration"));
				const group = propOf(l, "groupKey");
				return [group ? w.limiterPerGroup({ max, duration, key: e.text(group) }) : w.limiter({ max, duration })];
			}
			case "autorun":
				return isTrue(v) ? [] : [w.manualStart];
			case "lockDuration":
				return [w.lockDuration({ duration: ms(c, v) })];
			case "stalledInterval":
				return [w.stalledInterval({ duration: ms(c, v) })];
			case "maxStalledCount":
				return [w.maxStalledCount({ n: e.text(v) })];
			case "useWorkerThreads":
				return isTrue(v) ? [w.workerThreads] : [];
			case "connection":
			case "prefix":
				return queueDetails(c, { type: "ObjectExpression", properties: [p] }).map((x) => x.t);
			default:
				return [genericOption(c, p)];
		}
	});
}

/** A processor given as a file path: a string, `__dirname + "/x.js"`, a template, `path.join(…)`, or a `URL`. */
function isFilePath(n: N): boolean {
	const u = unwrap(n);
	if (str(u) !== null || u?.type === "TemplateLiteral") return true;
	if (u?.type === "BinaryExpression" && u.operator === "+") return isFilePath(u.left) || isFilePath(u.right);
	if (u?.type === "NewExpression") return unwrap(u.callee)?.name === "URL";
	const callee = u?.type === "CallExpression" ? unwrap(u.callee) : null;
	return callee?.type === "MemberExpression" && unwrap(callee.object)?.name === "path" && ["join", "resolve"].includes(callee.property.name);
}

/** `new Worker(queue, processor, opts)`: what each job runs, and how many run at once. */
export function workerParts(c: Ctx, node: N): { queue: string; processor: string | null; items: Doc[]; lines: Line[] } {
	const [queue, processor, opts] = node.arguments;
	const p = unwrap(processor);
	const proc = !p ? null : isFn(p) ? null : isFilePath(p) ? c.say.worker.sandboxed({ file: c.e.text(p) }) : c.e.text(p);
	return { queue: queueRef(c, queue), processor: proc, items: workerDetails(c, opts).map((t) => D(t)), lines: p && isFn(p) ? fnLines(c.e, p) : [] };
}

const newWorker: Rule = (c, { node, stmt }) => {
	if (ctorKind(c, node) !== "workers") return null;
	const w = workerParts(c, node);
	if (stmt) return detailed(c, w.items, (details) => c.say.worker.create({ as: null, ...w, details }), w.lines);
	return detailed(c, w.items, (details) => c.say.worker.noun({ ...w, details }), w.lines);
};

const newQueue: Rule = (c, { node }) => {
	if (ctorKind(c, node) !== "queues") return null;
	return detailed(c, queueDetails(c, node.arguments[1]), (details) => c.say.queue.noun({ name: c.e.text(node.arguments[0]), details }));
};

const newEvents: Rule = (c, { node }) => (ctorKind(c, node) === "events" ? D(c.say.events.listen({ queue: queueRef(c, node.arguments[0]), as: null })) : null);

const newFlow: Rule = (c, { node }) => (ctorKind(c, node) === "flows" ? D(c.say.flow.producer) : null);

const EVENTS = new Set<string>([
	"completed",
	"failed",
	"progress",
	"active",
	"stalled",
	"error",
	"drained",
	"waiting",
	"delayed",
	"added",
	"removed",
	"paused",
	"resumed",
	"closed",
	"closing",
	"ready",
	"cleaned",
	"deduplicated",
	"debounced",
	"duplicated",
	"retries-exhausted",
	"waiting-children",
]);

const isEmitter = (c: Ctx, obj: N | null) => isWorker(c, obj) || isQueueEvents(c, obj) || isQueue(c, obj);

/** `worker.on("failed", (job, err) => …)`: the handler's steps under "whenever a job fails on worker". */
const on =
	(once: boolean): Rule =>
	(c, { obj, args }) => {
		const ev = str(args[0]);
		if (!isEmitter(c, obj) || ev === null || !EVENTS.has(ev) || !args[1]) return null;
		const event = c.say.events.names[ev as BullEvent];
		const fn = unwrap(args[1]);
		if (isFn(fn)) return D(c.say.events.on({ event, source: c.e.text(obj), once, handler: null }), fnLines(c.e, fn, false));
		return D(c.say.events.on({ event, source: c.e.text(obj), once, handler: c.e.text(fn) }));
	};

const off: Rule = (c, { obj, args }) => {
	const ev = str(args[0]);
	if (!isEmitter(c, obj) || ev === null || !EVENTS.has(ev)) return null;
	return D(c.say.events.off({ event: c.say.events.names[ev as BullEvent], source: c.e.text(obj) }));
};

const onWorker =
	(f: (c: Ctx, w: string, args: N[]) => string | null): Rule =>
	(c, { obj, args }) => {
		if (!isWorker(c, obj)) return null;
		const t = f(c, c.e.text(obj), args);
		return t === null ? null : D(t);
	};

const onJob =
	(f: (c: Ctx, job: string, args: N[]) => string | null): Rule =>
	(c, { obj, args }) => {
		if (!isJob(c, obj) || isQueue(c, obj)) return null;
		const t = f(c, c.e.text(obj), args);
		return t === null ? null : D(t);
	};

export function workerCalls(): Record<string, Rule> {
	const j = (c: Ctx) => c.say.job;
	return {
		"new Worker": newWorker,
		"new WorkerPro": newWorker,
		"new Queue": newQueue,
		"new QueuePro": newQueue,
		"new QueueEvents": newEvents,
		"new QueueEventsPro": newEvents,
		"new FlowProducer": newFlow,
		"new FlowProducerPro": newFlow,
		"*.on": on(false),
		"*.once": on(true),
		"*.off": off,
		"*.run": onWorker((c, worker, args) => (args.length ? null : c.say.worker.run({ worker }))),
		"*.close": onWorker((c, worker, [force]) => c.say.worker.close({ worker, force: isTrue(force) })),
		"*.pause": (c, site) =>
			isQueue(c, site.obj) ? D(c.say.queue.pause({ queue: c.e.text(site.obj) })) : onWorker((c2, worker) => c2.say.worker.pause({ worker }))(c, site),
		"*.resume": (c, site) =>
			isQueue(c, site.obj) ? D(c.say.queue.resume({ queue: c.e.text(site.obj) })) : onWorker((c2, worker) => c2.say.worker.resume({ worker }))(c, site),
		"*.rateLimit": onWorker((c, worker, [d]) => (d ? c.say.worker.rateLimit({ worker, duration: ms(c, d) }) : null)),
		"Worker.RateLimitError": (c, { obj }) =>
			unwrap(obj)?.type === "Identifier" && c.facts.imports.get(unwrap(obj).name) === "Worker" ? D(c.say.worker.rateLimitError) : null,
		"*.updateProgress": onJob((c, job, [v]) => {
			if (!v) return null;
			const n = c.e.fold(v);
			return n !== null ? j(c).progressPercent({ job, n: c.e.text(v) }) : j(c).progress({ job, value: c.e.text(v) });
		}),
		"*.log": onJob((c, job, [row]) => (row ? j(c).log({ job, row: c.e.text(row) }) : null)),
		"*.moveToFailed": onJob((c, job, [err]) => (err ? j(c).fail({ job, error: c.e.text(err) }) : null)),
		"*.moveToCompleted": onJob((c, job, [value]) => j(c).complete({ job, value: value ? c.e.text(value) : null })),
		"*.moveToDelayed": onJob((c, job, [ts]) => (ts ? j(c).delay({ job, until: c.e.text(ts) }) : null)),
		"*.moveToWait": onJob((c, job) => j(c).wait({ job })),
		"*.moveToWaitingChildren": onJob((c, job) => j(c).waitChildren({ job })),
		"*.retry": onJob((c, job) => j(c).retry({ job })),
		"*.promote": onJob((c, job) => j(c).promote({ job })),
		"*.remove": onJob((c, job, args) => (args.length ? null : j(c).remove({ job }))),
		"*.updateData": onJob((c, job, [data]) => (data ? j(c).updateData({ job, data: c.e.text(data) }) : null)),
		"*.changeDelay": onJob((c, job, [d]) => (d ? j(c).changeDelay({ job, duration: ms(c, d) }) : null)),
		"*.changePriority": onJob((c, job, [o]) => {
			const p = propOf(objectArg(o), "priority");
			return p ? j(c).changePriority({ job, n: c.e.text(p) }) : null;
		}),
		"*.waitUntilFinished": onJob((c, job, [events, ttl]) => (events ? j(c).result({ job, events: c.e.text(events), timeout: ttl ? ms(c, ttl) : null }) : null)),
		"*.getChildrenValues": onJob((c, job) => j(c).childResults({ job })),
		"*.getState": onJob((c, job) => j(c).state({ job })),
		"*.discard": onJob((c, job) => j(c).discard({ job })),
		"*.extendLock": onJob((c, job, [, d]) => (d ? j(c).extendLock({ job, duration: ms(c, d) }) : null)),
	};
}

export const attemptsMade = (c: Ctx, obj: N): Doc | null => (isJob(c, obj) ? D(c.say.job.attemptsMade({ job: c.e.text(obj) })) : null);
