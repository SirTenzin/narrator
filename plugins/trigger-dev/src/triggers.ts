import { D, type Doc, type Line, plain } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import type { KeyScope } from "./phrases";
import { type Ctx, details, dur, fnLines, genericOption, importedAs, isFn, isTask, keyOf, objectArg, oneLine, propOf, type Rule, secs, str } from "./shared";
import { retryItems } from "./tasks";
import { cronString, cronText } from "./time";

const time = (c: Ctx) => ({ e: c.e, time: c.say.time });

/** Short option lists read inline; longer ones (or a payload with lines of its own) become bullets beneath. */
function withOptions(c: Ctx, make: (payload: string | null) => string, payload: { t: string | null; kids: Line[] }, items: string[], inline = true): Doc {
	if (payload.kids.length) return D(make(null), [...c.e.bullet(D(payload.t ?? "", payload.kids)), ...items.flatMap((i) => c.e.bullet(D(i)))]);
	const title = make(payload.t);
	if (inline && items.length && items.length <= 2 && plain(items.join(", ")).length < 90) return D(`${title} (${details(c, items)})`);
	return D(
		title,
		items.flatMap((i) => c.e.bullet(D(i))),
	);
}

/** A payload; a small object literal reads as its fields. */
function payloadText(c: Ctx, n: N | undefined | null): { t: string | null; kids: Line[] } {
	if (!n) return { t: null, kids: [] };
	const u = unwrap(n);
	if (u?.type === "ObjectExpression" && !u.properties.length) return { t: null, kids: [] };
	if (u?.type === "ObjectExpression" && u.properties.length <= 4) {
		const fields = u.properties.map((p: N) => c.e.objectProp(p));
		if (fields.every((f: Doc) => !f.kids.length))
			return { t: c.say.trigger.payload({ payload: c.e.g.list(fields.map((f: Doc) => f.t)), bare: false }), kids: [] };
	}
	const d = c.e.noun(n);
	return { t: c.say.trigger.payload({ payload: d.t, bare: u?.type === "Identifier" && /payload$/i.test(u.name) }), kids: d.kids };
}

/** Trigger options in the order written: delay, TTL, idempotency, concurrency key, queue, attempts, tags, priority. */
function triggerItems(c: Ctx, n: N | null): string[] {
	if (!n) return [];
	const { e, say } = c;
	const o = objectArg(n);
	if (!o) return [e.text(n)];
	const t = say.trigger;
	const ttl = propOf(o, "idempotencyKeyTTL");
	return o.properties.flatMap((p: N): string[] => {
		const k = keyOf(p);
		const v = p.value;
		switch (k) {
			case "delay": {
				const u = unwrap(v);
				return [u?.type === "Literal" && typeof u.value === "string" ? t.delay({ duration: dur(c, v) }) : t.delayUntil({ time: e.text(v) })];
			}
			case "ttl":
				return [say.config.ttl({ duration: typeof unwrap(v)?.value === "number" ? secs(c, v) : dur(c, v) })];
			case "idempotencyKey":
				return [t.idempotencyKey({ key: e.text(v), ttl: ttl ? dur(c, ttl) : null })];
			case "idempotencyKeyTTL":
				return propOf(o, "idempotencyKey") ? [] : [genericOption(c, p)];
			case "concurrencyKey":
				return [t.concurrencyKey({ key: e.text(v) })];
			case "queue": {
				const qo = objectArg(v);
				if (!qo) return [say.config.queue({ queue: e.text(v) })];
				const limit = propOf(qo, "concurrencyLimit");
				return [say.config.inlineQueue({ name: propOf(qo, "name") ? e.text(propOf(qo, "name")) : null, limit: limit ? e.text(limit) : null })];
			}
			case "maxAttempts":
				return [say.config.attempts({ n: e.text(v), count: e.fold(v) })];
			case "retry":
				return retryItems(c, v);
			case "tags": {
				const list = unwrap(v);
				return [t.tags({ tags: list?.type === "ArrayExpression" ? e.g.list(list.elements.filter(Boolean).map((x: N) => e.text(x))) : e.text(v) })];
			}
			case "priority":
				return [t.priority({ duration: secs(c, v) })];
			case "machine":
				return [say.config.machine({ machine: str(v) ?? e.text(v) })];
			case "maxDuration":
				return [say.config.maxDuration({ duration: secs(c, v) })];
			case "metadata":
				return [t.metadata({ value: e.text(v) })];
			case "region":
				return [t.region({ region: e.text(v) })];
			case "version":
			case "lockToVersion":
				return [t.version({ version: e.text(v) })];
			default:
				return [genericOption(c, p)];
		}
	});
}

