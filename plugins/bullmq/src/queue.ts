import { D, type Doc, type Line, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import type { JobState } from "./phrases";
import { type Ctx, details, genericOption, isFalse, isFlow, isQueue, isTrue, keyOf, ms, objectArg, perMs, propOf, type Rule, secs, str } from "./shared";
import { cronText } from "./time";

const time = (c: Ctx) => ({ e: c.e, time: c.say.time });

/** `the "emails" queue`, or the queue variable as written. */
export const queueRef = (c: Ctx, n: N): string => (str(n) !== null ? c.say.queue.named({ name: c.e.text(n) }) : c.e.text(n));

/** `a "send-email" job` / `a job named name`. */
export const jobRef = (c: Ctx, n: N): string => (str(n) !== null ? c.say.queue.job({ name: c.e.text(n) }) : c.say.queue.jobNamed({ name: c.e.text(n) }));

/** A repeat / job-scheduler options object: "every day at 09:00 (cron 0 9 * * *), at most 10 times". */
export function scheduleText(c: Ctx, n: N): string {
	const { e, say } = c;
	const o = objectArg(n);
	if (!o) return e.text(n);
	const zone = str(propOf(o, "tz"));
	const items: string[] = [];
	for (const p of o.properties) {
		const k = keyOf(p);
		if (k === "tz" && zone !== null) continue;
		if (k === "pattern" || k === "cron") items.push(cronText(time(c), p.value, zone));
		else if (k === "every") items.push(say.schedule.every({ duration: perMs(c, p.value) }));
		else if (k === "limit") items.push(say.schedule.limit({ n: e.text(p.value) }));
		else if (k === "startDate") items.push(say.schedule.startDate({ date: e.text(p.value) }));
		else if (k === "endDate") items.push(say.schedule.endDate({ date: e.text(p.value) }));
		else if (k === "immediately" && isTrue(p.value)) items.push(say.schedule.immediately);
		else if (k === "count" || k === "prevMillis" || k === "offset" || k === "jobId" || k === "key") continue;
		else items.push(genericOption(c, p));
	}
	return items.join(", ");
}

function backoffText(c: Ctx, n: N): string {
	const { say } = c;
	const o = objectArg(n);
	if (!o) return say.options.backoffFixed({ delay: ms(c, n) });
	const type = str(propOf(o, "type"));
	const delay = propOf(o, "delay");
	const d = delay ? ms(c, delay) : null;
	if (type === "exponential" && d) return say.options.backoffExponential({ delay: d });
	if ((type === "fixed" || type === null) && d) return say.options.backoffFixed({ delay: d });
	return say.options.backoffCustom({ type: c.e.text(propOf(o, "type")) });
}

function keepText(c: Ctx, n: N, state: "Completed" | "Failed"): string {
	const { say } = c;
	const o = say.options;
	if (isTrue(n)) return state === "Completed" ? o.removeOnComplete : o.removeOnFail;
	if (isFalse(n)) return state === "Completed" ? o.keepOnComplete : o.keepOnFail;
	const obj = objectArg(n);
	if (obj && propOf(obj, "age")) {
		const count = propOf(obj, "count");
		return o[`keep${state}For`]({ age: secs(c, propOf(obj, "age")), count: count ? c.e.text(count) : null });
	}
	const count = obj ? propOf(obj, "count") : n;
	return o[`keepLast${state}`]({ n: c.e.text(count) });
}

function dedupeText(c: Ctx, n: N): string {
	const o = objectArg(n);
	if (!o) return genericOption(c, n);
	const ttl = propOf(o, "ttl");
	const mode = isTrue(propOf(o, "replace")) ? "replace" : isTrue(propOf(o, "extend")) ? "extend" : "keep";
	return c.say.options.deduplicate({ id: c.e.text(propOf(o, "id")), ttl: ttl ? ms(c, ttl) : null, mode });
}

/** Job options as phrases in the order written: delay, attempts, backoff, repeat, ID, priority, retention, deduplication. */
export function jobOptionItems(c: Ctx, n: N | null): string[] {
	if (!n) return [];
	const { e, say } = c;
	const o = objectArg(n);
	if (!o) return [e.text(n)];
	const opt = say.options;
	return o.properties.flatMap((p: N): string[] => {
		const k = keyOf(p);
		if (!k) return [genericOption(c, p)];
		const v = p.value;
		switch (k) {
			case "delay":
				return [opt.delay({ duration: ms(c, v) })];
			case "attempts": {
				const count = e.fold(v);
				return [opt.attempts({ n: e.text(v), count })];
			}
			case "backoff":
				return [backoffText(c, v)];
			case "repeat":
				return [opt.repeat({ schedule: scheduleText(c, v) })];
			case "jobId":
				return [opt.jobId({ id: e.text(v) })];
			case "priority":
				return [opt.priority({ n: e.text(v) })];
			case "lifo":
				return isTrue(v) ? [opt.lifo] : [];
			case "removeOnComplete":
				return [keepText(c, v, "Completed")];
			case "removeOnFail":
				return [keepText(c, v, "Failed")];
			case "deduplication":
			case "debounce":
				return [dedupeText(c, v)];
			case "parent": {
				const po = objectArg(v);
				const q = po && propOf(po, "queue");
				return [opt.parent({ id: e.text(po ? propOf(po, "id") : v), queue: q ? e.text(q) : null })];
			}
			case "failParentOnFailure":
			case "ignoreDependencyOnFailure":
			case "removeDependencyOnFailure":
			case "continueParentOnFailure":
				return isTrue(v) ? [opt[k]] : [];
			default:
				return [genericOption(c, p)];
		}
	});
}

/** Short option lists read inline; longer ones become bullets beneath. */
export function withOptions(c: Ctx, title: string, items: string[], kids: Line[] = []): Doc {
	const inline = items.length <= 2 && items.join(", ").length < 90;
	if (inline && items.length) return D(`${title}, ${details(c, items)}`, kids);
	return D(title, [...kids, ...items.flatMap((i) => c.e.bullet(D(i)))]);
}

/** Job data; a small object literal reads as its fields ("the data user ID and email: x"). */
export function dataText(c: Ctx, n: N | undefined | null): { t: string | null; kids: Line[] } {
	if (!n) return { t: null, kids: [] };
	const u = unwrap(n);
	if (u?.type === "ObjectExpression" && !u.properties.length) return { t: null, kids: [] };
	if (u?.type === "ObjectExpression" && u.properties.length <= 4) {
		const fields = u.properties.map((p: N) => c.e.objectProp(p));
		if (fields.every((f: Doc) => !f.kids.length)) return { t: c.say.queue.data({ data: c.e.g.list(fields.map((f: Doc) => f.t)), bare: false }), kids: [] };
	}
	const d = c.e.noun(n);
	return { t: c.say.queue.data({ data: d.t, bare: u?.type === "Identifier" && /^data$/i.test(u.name) }), kids: d.kids };
}

/** `queue.add(name, data, opts)`. */
const add: Rule = (c, { obj, args }) => {
	if (!isQueue(c, obj) || args.length < 2 || isFlow(c, obj)) return null;
	const data = dataText(c, args[1]);
	const title = c.say.queue.add({ job: jobRef(c, args[0]), queue: c.e.text(obj), data: data.t });
	return withOptions(c, title, jobOptionItems(c, args[2] ?? null), data.kids);
};

/** One `{ name, data, opts }` entry of `addBulk`. */
function bulkItem(c: Ctx, n: N): Doc {
	const o = objectArg(n);
	if (!o || !propOf(o, "name")) return c.e.noun(n);
	const data = dataText(c, propOf(o, "data"));
	const items = [data.t, ...jobOptionItems(c, propOf(o, "opts"))].filter((x): x is string => !!x);
	return D(`${jobRef(c, propOf(o, "name"))}${items.length ? ` (${details(c, items)})` : ""}`, data.kids);
}

const addBulk: Rule = (c, { obj, args }) => {
	if (!isQueue(c, obj) || isFlow(c, obj)) return null;
	const list = unwrap(args[0]);
	if (list?.type !== "ArrayExpression") return null;
	return D(
		c.say.queue.addBulk({ queue: c.e.text(obj) }),
		list.elements.filter(Boolean).flatMap((x: N) => c.e.bullet(bulkItem(c, x))),
	);
};

/** `queue.upsertJobScheduler(id, { every | pattern }, { name, data, opts })`. */
const upsertScheduler: Rule = (c, { obj, args }) => {
	if (!isQueue(c, obj) || args.length < 2) return null;
	const { e, say } = c;
	const template = objectArg(args[2]);
	const name = template && propOf(template, "name");
	const data = dataText(c, template && propOf(template, "data"));
	const items = jobOptionItems(c, template && propOf(template, "opts"));
	const title = say.schedule.upsert({
		job: jobRef(c, name ?? args[0]),
		queue: e.text(obj),
		schedule: scheduleText(c, args[1]),
		id: e.text(args[0]),
		data: data.t,
	});
	return withOptions(c, title, items, data.kids);
};

const STATE_NAMES = new Set(["completed", "failed", "delayed", "active", "wait", "waiting", "paused", "prioritized", "waiting-children", "repeat"]);

/** `["completed", "failed"]` / `"completed", "failed"` as "completed and failed". */
function statesText(c: Ctx, args: N[]): string | null {
	const flat = args.flatMap((a) => (unwrap(a)?.type === "ArrayExpression" ? unwrap(a).elements : [a]));
	if (!flat.length) return null;
	const words = flat.map((a: N) => {
		const s = str(a);
		return s !== null && STATE_NAMES.has(s) ? c.say.queue.states[s as JobState] : c.e.text(a);
	});
	return c.e.g.list(words);
}

const COUNTS: Record<string, JobState> = {
	getWaitingCount: "waiting",
	getActiveCount: "active",
	getCompletedCount: "completed",
	getFailedCount: "failed",
	getDelayedCount: "delayed",
	getPrioritizedCount: "prioritized",
	getWaitingChildrenCount: "waiting-children",
};

const onQueue =
	(f: (c: Ctx, q: string, args: N[]) => string | null): Rule =>
	(c, { obj, args }) => {
		if (!isQueue(c, obj)) return null;
		const t = f(c, c.e.text(obj), args);
		return t === null ? null : D(t);
	};

export function queueCalls(): Record<string, Rule> {
	return {
		"*.add": add,
		"*.addBulk": addBulk,
		"*.upsertJobScheduler": upsertScheduler,
		"*.removeJobScheduler": onQueue((c, queue, [id]) => (id ? c.say.schedule.remove({ id: c.e.text(id), queue }) : null)),
		"*.getJobScheduler": onQueue((c, queue, [id]) => (id ? c.say.schedule.get({ id: c.e.text(id), queue }) : null)),
		"*.getJobSchedulers": onQueue((c, queue) => c.say.schedule.list({ queue })),
		"*.removeRepeatable": onQueue((c, queue, [name, repeat]) =>
			name && repeat ? c.say.schedule.removeRepeatable({ job: jobRef(c, name), queue, schedule: scheduleText(c, repeat) }) : null,
		),
		"*.removeRepeatableByKey": onQueue((c, queue, [key]) => (key ? c.say.schedule.removeRepeatableByKey({ key: c.e.text(key), queue }) : null)),
		"*.getJob": onQueue((c, queue, [id]) => (id ? c.say.queue.get({ id: c.e.text(id), queue }) : null)),
		"*.getJobs": onQueue((c, queue, [types]) => c.say.queue.list({ states: types ? statesText(c, [types]) : null, queue })),
		"*.getJobCounts": onQueue((c, queue, args) =>
			args.length ? c.say.queue.count({ states: statesText(c, args), queue }) : c.say.queue.countsByState({ queue }),
		),
		"*.getJobCountByTypes": onQueue((c, queue, args) => c.say.queue.count({ states: statesText(c, args), queue })),
		...Object.fromEntries(
			Object.entries(COUNTS).map(([m, s]) => [`*.${m}`, onQueue((c, queue) => c.say.queue.count({ states: c.say.queue.states[s], queue }))]),
		),
		"*.count": onQueue((c, queue, args) => (args.length ? null : c.say.queue.pending({ queue }))),
		"*.drain": onQueue((c, queue, [delayed]) => c.say.queue.drain({ queue, delayed: isTrue(delayed) })),
		"*.obliterate": onQueue((c, queue, [opts]) => c.say.queue.obliterate({ queue, force: isTrue(propOf(objectArg(opts), "force")) })),
		"*.clean": onQueue((c, queue, [grace, limit, type]) =>
			grace
				? c.say.queue.clean({
						queue,
						age: ms(c, grace),
						limit: limit && c.e.fold(limit) !== 0 ? c.e.text(limit) : null,
						state: type ? (statesText(c, [type]) ?? "") : c.say.queue.states.completed,
					})
				: null,
		),
		"*.retryJobs": onQueue((c, queue, [opts]) => {
			const state = propOf(objectArg(opts), "state");
			return c.say.queue.retryJobs({ queue, state: state ? (statesText(c, [state]) ?? "") : c.say.queue.states.failed });
		}),
		"*.promoteJobs": onQueue((c, queue) => c.say.queue.promoteJobs({ queue })),
		"*.setGlobalConcurrency": onQueue((c, queue, [n]) => (n ? c.say.queue.globalConcurrency({ queue, n: c.e.text(n) }) : null)),
		"*.setGlobalRateLimit": onQueue((c, queue, [max, duration]) =>
			max && duration ? c.say.queue.globalRateLimit({ queue, max: c.e.text(max), duration: perMs(c, duration) }) : null,
		),
		"*.remove": onQueue((c, queue, [id]) => (id ? c.say.queue.remove({ queue, id: c.e.text(id) }) : null)),
	};
}

/** Queue construction details: connection, prefix, and the default options every job gets. */
export function queueDetails(c: Ctx, n: N | undefined): string[] {
	const o = objectArg(n);
	if (!o) return n ? [c.e.text(n)] : [];
	return o.properties.flatMap((p: N): string[] => {
		const k = keyOf(p);
		if (k === "connection") return [c.say.queue.connection({ value: p.shorthand ? c.e.ref(k) : c.e.text(p.value) })];
		if (k === "prefix") return [c.say.queue.prefix({ value: c.e.text(p.value) })];
		if (k === "defaultJobOptions") return [c.say.queue.defaults({ options: jobOptionItems(c, p.value).join(", ") })];
		return [genericOption(c, p)];
	});
}

export const nameText = (c: Ctx, n: N) => (str(n) !== null ? mk("l", `"${str(n)}"`) : c.e.text(n));
