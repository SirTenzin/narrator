import { plain } from "@usenarrator/core";
import type { CronDays, TimePhrases, TriggerPhrases } from "./phrases";

const paren = (details: string | null) => (details ? ` (${details})` : "");
const list = (xs: string[], conj = "and") =>
	xs.length <= 1 ? (xs[0] ?? "") : xs.length === 2 ? `${xs[0]} ${conj} ${xs[1]}` : `${xs.slice(0, -1).join(", ")}, ${conj} ${xs.at(-1)}`;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const UNITS = {
	millisecond: ["millisecond", "milliseconds"],
	second: ["second", "seconds"],
	minute: ["minute", "minutes"],
	hour: ["hour", "hours"],
	day: ["day", "days"],
	week: ["week", "weeks"],
	month: ["month", "months"],
	year: ["year", "years"],
} as const;

const isWeekdays = (d: number[]) => d.join() === "1,2,3,4,5";
const isWeekend = (d: number[]) => d.join() === "0,6";
const months = (m: number[]) => list(m.map((x) => MONTH_NAMES[x - 1]!));

/** "every Monday" / "on day 1 of every month": days leading a time of day. */
function leadDays(d: CronDays): string {
	switch (d.kind) {
		case "everyDay":
			return "every day";
		case "weekdays":
			if (isWeekdays(d.days)) return "every weekday";
			if (isWeekend(d.days)) return "every Saturday and Sunday";
			return `every ${list(d.days.map((x) => DAY_NAMES[x]!))}`;
		case "months":
			return `every ${d.weekdays ? list(d.weekdays.map((x) => DAY_NAMES[x]!)) : "day"} in ${months(d.months)}`;
		case "monthDays": {
			const also = d.weekdays ? ` and every ${list(d.weekdays.map((x) => DAY_NAMES[x]!))}` : "";
			if (d.months?.length === 1 && d.days.length === 1) return `on ${MONTH_NAMES[d.months[0]! - 1]} ${d.days[0]}${also}`;
			const day = `${d.days.length === 1 ? "day" : "days"} ${list(d.days.map(String))}`;
			return `on ${day} of ${d.months ? months(d.months) : "every month"}${also}`;
		}
	}
}

/** "on Mondays" / "on weekdays": days trailing a frequency. */
function trailDays(d: CronDays): string {
	switch (d.kind) {
		case "everyDay":
			return "";
		case "weekdays":
			if (isWeekdays(d.days)) return " on weekdays";
			return ` on ${list(d.days.map((x) => `${DAY_NAMES[x]}s`))}`;
		default:
			return ` ${leadDays(d)}`;
	}
}

export const timeEn: TimePhrases = {
	amount: ({ n, count, unit }) => `${n} ${UNITS[unit][count === 1 ? 0 : 1]}`,
	unit: ({ unit }) => UNITS[unit][0],
	inMs: ({ value }) => (/(ms|millis(econds)?)$/i.test(plain(value)) ? value : `${value} ms`),
	inSeconds: ({ value }) => (/(seconds?|secs?)$/i.test(plain(value)) ? value : `${value} seconds`),
	cron: {
		everySecond: "every second",
		everySeconds: ({ n }) => `every ${n} seconds`,
		everyMinute: "every minute",
		everyMinutes: ({ n }) => `every ${n} minutes`,
		hourly: ({ minutes, onTheHour }) => (onTheHour ? "every hour, on the hour" : `every hour at minute ${minutes}`),
		everyHours: ({ n, minutes, onTheHour }) => (onTheHour ? `every ${n} hours, on the hour` : `every ${n} hours at minute ${minutes}`),
		repeating: ({ every, between, days }) => `${every}${between ? ` from ${between.from} to ${between.to}` : ""}${trailDays(days)}`,
		at: ({ times, days }) => `${leadDays(days)} at ${times}`,
		schedule: ({ words, zone, expr }) => `${words}${zone ? (/^(Etc\/)?UTC$/.test(plain(zone)) ? " UTC" : ` ${zone} time`) : ""} (cron ${expr})`,
		raw: ({ expr, zone }) => `on the cron schedule ${expr}${zone ? ` in ${zone} time` : ""}`,
		from: ({ value }) => `on the cron schedule in ${value}`,
	},
};

const withPayload = (payload: string | null) => (payload ? ` with ${payload}` : "");

