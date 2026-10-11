import { plain } from "@usenarrator/core";
import type { CronDays, MessageKind, TemporalPhrases, TimePhrases } from "./phrases";

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

const KIND: Record<MessageKind, string> = { signal: "signal", query: "query", update: "update" };
const withArgs = (args: string | null) => (args ? ` with ${args}` : "");

export const en: TemporalPhrases = {
	time: timeEn,
	details: ({ items }) => items.join("; "),
	option: ({ name, value }) => `${name}: ${value}`,
	activities: {
		proxy: ({ names, as, local, details }) => `set up the ${local ? "local " : ""}activities ${names ?? `as ${as}`}${paren(details)}`,
		startToClose: ({ duration }) => `each attempt may take up to ${duration}`,
		scheduleToClose: ({ duration }) => `giving up ${duration} after it is scheduled, retries included`,
		scheduleToStart: ({ duration }) => `failing if no worker picks it up within ${duration}`,
		heartbeat: ({ duration }) => `an attempt fails if it sends no heartbeat for ${duration}`,
		taskQueue: ({ queue }) => `on the task queue ${queue}`,
		call: ({ activity, args }) => `run the activity ${activity}${withArgs(args)}`,
		heartbeatNow: ({ details }) => `send a heartbeat${details ? ` with ${details}` : ""} so Temporal knows this activity is still alive`,
		info: "this activity's info",
		sleep: ({ duration }) => `pause for ${duration}, stopping early if the activity is cancelled`,
		cancelled: "a promise that fails when this activity is cancelled",
	},
	retry: {
		attempts: ({ n, count }) => (count === 1 ? "tried once, with no retries" : `up to ${n} attempts`),
		unlimited: "retried until it succeeds",
		backoff: ({ initial, factor, max }) =>
			`waiting ${initial ?? "1 second"} before the first retry${factor ? `, growing ${factor}× each time` : ""}${max ? ` up to ${max}` : ""}`,
		nonRetryable: ({ types }) => `never retrying ${types} errors`,
	},
	workflow: {
		sleep: ({ duration }) => `wait ${duration}`,
		waitUntil: ({ condition, timeout }) => `wait until ${condition}${timeout ? `, for at most ${timeout}` : ""}`,
		cameTrue: ({ condition, timeout, neg }) => (neg ? `the wait for ${condition} timed out after ${timeout}` : `${condition} within ${timeout}`),
		continueAsNew: ({ args }) => `start this workflow over as a fresh run${withArgs(args)} (continue-as-new: same workflow ID, new history)`,
		info: "this workflow run's info",
		uuid: "a random UUID that stays the same on replay",
		patched: ({ id, neg }) => `this workflow run ${neg ? "started before" : "started after"} the change ${id} was deployed`,
		deprecatePatch: ({ id }) => `mark the change ${id} as deployed everywhere`,
		isCancellation: ({ error, neg }) => `${error} ${neg ? "is not" : "is"} a cancellation`,
		cancellable: "in a scope that can be cancelled",
		nonCancellable: "without letting cancellation interrupt it",
		withTimeout: ({ duration }) => `within ${duration}, cancelling whatever is still running after that`,
		external: ({ id }) => `the running workflow ${id}`,
	},
	messages: {
		define: ({ kind, name, as, types }) =>
			`define the ${KIND[kind]} ${name} as ${as}${types ? ` (${kind === "query" ? "answered with" : "carrying"} ${types})` : ""}`,
		noun: ({ kind, name }) => `the ${KIND[kind]} ${name}`,
		handle: ({ kind, message, action }) =>
			`${kind === "query" ? `when asked ${message}` : kind === "update" ? `when ${message} is requested` : `when ${message} arrives`}${action ? `, ${action}` : ""}`,
		handleWith: ({ kind, message, handler }) =>
			`${kind === "query" ? `answer ${message}` : kind === "update" ? `handle ${message}` : `handle ${message}`} with ${handler}`,
		answer: ({ message, value }) => `when asked ${message}, answer with ${value}`,
		unset: ({ message }) => `stop handling ${message}`,
	},
	child: {
		execute: ({ workflow, args, details }) => `run the child workflow ${workflow}${withArgs(args)} and wait for its result${paren(details)}`,
		start: ({ workflow, args, details }) => `start the child workflow ${workflow}${withArgs(args)}, without waiting for it${paren(details)}`,
		parentClosePolicy: ({ policy }) => `if this workflow closes first: ${policy}`,
	},
	failure: {
		nonRetryable: ({ message, type }) => `a non-retryable failure${type ? ` of type ${type}` : ""}${message ? `: ${message}` : ""}`,
		retryable: ({ message, type }) => `a retryable failure${type ? ` of type ${type}` : ""}${message ? `: ${message}` : ""}`,
		create: ({ message, type, nonRetryable }) =>
			`${nonRetryable ? "a non-retryable" : "an application"} failure${type ? ` of type ${type}` : ""}${message ? `: ${message}` : ""}`,
	},
	worker: {
		create: ({ as, queue, details }) => `set up a Temporal worker${as ? ` as ${as}` : ""} for the task queue ${queue}${paren(details)}`,
		workflowsFrom: ({ path }) => `workflows from ${path}`,
		activities: ({ activities }) => `activities: ${activities}`,
		namespace: ({ namespace }) => `namespace ${namespace}`,
		maxActivities: ({ n }) => `at most ${n} activities at a time`,
		maxWorkflows: ({ n }) => `at most ${n} workflow tasks at a time`,
		run: ({ worker }) => `run ${worker}, taking work from its task queue until it shuts down`,
		runUntil: ({ worker, until }) => `run ${worker} until ${until} finishes`,
		shutdown: ({ worker }) => `shut down ${worker} once its current work finishes`,
	},
	connection: ({ address, details }) => `a connection to the Temporal server${address ? ` at ${address}` : ""}${paren(details)}`,
	client: ({ as, details }) => (as ? `set up a Temporal client as ${as}${paren(details)}` : `a Temporal client${paren(details)}`),
	start: {
		start: ({ workflow, args, details }) => `start the workflow ${workflow}${withArgs(args)}, without waiting for it to finish${paren(details)}`,
		execute: ({ workflow, args, details }) => `run the workflow ${workflow}${withArgs(args)} and wait for its result${paren(details)}`,
		signalWithStart: ({ workflow, signal, args, details }) =>
			`send ${signal}${withArgs(args)} to the workflow, starting ${workflow} first if it isn't running${paren(details)}`,
		taskQueue: ({ queue }) => `task queue ${queue}`,
		workflowId: ({ id }) => `workflow ID ${id}`,
		cron: ({ schedule }) => `repeating ${schedule}`,
		startDelay: ({ duration }) => `starting after ${duration}`,
		executionTimeout: ({ duration }) => `stopped if not finished within ${duration}, retries and continue-as-new included`,
		runTimeout: ({ duration }) => `each run stopped after ${duration}`,
		reusePolicy: ({ policy }) => `reusing a closed workflow's ID: ${policy}`,
		conflictPolicy: ({ policy }) => `if a workflow with this ID is already running: ${policy}`,
		getHandle: ({ id }) => `the workflow ${id}`,
		list: ({ query }) => `the workflows${query ? ` matching ${query}` : ""}`,
	},
	handle: {
		signal: ({ message, workflow, args }) => `send ${message}${withArgs(args)} to ${workflow}`,
		query: ({ message, workflow, args }) => `the answer ${workflow} gives to ${message}${withArgs(args)}`,
		executeUpdate: ({ message, workflow, args }) => `send ${message}${withArgs(args)} to ${workflow} and wait for its result`,
		startUpdate: ({ message, workflow, args }) => `send ${message}${withArgs(args)} to ${workflow}, without waiting for its result`,
		result: ({ workflow }) => `${workflow}'s result once the workflow finishes`,
		cancel: ({ workflow }) => `ask ${workflow} to cancel`,
		terminate: ({ workflow, reason }) => `stop ${workflow} immediately${reason ? ` because ${reason}` : ""}`,
		describe: ({ workflow }) => `the current status of ${workflow}`,
	},
	schedule: {
		create: ({ id, action, when, details }) => `create the schedule ${id} to ${action} ${when}${paren(details)}`,
		startWorkflow: ({ workflow, args, queue }) => `start the workflow ${workflow}${withArgs(args)}${queue ? ` on the task queue ${queue}` : ""}`,
		every: ({ duration }) => `every ${duration}`,
		overlap: ({ policy }) => `when runs overlap: ${policy}`,
		paused: "created paused",
		getHandle: ({ id }) => `the schedule ${id}`,
	},
	errorLabels: {
		ApplicationFailure: "an application failure",
		CancelledFailure: "a cancellation",
	},
};