/** Who is triggered: the task object itself, or `tasks.trigger("id", …)`'s first argument. */
function target(c: Ctx, obj: N | null, args: N[]): { task: string; rest: N[] } | null {
	if (!obj) return null;
	if (importedAs(c, obj) === "tasks") return args[0] ? { task: c.say.trigger.taskId({ id: c.e.text(args[0]) }), rest: args.slice(1) } : null;
	if (isTask(c, obj) && importedAs(c, obj) !== "batch") return { task: c.e.text(obj), rest: args };
	return null;
}

const trigger =
	(mode: "start" | "wait" | "poll"): Rule =>
	(c, { obj, args }) => {
		const t = target(c, obj, args);
		if (!t) return null;
		const p = payloadText(c, t.rest[0]);
		const items = triggerItems(c, t.rest[1] ?? null);
		const say = c.say.trigger;
		const make = (payload: string | null) =>
			mode === "start"
				? say.start({ task: t.task, payload })
				: mode === "poll"
					? say.startAndPoll({ task: t.task, payload })
					: say.startAndWait({ task: t.task, payload, unwrap: false });
		return withOptions(c, make, p, items);
	};

/** One batch item: `{ payload, options }`, `{ id, payload }` (batch.trigger) or `{ task, payload }` (triggerByTask). */
function itemDoc(c: Ctx, n: N): Doc {
	const o = objectArg(n);
	if (!o || (!propOf(o, "payload") && !propOf(o, "task"))) return c.e.noun(n);
	const id = propOf(o, "id");
	const task = propOf(o, "task");
	const p = payloadText(c, propOf(o, "payload"));
	const items = triggerItems(c, propOf(o, "options"));
	const who = id ? c.say.trigger.taskId({ id: c.e.text(id) }) : task ? c.e.text(task) : null;
	return D(c.say.trigger.item({ task: who, payload: p.t, details: details(c, items) }), p.kids);
}

const batch =
	(wait: boolean): Rule =>
	(c, { obj, args }) => {
		const owner = importedAs(c, obj) === "batch";
		const t = owner ? null : target(c, obj, args);
		if (!owner && !t) return null;
		const items = owner ? args[0] : t!.rest[0];
		const list = unwrap(items);
		const phrase = wait ? c.say.trigger.batchAndWait : c.say.trigger.batch;
		const task = owner ? null : t!.task;
		if (list?.type === "ArrayExpression")
			return D(
				phrase({ task, each: null }),
				list.elements.filter(Boolean).flatMap((x: N) => c.e.bullet(itemDoc(c, x))),
			);
		return D(phrase({ task, each: items ? c.e.text(items) : null }));
	};

/** `task.triggerAndWait(…).unwrap()` and `wait.forToken(…).unwrap()`. */
const unwrapRule: Rule = (c, { obj, args }) => {
	const inner = unwrap(obj);
	if (args.length || inner?.type !== "CallExpression") return null;
	const callee = unwrap(inner.callee);
	if (callee?.type !== "MemberExpression") return null;
	const m = callee.property.name;
	if (m === "forToken" && importedAs(c, callee.object) === "wait") return D(c.say.wait.forToken({ token: c.e.text(inner.arguments[0]), unwrap: true }));
	if (m !== "triggerAndWait") return null;
	const t = target(c, callee.object, inner.arguments);
	if (!t) return null;
	const p = payloadText(c, t.rest[0]);
	return withOptions(c, (payload) => c.say.trigger.startAndWait({ task: t.task, payload, unwrap: true }), p, triggerItems(c, t.rest[1] ?? null), false);
};

// ---------- wait, metadata, idempotency keys, runs, schedules, retry ----------

const UNIT_KEYS = new Set(["seconds", "minutes", "hours", "days", "weeks", "months", "years"]);

const waitFor: Rule = (c, { obj, args }) => {
	if (importedAs(c, obj) !== "wait") return null;
	const o = objectArg(args[0]);
	if (!o) return null;
	const span = { ...o, properties: o.properties.filter((p: N) => UNIT_KEYS.has(keyOf(p) ?? "")) };
	const key = propOf(o, "idempotencyKey");
	return D(c.say.wait.for({ duration: dur(c, span), details: key ? c.say.wait.idempotencyKey({ key: c.e.text(key) }) : null }));
};

const waitUntil: Rule = (c, { obj, args }) => {
	if (importedAs(c, obj) !== "wait") return null;
	const o = objectArg(args[0]);
	const date = o ? propOf(o, "date") : null;
	if (!date) return null;
	const key = propOf(o, "idempotencyKey");
	return D(c.say.wait.until({ time: c.e.text(date), details: key ? c.say.wait.idempotencyKey({ key: c.e.text(key) }) : null }));
};

