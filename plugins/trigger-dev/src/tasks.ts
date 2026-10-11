import { capFirst, D, type Doc, type Line } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import type { Hook } from "./phrases";
import { type Ctx, details, dur, fnLines, genericOption, importedAs, isFn, keyOf, objectArg, propOf, type Rule, secs, str } from "./shared";
import { cronString, cronText } from "./time";

const time = (c: Ctx) => ({ e: c.e, time: c.say.time });

const HOOKS = new Set<string>([
	"init",
	"middleware",
	"onStart",
	"onStartAttempt",
	"onSuccess",
	"onFailure",
	"onComplete",
	"onCancel",
	"onWait",
	"onResume",
	"catchError",
	"handleError",
	"cleanup",
]);

/** `retry: { maxAttempts, minTimeoutInMs, maxTimeoutInMs, factor, randomize, outOfMemory }`, or a shared policy constant. */
export function retryItems(c: Ctx, n: N): string[] {
	const { e, say } = c;
	const o = objectArg(n);
	if (!o) return [say.config.retryPolicy({ policy: e.text(n) })];
	const items: string[] = [];
	const attempts = propOf(o, "maxAttempts");
	if (attempts) items.push(say.config.attempts({ n: e.text(attempts), count: e.fold(attempts) }));
	const min = propOf(o, "minTimeoutInMs");
	const max = propOf(o, "maxTimeoutInMs");
	const factor = propOf(o, "factor");
	if ((min || max) && !(attempts && e.fold(attempts) === 1)) {
		const ms = (x: N) => (x ? dur(c, x) : null);
		items.push(
			say.config.backoff({ min: ms(min), max: ms(max), factor: factor ? e.text(factor) : null, randomize: unwrap(propOf(o, "randomize"))?.value === true }),
		);
	}
	const oom = objectArg(propOf(o, "outOfMemory"));
	const machine = oom && propOf(oom, "machine");
	if (machine) items.push(say.config.outOfMemory({ machine: e.text(machine) }));
	for (const p of o.properties) {
		const k = keyOf(p);
		if (k && ["maxAttempts", "minTimeoutInMs", "maxTimeoutInMs", "factor", "randomize", "outOfMemory"].includes(k)) continue;
		items.push(genericOption(c, p));
	}
	return items;
}

function machineText(c: Ctx, n: N): string {
	const o = objectArg(n);
	const preset = o ? propOf(o, "preset") : n;
	return c.say.config.machine({ machine: str(preset) ?? c.e.text(preset) });
}

function queueText(c: Ctx, n: N): string {
	const { e, say } = c;
	const u = unwrap(n);
	const o = objectArg(u);
	if (o) {
		const limit = propOf(o, "concurrencyLimit");
		return say.config.inlineQueue({ name: propOf(o, "name") ? e.text(propOf(o, "name")) : null, limit: limit ? e.text(limit) : null });
	}
	if (u?.type === "CallExpression" && importedAs(c, u.callee) === "queue") return queueText(c, u.arguments[0]);
	if (str(u) !== null) return say.config.queue({ queue: e.text(u) });
	return say.config.queue({ queue: e.text(u) });
}

/** Task options in the order written, minus `id`, `run`, `cron` and the hooks, which shape the title and body. */
function taskItems(c: Ctx, o: N): string[] {
	const { e, say } = c;
	return o.properties.flatMap((p: N): string[] => {
		const k = keyOf(p);
		const v = p.value;
		if (!k) return [genericOption(c, p)];
		if (k === "id" || k === "run" || k === "cron" || HOOKS.has(k)) return [];
		switch (k) {
			case "queue":
				return [queueText(c, v)];
			case "retry":
				return retryItems(c, v);
			case "machine":
				return [machineText(c, v)];
			case "maxDuration":
				return [say.config.maxDuration({ duration: secs(c, v) })];
			case "ttl":
				return [say.config.ttl({ duration: secs(c, v) })];
			case "schema":
				return [say.task.schema({ schema: e.text(v) })];
			case "description":
				return [say.task.description({ text: e.text(v) })];
			default:
				return [genericOption(c, p)];
		}
	});
}

/** The run function's steps, then each lifecycle hook as its own block. */
function taskLines(c: Ctx, o: N): Line[] {
	const { e, say } = c;
	const run = unwrap(propOf(o, "run"));
	const lines: Line[] = run ? (isFn(run) ? fnLines(e, run) : e.bullet(D(say.task.runs({ handler: e.text(run) })))) : [];
	for (const p of o.properties) {
		const k = keyOf(p);
		if (!k || !HOOKS.has(k)) continue;
		const hook = say.task.hooks[k as Hook];
		const fn = unwrap(p.value);
		const line = (text: string): Line => ({ d: 0, text: capFirst(text), start: p.start, end: p.end, kind: "stmt" });
		if (isFn(fn)) lines.push(line(`${hook}:`), ...fnLines(e, fn).map((l) => ({ ...l, d: l.d + 1 })));
		else lines.push(line(`${say.task.hookWith({ hook, handler: e.text(fn) })}.`));
	}
	return lines;
}