export const en: TriggerPhrases = {
	time: timeEn,
	details: ({ items }) => items.join("; "),
	option: ({ name, value }) => `${name}: ${value}`,
	task: {
		define: ({ id, as, details }) => `define the Trigger.dev task ${id}${as ? ` as ${as}` : ""}${paren(details)}`,
		noun: ({ id, details }) => `the Trigger.dev task ${id}${paren(details)}`,
		defineScheduled: ({ id, as, schedule, details }) =>
			`define the scheduled task ${id}${as ? ` as ${as}` : ""}, run ${schedule ?? "on the schedules attached to it"}${paren(details)}`,
		nounScheduled: ({ id, schedule, details }) => `the scheduled task ${id}, run ${schedule ?? "on the schedules attached to it"}${paren(details)}`,
		runs: ({ handler }) => `run ${handler}`,
		hooks: {
			init: "before each attempt, set up",
			middleware: "around each attempt",
			onStart: "when the run starts",
			onStartAttempt: "before each attempt",
			onSuccess: "when the run succeeds",
			onFailure: "when the run fails after its last attempt",
			onComplete: "when the run finishes, whether it succeeded or failed",
			onCancel: "when the run is cancelled",
			onWait: "when the run pauses to wait",
			onResume: "when the run resumes after waiting",
			catchError: "whenever an attempt throws",
			handleError: "whenever an attempt throws",
			cleanup: "after each attempt",
		},
		hookWith: ({ hook, handler }) => `${hook}, run ${handler}`,
		schema: ({ schema }) => `payload checked against ${schema}`,
		description: ({ text }) => `described as ${text}`,
		environments: ({ list }) => `only in ${list}`,
	},
	config: {
		queue: ({ queue }) => `on the queue ${queue}`,
		inlineQueue: ({ name, limit }) => (name ? `on the queue ${name}${limit ? `, at most ${limit} at a time` : ""}` : `at most ${limit} runs at a time`),
		machine: ({ machine }) => `on a ${machine} machine`,
		maxDuration: ({ duration }) => `stopped after ${duration}`,
		ttl: ({ duration }) => `cancelled if not started within ${duration}`,
		attempts: ({ n, count }) => (count === 1 ? "tried once, with no retries" : `up to ${n} attempts`),
		backoff: ({ min, max, factor, randomize }) =>
			`waiting ${min && max ? `${min} to ${max}` : (min ?? `up to ${max}`)} between attempts${factor ? `, growing ${factor}× each time` : ""}${randomize ? ", with jitter" : ""}`,
		outOfMemory: ({ machine }) => `retried on a ${machine} machine if it runs out of memory`,
		retryPolicy: ({ policy }) => `retries: ${policy}`,
	},
	queue: {
		define: ({ name, as, limit }) => `define the queue ${name}${as ? ` as ${as}` : ""}${limit ? `, running at most ${limit} at a time` : ""}`,
		noun: ({ name, limit }) => `the queue ${name}${limit ? ` (at most ${limit} at a time)` : ""}`,
	},
	trigger: {
		start: ({ task, payload }) => `queue a background run of ${task}${withPayload(payload)}`,
		startAndWait: ({ task, payload, unwrap }) =>
			`start ${task} and wait for ${unwrap ? "its output (failing if the run failed)" : "it to finish"}${payload ? `, passing ${payload}` : ""}`,
		batch: ({ task, each }) => `queue background runs${task ? ` of ${task}` : ""}${each ? ` for each item in ${each}` : ""}`,
		batchAndWait: ({ task, each }) => `start${task ? ` ${task}` : " runs"}${each ? ` for each item in ${each}` : ""} and wait for every run to finish`,
		startAndPoll: ({ task, payload }) => `start ${task} and poll until it finishes${payload ? `, passing ${payload}` : ""}`,
		taskId: ({ id }) => `the task ${id}`,
		payload: ({ payload, bare }) => (bare ? payload : `the payload ${payload}`),
		item: ({ task, payload, details }) => `${task ? `${task}${payload ? ` with ${payload}` : ""}` : (payload ?? "")}${paren(details)}`,
		delay: ({ duration }) => `starting after ${duration}`,
		delayUntil: ({ time }) => `starting at ${time}`,
		idempotencyKey: ({ key, ttl }) => `at most once per idempotency key ${key}${ttl ? ` within ${ttl}` : ""}`,
		concurrencyKey: ({ key }) => `with its queue's concurrency counted separately per ${key}`,
		tags: ({ tags }) => `tagged ${tags}`,
		priority: ({ duration }) => `queued as if it arrived ${duration} earlier`,
		metadata: ({ value }) => `with the metadata ${value}`,
		region: ({ region }) => `in the region ${region}`,
		version: ({ version }) => `on version ${version}`,
	},
	wait: {
		for: ({ duration, details }) => `wait ${duration}${paren(details)}`,
		until: ({ time, details }) => `wait until ${time}${paren(details)}`,
		createToken: ({ timeout, details }) => `a new wait token${timeout ? ` that times out after ${timeout}` : ""}${paren(details)}`,
		forToken: ({ token, unwrap }) =>
			`wait until ${/token$/i.test(plain(token)) ? token : `the token ${token}`} is completed${unwrap ? ", taking its data (failing if it timed out)" : ""}`,
		completeToken: ({ token, data }) => `complete ${/token$/i.test(plain(token)) ? token : `the wait token ${token}`}${data ? ` with ${data}` : ""}`,
		idempotencyKey: ({ key }) => `skipped if already done for the key ${key}`,
	},
	metadata: {
		owner: { current: "the run's", parent: "the parent run's", root: "the root run's" },
		set: ({ owner, key, value }) => `set ${owner} ${key} metadata to ${value}`,
		increment: ({ owner, key, by }) => `add ${by} to ${owner} ${key} metadata`,
		decrement: ({ owner, key, by }) => `subtract ${by} from ${owner} ${key} metadata`,
		append: ({ owner, key, value }) => `append ${value} to ${owner} ${key} metadata`,
		remove: ({ owner, key, value }) => `remove ${value} from ${owner} ${key} metadata`,
		del: ({ owner, key }) => `delete ${owner} ${key} metadata`,
		replace: ({ owner, value }) => `replace ${owner} metadata with ${value}`,
		get: ({ owner, key }) => `${owner} ${key} metadata`,
		current: ({ owner }) => `${owner} metadata`,
		flush: ({ owner }) => `save ${owner} metadata now`,
		stream: ({ owner, key, value }) => `stream ${value} into ${owner} ${key} metadata`,
	},
	idempotencyKey: ({ key, scope }) =>
		`an idempotency key from ${key}${
			scope === "global" ? " (shared by every run)" : scope === "attempt" ? " (unique to this attempt)" : scope === "run" ? " (unique to this parent run)" : ""
		}`,
	runs: {
		retrieve: ({ id }) => `the run ${id}, fetched from Trigger.dev`,
		cancel: ({ id }) => `cancel the run ${id}`,
		replay: ({ id }) => `replay the run ${id}`,
		reschedule: ({ id, delay }) => `reschedule the delayed run ${id} to start after ${delay}`,
		list: ({ filter }) => `the runs${filter ? ` matching ${filter}` : ""}`,
		subscribe: ({ id }) => `live updates of the run ${id}`,
		poll: ({ id }) => `the run ${id} once it finishes`,
	},
	schedules: {
		create: ({ task, schedule, details }) => `attach a schedule to ${task} that runs it ${schedule}${paren(details)}`,
		externalId: ({ id }) => `for ${id}`,
		deduplicationKey: ({ key }) => `not created twice for the key ${key}`,
		del: ({ id }) => `delete the schedule ${id}`,
		activate: ({ id }) => `turn the schedule ${id} back on`,
		deactivate: ({ id }) => `pause the schedule ${id}`,
		update: ({ id, schedule, details }) => `change the schedule ${id}${schedule ? ` to run ${schedule}` : ""}${paren(details)}`,
		retrieve: ({ id }) => `the schedule ${id}`,
		list: "the schedules",
	},
	retry: {
		onThrow: ({ attempts }) => `try${attempts ? ` up to ${attempts} times` : ""}, retrying whenever this throws`,
		fetch: ({ url }) => `fetch ${url}, retrying when it fails`,
	},
	configure: ({ details }) => `configure the Trigger.dev SDK${paren(details)}`,
	project: ({ project, details }) => `the Trigger.dev config for the project ${project}${paren(details)}`,
	runtime: ({ runtime }) => `running on ${runtime}`,
	dirs: ({ dirs }) => `tasks in ${dirs}`,
	defaultRetry: ({ retry }) => `every task by default: ${retry}`,
	errorLabels: {
		AbortTaskRunError: "an error that stops the run without retrying",
	},
};