const onWait =
	(f: (c: Ctx, args: N[]) => Doc | null): Rule =>
	(c, { obj, args }) =>
		importedAs(c, obj) === "wait" ? f(c, args) : null;

/** `metadata.set(…)`, `metadata.parent.set(…)`, `metadata.root.increment(…)`. */
function metadataOwner(c: Ctx, obj: N | null): "current" | "parent" | "root" | null {
	const u = unwrap(obj);
	if (importedAs(c, u) === "metadata") return "current";
	if (u?.type === "MemberExpression" && !u.computed && importedAs(c, u.object) === "metadata" && (u.property.name === "parent" || u.property.name === "root"))
		return u.property.name;
	return null;
}

const keyText = (c: Ctx, n: N) => (str(n) !== null ? c.e.text(n) : c.e.text(n));

const meta =
	(f: (c: Ctx, owner: string, args: N[]) => string | null): Rule =>
	(c, { obj, args }) => {
		const who = metadataOwner(c, obj);
		if (!who) return null;
		const t = f(c, c.say.metadata.owner[who], args);
		return t === null ? null : D(t);
	};

const METADATA: Record<string, Rule> = {
	set: meta((c, owner, [k, v]) => (k && v ? c.say.metadata.set({ owner, key: keyText(c, k), value: c.e.text(v) }) : null)),
	increment: meta((c, owner, [k, by]) => (k ? c.say.metadata.increment({ owner, key: keyText(c, k), by: by ? c.e.text(by) : "1" }) : null)),
	decrement: meta((c, owner, [k, by]) => (k ? c.say.metadata.decrement({ owner, key: keyText(c, k), by: by ? c.e.text(by) : "1" }) : null)),
	append: meta((c, owner, [k, v]) => (k && v ? c.say.metadata.append({ owner, key: keyText(c, k), value: c.e.text(v) }) : null)),
	remove: meta((c, owner, [k, v]) => (k && v ? c.say.metadata.remove({ owner, key: keyText(c, k), value: c.e.text(v) }) : null)),
	del: meta((c, owner, [k]) => (k ? c.say.metadata.del({ owner, key: keyText(c, k) }) : null)),
	replace: meta((c, owner, [v]) => (v ? c.say.metadata.replace({ owner, value: c.e.text(v) }) : null)),
	get: meta((c, owner, [k]) => (k ? c.say.metadata.get({ owner, key: keyText(c, k) }) : null)),
	current: meta((c, owner) => c.say.metadata.current({ owner })),
	flush: meta((c, owner) => c.say.metadata.flush({ owner })),
	stream: meta((c, owner, [k, v]) => (k && v ? c.say.metadata.stream({ owner, key: keyText(c, k), value: c.e.text(v) }) : null)),
};

const idempotencyKey: Rule = (c, { obj, args }) => {
	if (importedAs(c, obj) !== "idempotencyKeys" || !args[0]) return null;
	const scope = str(propOf(objectArg(args[1]), "scope"));
	return D(c.say.idempotencyKey({ key: c.e.text(args[0]), scope: scope === "run" || scope === "attempt" || scope === "global" ? (scope as KeyScope) : null }));
};

const onRuns =
	(f: (c: Ctx, args: N[]) => string | null): Rule =>
	(c, { obj, args }) => {
		if (importedAs(c, obj) !== "runs") return null;
		const t = f(c, args);
		return t === null ? null : D(t);
	};

const RUNS: Record<string, Rule> = {
	retrieve: onRuns((c, [id]) => (id ? c.say.runs.retrieve({ id: c.e.text(id) }) : null)),
	cancel: onRuns((c, [id]) => (id ? c.say.runs.cancel({ id: c.e.text(id) }) : null)),
	replay: onRuns((c, [id]) => (id ? c.say.runs.replay({ id: c.e.text(id) }) : null)),
	reschedule: onRuns((c, [id, o]) => {
		const delay = propOf(objectArg(o), "delay");
		return id && delay ? c.say.runs.reschedule({ id: c.e.text(id), delay: dur(c, delay) }) : null;
	}),
	list: onRuns((c, [f]) => c.say.runs.list({ filter: f ? c.e.text(f) : null })),
	subscribeToRun: onRuns((c, [id]) => (id ? c.say.runs.subscribe({ id: c.e.text(id) }) : null)),
	poll: onRuns((c, [id]) => (id ? c.say.runs.poll({ id: c.e.text(id) }) : null)),
};

const onSchedules =
	(f: (c: Ctx, args: N[]) => string | null): Rule =>
	(c, { obj, args }) => {
		if (importedAs(c, obj) !== "schedules") return null;
		const t = f(c, args);
		return t === null ? null : D(t);
	};

