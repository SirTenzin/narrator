import { plain } from "@usenarrator/core";
import type { CronDays, InngestPhrases, TimePhrases } from "./phrases";

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
	inMs: ({ value }) => `${value} ms`,
	inSeconds: ({ value }) => `${value} seconds`,
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

const step = (id: string) => ` (step ${id})`;

export const en: InngestPhrases = {
	time: timeEn,
	details: ({ items }) => items.join("; "),
	option: ({ name, value }) => `${name}: ${value}`,
	client: {
		create: ({ id, as }) => `set up the Inngest client for the app ${id} as ${as}`,
		noun: ({ id }) => `the Inngest client for the app ${id}`,
	},
	fn: {
		define: ({ id, as, triggers, details }) => `define the Inngest function ${id}${as ? ` as ${as}` : ""}, run ${triggers}${paren(details)}`,
		noun: ({ id, triggers, details }) => `the Inngest function ${id}, run ${triggers}${paren(details)}`,
		handler: ({ handler }) => `run ${handler}`,
		displayName: ({ name }) => `shown as ${name}`,
		onFailure: "if a run still fails after its last retry",
		onFailureWith: ({ handler }) => `if a run still fails after its last retry, run ${handler}`,
	},
	triggers: {
		any: ({ triggers }) => list(triggers, "or"),
		event: ({ event, condition }) => `whenever ${event} is sent${condition ? ` and ${condition} holds` : ""}`,
		cron: ({ schedule }) => schedule,
		none: "only when invoked directly",
		invoked: "when another function invokes it",
		other: ({ value }) => `on ${value}`,
	},
	config: {
		concurrency: ({ n, key, scope }) =>
			`at most ${n} ${plain(n) === "1" ? "run" : "runs"} at a time${key ? ` per ${key}` : ""}${scope === "env" ? " across the environment" : scope === "account" ? " across the account" : ""}`,
		throttle: ({ limit, period, key, burst }) =>
			`starting at most ${limit} ${plain(limit) === "1" ? "run" : "runs"} per ${period}${key ? ` per ${key}` : ""}${burst ? ` (bursts of ${burst})` : ""}, queueing the rest`,
		rateLimit: ({ limit, period, key }) => `ignoring events beyond ${limit} per ${period}${key ? ` per ${key}` : ""}`,
		debounce: ({ period, key, timeout }) =>
			`waiting for ${period} without new events${key ? ` per ${key}` : ""}${timeout ? ` (at most ${timeout})` : ""}, then running once with the latest`,
		retries: ({ n, count }) => (count === 0 ? "never retried" : `retried up to ${n} ${count === 1 ? "time" : "times"}`),
		cancelOn: ({ event, match, condition, timeout }) =>
			`cancelled if ${event} arrives${match ? ` with the same ${match}` : ""}${condition ? ` where ${condition}` : ""}${timeout ? ` within ${timeout}` : ""}`,
		priority: ({ expr }) => `prioritized by ${expr}`,
		batch: ({ size, timeout, key }) =>
			`taking events in batches of up to ${size}${key ? ` per ${key}` : ""}${timeout ? `, waiting at most ${timeout} to fill one` : ""}`,
		idempotency: ({ key }) => `running once per ${key} in any 24 hours`,
		singleton: ({ key, mode }) =>
			`one run at a time${key ? ` per ${key}` : ""}, ${mode === "cancel" ? "a new event cancelling the running one" : "skipping new events while one runs"}`,
		startTimeout: ({ duration }) => `cancelled if not started within ${duration}`,
		finishTimeout: ({ duration }) => `cancelled if not finished within ${duration}`,
	},
	steps: {
		run: ({ id, action }) => `step ${id}${action ? `: ${action}` : ""}`,
		sleep: ({ duration, id }) => `wait ${duration}${step(id)}`,
		sleepUntil: ({ time, id }) => `wait until ${time}${step(id)}`,
		waitForEvent: ({ event, match, condition, timeout, id, as }) =>
			`wait for ${event}${match ? ` matching ${match}` : ""}${condition ? ` where ${condition}` : ""}${timeout ? `, up to ${timeout}` : ""}${step(id)}${
				as ? `, and call it ${as} (nothing if it never arrives)` : ""
			}`,
		waitForSignal: ({ signal, timeout, id, as }) =>
			`wait for the signal ${signal}${timeout ? `, up to ${timeout}` : ""}${step(id)}${as ? `, and call it ${as} (nothing if it never arrives)` : ""}`,
		sendEvent: ({ events, id }) => `send ${events}${step(id)}`,
		invoke: ({ fn, data, timeout, id }) =>
			`run the Inngest function ${fn}${data ? ` with ${data}` : ""} and wait for its result${timeout ? `, up to ${timeout}` : ""}${step(id)}`,
		fetch: ({ url }) => `fetch ${url} as a durable step`,
		aiInfer: ({ model, id }) => `ask ${model}${step(id)}`,
		aiWrap: ({ fn, args, id }) => `call ${fn}${args ? ` with ${args}` : ""}${step(id)}`,
	},
	events: {
		one: ({ name, data }) => `the event ${name}${data ? ` with ${data}` : ""}`,
		data: ({ data, bare }) => (bare ? data : `the data ${data}`),
		several: "these events",
		send: ({ events }) => `send ${events} to Inngest`,
		type: ({ name, schema }) => `the event type ${name}${schema ? `, with data checked against ${schema}` : ""}`,
	},
	serve: ({ functions, listed, client, framework, handlers }) =>
		`serve the Inngest functions ${listed ? "" : "in "}${functions}${client ? ` of ${client}` : ""} over HTTP${framework ? ` (${framework})` : ""}${handlers ? `, exported as the ${handlers} handlers` : ""}`,
	errorLabels: {
		NonRetriableError: "a non-retriable error (the run fails without retrying)",
		RetryAfterError: "a retry-later error (Inngest retries after the given time)",
		StepError: "a step error",
	},
};