/** `schedules.task({ cron })`: `"0 9 * * *"` or `{ pattern, timezone, environments }`. */
function scheduleOf(c: Ctx, n: N | null): { schedule: string | null; extra: string[] } {
	const u = unwrap(n);
	if (!u) return { schedule: null, extra: [] };
	const o = objectArg(u);
	if (!o) return { schedule: cronText(time(c), u, "UTC"), extra: [] };
	const tz = str(propOf(o, "timezone")) ?? "UTC";
	const pattern = propOf(o, "pattern");
	const envs = unwrap(propOf(o, "environments"));
	const extra = envs
		? [c.say.task.environments({ list: envs.type === "ArrayExpression" ? c.e.g.list(envs.elements.map((x: N) => str(x) ?? c.e.text(x))) : c.e.text(envs) })]
		: [];
	const p = str(pattern);
	return { schedule: p !== null ? cronString(time(c), p, tz) : pattern ? cronText(time(c), pattern, tz) : null, extra };
}

export type TaskParts = { id: string; details: string | null; lines: Line[]; scheduled: boolean; schedule: string | null };

export function taskParts(c: Ctx, node: N): TaskParts | null {
	const u = unwrap(node);
	if (u?.type !== "CallExpression") return null;
	const callee = unwrap(u.callee);
	const factory = importedAs(c, callee);
	const scheduled = callee?.type === "MemberExpression" && importedAs(c, callee.object) === "schedules" && callee.property.name === "task";
	if (!scheduled && factory !== "task" && factory !== "schemaTask" && factory !== "toolTask") return null;
	const o = objectArg(u.arguments[0]);
	if (!o || !propOf(o, "id")) return null;
	const s = scheduled ? scheduleOf(c, propOf(o, "cron")) : { schedule: null, extra: [] };
	return { id: c.e.text(propOf(o, "id")), details: details(c, [...s.extra, ...taskItems(c, o)]), lines: taskLines(c, o), scheduled, schedule: s.schedule };
}

const taskNoun: Rule = (c, { node }) => {
	const t = taskParts(c, node);
	if (!t) return null;
	return D(t.scheduled ? c.say.task.nounScheduled(t) : c.say.task.noun(t), t.lines);
};

export function queueParts(c: Ctx, node: N): { name: string; limit: string | null } | null {
	const u = unwrap(node);
	if (u?.type !== "CallExpression" || importedAs(c, u.callee) !== "queue") return null;
	const o = objectArg(u.arguments[0]);
	if (!o) return null;
	const limit = propOf(o, "concurrencyLimit");
	return { name: c.e.text(propOf(o, "name")), limit: limit ? c.e.text(limit) : null };
}

const queueNoun: Rule = (c, { node }) => {
	const q = queueParts(c, node);
	return q ? D(c.say.queue.noun(q)) : null;
};

const configure: Rule = (c, { node, args }) => {
	if (importedAs(c, node.callee) !== "configure") return null;
	const o = objectArg(args[0]);
	return D(c.say.configure({ details: details(c, o ? o.properties.map((p: N) => genericOption(c, p)) : args.map((a) => c.e.text(a))) }));
};

/** `defineConfig({ project, runtime, maxDuration, retries, dirs, … })` in trigger.config.ts. */
const defineConfig: Rule = (c, { node, args }) => {
	if (importedAs(c, node.callee) !== "defineConfig") return null;
	const { e, say } = c;
	const o = objectArg(args[0]);
	if (!o || !propOf(o, "project")) return null;
	const items: string[] = [];
	const kids: Doc[] = [];
	for (const p of o.properties) {
		const k = keyOf(p);
		const v = p.value;
		if (k === "project") continue;
		if (k === "runtime") items.push(say.runtime({ runtime: e.text(v) }));
		else if (k === "maxDuration") items.push(say.config.maxDuration({ duration: secs(c, v) }));
		else if (k === "machine") items.push(machineText(c, v));
		else if (k === "dirs") items.push(say.dirs({ dirs: e.text(v) }));
		else if (k === "retries" && propOf(objectArg(v), "default"))
			items.push(say.defaultRetry({ retry: retryItems(c, propOf(objectArg(v), "default")).join(", ") }));
		else kids.push(e.objectProp(p));
	}
	return D(
		say.project({ project: e.text(propOf(o, "project")), details: details(c, items) }),
		kids.flatMap((k) => e.bullet(k)),
	);
};

export function taskCalls(): Record<string, Rule> {
	return { task: taskNoun, schemaTask: taskNoun, toolTask: taskNoun, "*.task": taskNoun, queue: queueNoun, configure, defineConfig };
}
