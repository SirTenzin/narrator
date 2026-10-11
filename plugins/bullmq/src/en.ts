import { plain } from "@usenarrator/core";
import type { BullmqPhrases, CronDays, TimePhrases } from "./phrases";

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

const keepFor =
	(state: string) =>
	({ age, count }: { age: string; count: string | null }) =>
		`keeping ${state} jobs for ${age}${count ? ` (at most the last ${count})` : ""}`;

export const en: BullmqPhrases = {
	time: timeEn,
	details: ({ items }) => items.join(", "),
	option: ({ name, value }) => `${name}: ${value}`,
	queue: {
		named: ({ name }) => `the ${name} queue`,
		noun: ({ name, details }) => `the job queue ${name}${paren(details)}`,
		create: ({ name, as, details }) => `set up the job queue ${name} as ${as}${paren(details)}`,
		connection: ({ value }) => `connection: ${value}`,
		prefix: ({ value }) => `key prefix ${value}`,
		defaults: ({ options }) => `every job by default: ${options}`,
		defaultsHead: "every job by default",
		add: ({ job, queue, data }) => `add ${job} to ${queue}${data ? ` with ${data}` : ""}`,
		addBulk: ({ queue }) => `add these jobs to ${queue}`,
		job: ({ name }) => `${/^\W*[aeiou]/i.test(plain(name)) ? "an" : "a"} ${name} job`,
		jobNamed: ({ name }) => `a job named ${name}`,
		data: ({ data, bare }) => (bare ? data : `the data ${data}`),
		get: ({ id, queue }) => `the job ${id} in ${queue}`,
		list: ({ states, queue }) => `the ${states ? `${states} ` : ""}jobs in ${queue}`,
		count: ({ states, queue }) => `the number of ${states ? `${states} ` : ""}jobs in ${queue}`,
		countsByState: ({ queue }) => `the number of jobs in ${queue}, by state`,
		pending: ({ queue }) => `the number of waiting or delayed jobs in ${queue}`,
		drain: ({ queue, delayed }) => `remove every waiting ${delayed ? "and delayed " : ""}job from ${queue}`,
		obliterate: ({ queue, force }) => `delete ${queue} and all of its jobs${force ? ", even ones still running" : ""}`,
		clean: ({ queue, state, age, limit }) => `remove ${state} jobs older than ${age} from ${queue}${limit ? ` (at most ${limit})` : ""}`,
		pause: ({ queue }) => `pause ${queue}, so workers start no new jobs until it resumes`,
		resume: ({ queue }) => `resume ${queue}, so workers pick up jobs again`,
		remove: ({ queue, id }) => `remove the job ${id} from ${queue}`,
		retryJobs: ({ queue, state }) => `retry the ${state} jobs in ${queue}`,
		promoteJobs: ({ queue }) => `run the delayed jobs in ${queue} now`,
		globalConcurrency: ({ queue, n }) => `allow at most ${n} jobs from ${queue} to run at once across all workers`,
		globalRateLimit: ({ queue, max, duration }) => `allow at most ${max} jobs from ${queue} per ${duration} across all workers`,
		states: {
			completed: "completed",
			failed: "failed",
			delayed: "delayed",
			active: "running",
			wait: "waiting",
			waiting: "waiting",
			paused: "paused",
			prioritized: "prioritized",
			"waiting-children": "child-waiting",
			repeat: "repeating",
		},
	},
	options: {
		delay: ({ duration }) => `starting after ${duration}`,
		attempts: ({ n, count }) => (count === 1 ? "tried once, with no retries" : `up to ${n} attempts`),
		backoffFixed: ({ delay }) => `waiting ${delay} between attempts`,
		backoffExponential: ({ delay }) => `waiting ${delay} before the first retry and doubling the wait each time`,
		backoffCustom: ({ type }) => `retry waits from the ${type} backoff strategy`,
		repeat: ({ schedule }) => `repeating ${schedule}`,
		jobId: ({ id }) => `with the job ID ${id} (not added again while a job with that ID exists)`,
		priority: ({ n }) => `priority ${n} (lower numbers run first)`,
		lifo: "ahead of jobs already waiting",
		removeOnComplete: "deleted once it completes",
		removeOnFail: "deleted if it fails",
		keepOnComplete: "kept after it completes",
		keepOnFail: "kept if it fails",
		keepLastCompleted: ({ n }) => `keeping only the last ${n} completed jobs`,
		keepLastFailed: ({ n }) => `keeping only the last ${n} failed jobs`,
		keepCompletedFor: keepFor("completed"),
		keepFailedFor: keepFor("failed"),
		deduplicate: ({ id, ttl, mode }) =>
			`skipped while another job with the deduplication ID ${id} is ${ttl ? `less than ${ttl} old` : "still pending"}${
				mode === "extend" ? " (each duplicate restarts that window)" : mode === "replace" ? " (a duplicate replaces the pending job's data)" : ""
			}`,
		parent: ({ id, queue }) => `as a child of the job ${id}${queue ? ` in ${queue}` : ""}`,
		failParentOnFailure: "failing its parent if it fails",
		ignoreDependencyOnFailure: "letting its parent go ahead if it fails",
		removeDependencyOnFailure: "dropped from its parent's dependencies if it fails",
		continueParentOnFailure: "starting its parent right away if it fails",
	},
	schedule: {
		every: ({ duration }) => `every ${duration}`,
		limit: ({ n }) => `at most ${n} times`,
		startDate: ({ date }) => `from ${date}`,
		endDate: ({ date }) => `until ${date}`,
		immediately: "starting right away",
		upsert: ({ job, queue, schedule, id, data }) => `schedule ${job} on ${queue} ${schedule}${data ? ` with ${data}` : ""} (job scheduler ${id})`,
		remove: ({ id, queue }) => `stop the job scheduler ${id} on ${queue}`,
		get: ({ id, queue }) => `the job scheduler ${id} on ${queue}`,
		list: ({ queue }) => `the job schedulers on ${queue}`,
		removeRepeatable: ({ job, queue, schedule }) => `stop repeating ${job} on ${queue} ${schedule}`,
		removeRepeatableByKey: ({ key, queue }) => `stop the repeating job ${key} on ${queue}`,
	},
	worker: {
		create: ({ as, queue, processor, details }) =>
			`start a worker${as ? ` as ${as}` : ""} that handles each job from ${queue}${processor ? ` with ${processor}` : ""}${paren(details)}`,
		noun: ({ queue, processor, details }) => `a worker for ${queue}${processor ? ` running ${processor}` : ""}${paren(details)}`,
		sandboxed: ({ file }) => `the processor file ${file} in a separate process`,
		concurrency: ({ n }) => `up to ${n} ${plain(n) === "1" ? "job" : "jobs"} at a time`,
		limiter: ({ max, duration }) => `at most ${max} ${plain(max) === "1" ? "job" : "jobs"} per ${duration}`,
		limiterPerGroup: ({ max, duration, key }) => `at most ${max} ${plain(max) === "1" ? "job" : "jobs"} per ${duration} for each ${key}`,
		manualStart: "not started until it is run",
		lockDuration: ({ duration }) => `holding each job's lock for ${duration}`,
		stalledInterval: ({ duration }) => `checking for stalled jobs every ${duration}`,
		maxStalledCount: ({ n }) => `failing a job that stalls more than ${n} times`,
		workerThreads: "in worker threads",
		run: ({ worker }) => `start ${worker} processing jobs`,
		close: ({ worker, force }) => (force ? `close ${worker} right away, without waiting for running jobs` : `close ${worker} once its running jobs finish`),
		pause: ({ worker }) => `pause ${worker}, so it starts no new jobs`,
		resume: ({ worker }) => `resume ${worker}`,
		rateLimit: ({ worker, duration }) => `stop ${worker} taking new jobs for ${duration}`,
		rateLimitError: "a rate-limit signal (the job goes back to waiting)",
	},
	events: {
		on: ({ event, source, once, handler }) => `${once ? "the first time" : "whenever"} ${event} on ${source}${handler ? `, run ${handler}` : ""}`,
		off: ({ event, source }) => `stop listening for when ${event} on ${source}`,
		names: {
			completed: "a job completes",
			failed: "a job fails",
			progress: "a job reports progress",
			active: "a job starts",
			stalled: "a job stalls",
			error: "an error happens",
			drained: "there are no more waiting jobs",
			waiting: "a job starts waiting",
			delayed: "a job is delayed",
			added: "a job is added",
			removed: "a job is removed",
			paused: "processing pauses",
			resumed: "processing resumes",
			closed: "it closes",
			closing: "it starts closing",
			ready: "it is ready",
			cleaned: "old jobs are cleaned",
			deduplicated: "a duplicate job is skipped",
			debounced: "a duplicate job is skipped",
			duplicated: "a job with an existing ID is skipped",
			"retries-exhausted": "a job runs out of attempts",
			"waiting-children": "a job starts waiting for its child jobs",
		},
		listen: ({ queue, as }) => `listen to the events of ${queue}${as ? ` as ${as}` : ""}`,
	},
	job: {
		progressPercent: ({ job, n }) => `report ${job} as ${n}% done`,
		progress: ({ job, value }) => `report ${job}'s progress as ${value}`,
		log: ({ job, row }) => `add ${row} to ${job}'s log`,
		fail: ({ job, error }) => `mark ${job} as failed with ${error}`,
		complete: ({ job, value }) => `mark ${job} as completed${value ? ` with the result ${value}` : ""}`,
		delay: ({ job, until }) => `put ${job} back to wait until ${until}`,
		wait: ({ job }) => `put ${job} back in the waiting list`,
		waitChildren: ({ job }) => `whether ${job} has to wait for its child jobs`,
		retry: ({ job }) => `retry ${job}`,
		promote: ({ job }) => `run the delayed ${job} now`,
		remove: ({ job }) => `remove ${job} from its queue`,
		updateData: ({ job, data }) => `replace ${job}'s data with ${data}`,
		changeDelay: ({ job, duration }) => `change ${job}'s delay to ${duration}`,
		changePriority: ({ job, n }) => `change ${job}'s priority to ${n}`,
		result: ({ job, events, timeout }) => `${job}'s result once it finishes (watched through ${events}${timeout ? `, for at most ${timeout}` : ""})`,
		childResults: ({ job }) => `the results of ${job}'s child jobs`,
		state: ({ job }) => `${job}'s current state`,
		discard: ({ job }) => `stop retrying ${job}`,
		extendLock: ({ job, duration }) => `keep ${job} locked for another ${duration}`,
		attemptsMade: ({ job }) => `the number of attempts ${job} has made`,
	},
	flow: {
		producer: "a flow producer (adds jobs together with their child jobs)",
		create: ({ as }) => `set up a flow producer as ${as}, for adding jobs together with their child jobs`,
		node: ({ job, queue, details, children }) => `${job} on ${queue}${paren(details)}${children ? ", run once these child jobs finish" : ""}`,
		add: ({ flow, children }) => `add ${flow}${children ? "" : " as a flow"}`,
		addBulk: "add these job flows",
	},
	errorLabels: {
		UnrecoverableError: "an unrecoverable error (the job fails without further retries)",
		DelayedError: "a delay signal (the job waits until its new time)",
		WaitingChildrenError: "a wait signal (the job waits for its child jobs)",
		WaitingError: "a wait signal (the job goes back to waiting)",
		RateLimitError: "a rate-limit signal (the job goes back to waiting)",
	},
};