function scheduleWhen(c: Ctx, o: N): string | null {
	const cron = propOf(o, "cron");
	const tz = str(propOf(o, "timezone")) ?? "UTC";
	if (!cron) return null;
	return str(cron) !== null ? cronString(time(c), str(cron)!, tz) : cronText(time(c), cron, tz);
}

function scheduleExtras(c: Ctx, o: N): string[] {
	const ext = propOf(o, "externalId");
	const dedupe = propOf(o, "deduplicationKey");
	return [
		...(ext ? [c.say.schedules.externalId({ id: c.e.text(ext) })] : []),
		...(dedupe ? [c.say.schedules.deduplicationKey({ key: c.e.text(dedupe) })] : []),
	];
}

const SCHEDULES: Record<string, Rule> = {
	create: onSchedules((c, [opts]) => {
		const o = objectArg(opts);
		const when = o && scheduleWhen(c, o);
		if (!o || !when) return null;
		const task = propOf(o, "task");
		return c.say.schedules.create({ task: task ? c.e.text(task) : "", schedule: when, details: details(c, scheduleExtras(c, o)) });
	}),
	update: onSchedules((c, [id, opts]) => {
		const o = objectArg(opts);
		if (!id || !o) return null;
		return c.say.schedules.update({ id: c.e.text(id), schedule: scheduleWhen(c, o), details: details(c, scheduleExtras(c, o)) });
	}),
	del: onSchedules((c, [id]) => (id ? c.say.schedules.del({ id: c.e.text(id) }) : null)),
	activate: onSchedules((c, [id]) => (id ? c.say.schedules.activate({ id: c.e.text(id) }) : null)),
	deactivate: onSchedules((c, [id]) => (id ? c.say.schedules.deactivate({ id: c.e.text(id) }) : null)),
	retrieve: onSchedules((c, [id]) => (id ? c.say.schedules.retrieve({ id: c.e.text(id) }) : null)),
	list: onSchedules((c) => c.say.schedules.list),
};

const retryOnThrow: Rule = (c, { obj, args }) => {
	if (importedAs(c, obj) !== "retry" || !args[0] || !isFn(args[0])) return null;
	const attempts = propOf(objectArg(args[1]), "maxAttempts");
	const one = oneLine(c.e, args[0]);
	const title = c.say.retry.onThrow({ attempts: attempts ? c.e.text(attempts) : null });
	return one !== null ? D(`${title}: ${one}`) : D(title, fnLines(c.e, args[0]));
};

const retryFetch: Rule = (c, { obj, args }) => (importedAs(c, obj) === "retry" && args[0] ? D(c.say.retry.fetch({ url: c.e.text(args[0]) })) : null);

const each = (table: Record<string, Rule>) => Object.fromEntries(Object.entries(table).map(([k, r]) => [`*.${k}`, r]));

/** Rule tables; several share method names (`list`, `retrieve`), so the plugin tries them in turn. */
export function triggerTables(): Record<string, Rule>[] {
	return [
		{
			"*.trigger": (c, site) => (importedAs(c, site.obj) === "batch" ? batch(false)(c, site) : trigger("start")(c, site)),
			"*.triggerAndWait": (c, site) => (importedAs(c, site.obj) === "batch" ? batch(true)(c, site) : trigger("wait")(c, site)),
			"*.triggerAndPoll": trigger("poll"),
			"*.batchTrigger": batch(false),
			"*.batchTriggerAndWait": batch(true),
			"*.triggerByTask": batch(false),
			"*.triggerByTaskAndWait": batch(true),
			"*.unwrap": unwrapRule,
			"*.for": waitFor,
			"*.until": waitUntil,
			"*.createToken": onWait((c, [o]) => {
				const timeout = propOf(objectArg(o), "timeout");
				const key = propOf(objectArg(o), "idempotencyKey");
				return D(
					c.say.wait.createToken({ timeout: timeout ? dur(c, timeout) : null, details: key ? c.say.wait.idempotencyKey({ key: c.e.text(key) }) : null }),
				);
			}),
			"*.forToken": onWait((c, [t]) => (t ? D(c.say.wait.forToken({ token: c.e.text(t), unwrap: false })) : null)),
			"*.completeToken": onWait((c, [t, data]) => (t ? D(c.say.wait.completeToken({ token: c.e.text(t), data: data ? c.e.text(data) : null })) : null)),
			"*.create": idempotencyKey,
			"*.onThrow": retryOnThrow,
			"*.fetch": retryFetch,
		},
		each(METADATA),
		each(RUNS),
		each(SCHEDULES),
	];
}
