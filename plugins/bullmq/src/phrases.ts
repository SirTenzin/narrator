/** Arguments are already-rendered markup strings. */
type P<K extends string> = { [key in K]: string };
type Phrase<K extends string> = (p: P<K>) => string;

export type TimeUnit = "millisecond" | "second" | "minute" | "hour" | "day" | "week" | "month" | "year";

/** Which days a cron schedule fires on. Weekdays are 0 (Sunday) to 6; months 1 to 12. */
export type CronDays =
	| { kind: "everyDay" }
	| { kind: "weekdays"; days: number[] }
	| { kind: "months"; months: number[]; weekdays: number[] | null }
	| { kind: "monthDays"; days: number[]; months: number[] | null; weekdays: number[] | null };

/** Durations and cron schedules. Shared shape across the job-queue plugins. */
export type TimePhrases = {
	/** `count` is the number for plural agreement; `n` is its display text. */
	amount: (p: { n: string; count: number; unit: TimeUnit }) => string;
	/** A computed duration whose unit is known but whose value isn't. */
	/** A unit on its own, for rates: "per second". */
	unit: (p: { unit: TimeUnit }) => string;
	inMs: Phrase<"value">;
	inSeconds: Phrase<"value">;
	cron: {
		everySecond: string;
		everySeconds: Phrase<"n">;
		everyMinute: string;
		everyMinutes: Phrase<"n">;
		/** `minutes` past every hour; `onTheHour` when that's just minute 0. */
		hourly: (p: { minutes: string; onTheHour: boolean }) => string;
		everyHours: (p: { n: string; minutes: string; onTheHour: boolean }) => string;
		/** A frequency, optionally limited to a span of each day and to some days. */
		repeating: (p: { every: string; between: { from: string; to: string } | null; days: CronDays }) => string;
		/** Fixed times of day (`times` is a list like "09:00 and 17:00") on some days. */
		at: (p: { times: string; days: CronDays }) => string;
		/** The schedule in words with its time zone (when it matters) and the expression kept in full. */
		schedule: (p: { words: string; zone: string | null; expr: string }) => string;
		/** An expression too irregular to put in words. */
		raw: (p: { expr: string; zone: string | null }) => string;
		/** A cron expression held in a variable. */
		from: Phrase<"value">;
	};
};

/** Job states a queue can list or count. */
export type JobState = "completed" | "failed" | "delayed" | "active" | "wait" | "waiting" | "paused" | "prioritized" | "waiting-children" | "repeat";

/** Events a worker, queue or QueueEvents can emit. */
export type BullEvent =
	| "completed"
	| "failed"
	| "progress"
	| "active"
	| "stalled"
	| "error"
	| "drained"
	| "waiting"
	| "delayed"
	| "added"
	| "removed"
	| "paused"
	| "resumed"
	| "closed"
	| "closing"
	| "ready"
	| "cleaned"
	| "deduplicated"
	| "debounced"
	| "retries-exhausted"
	| "waiting-children"
	| "duplicated";

/** BullMQ phrasebook. A translator implements this type in `src/<locale>.ts`. */
export type BullmqPhrases = {
	time: TimePhrases;
	/** Inline option lists: "(up to 3 attempts, removed once complete)". */
	details: (p: { items: string[] }) => string;
	option: Phrase<"name" | "value">;
	queue: {
		/** A queue by its name: `the "emails" queue`. */
		named: Phrase<"name">;
		/** `new Queue("emails")` as a value. */
		noun: (p: { name: string; details: string | null }) => string;
		create: (p: { name: string; as: string; details: string | null }) => string;
		connection: Phrase<"value">;
		prefix: Phrase<"value">;
		defaults: Phrase<"options">;
		/** Heading for the default job options listed beneath. */
		defaultsHead: string;
		/** `queue.add("send", data, opts)`. */
		add: (p: { job: string; queue: string; data: string | null }) => string;
		addBulk: Phrase<"queue">;
		/** A job named by a string. */
		job: Phrase<"name">;
		/** A job whose name is computed. */
		jobNamed: Phrase<"name">;
		/** `bare` when the value already reads as the data (a variable named `data`). */
		data: (p: { data: string; bare: boolean }) => string;
		get: Phrase<"id" | "queue">;
		list: (p: { states: string | null; queue: string }) => string;
		count: (p: { states: string | null; queue: string }) => string;
		countsByState: Phrase<"queue">;
		pending: Phrase<"queue">;
		drain: (p: { queue: string; delayed: boolean }) => string;
		obliterate: (p: { queue: string; force: boolean }) => string;
		clean: (p: { queue: string; state: string; age: string; limit: string | null }) => string;
		pause: Phrase<"queue">;
		resume: Phrase<"queue">;
		remove: Phrase<"queue" | "id">;
		retryJobs: (p: { queue: string; state: string }) => string;
		promoteJobs: Phrase<"queue">;
		globalConcurrency: Phrase<"queue" | "n">;
		globalRateLimit: Phrase<"queue" | "max" | "duration">;
		states: Record<JobState, string>;
	};
	options: {
		delay: Phrase<"duration">;
		attempts: (p: { n: string; count: number | null }) => string;
		backoffFixed: Phrase<"delay">;
		backoffExponential: Phrase<"delay">;
		backoffCustom: Phrase<"type">;
		repeat: Phrase<"schedule">;
		jobId: Phrase<"id">;
		priority: Phrase<"n">;
		lifo: string;
		removeOnComplete: string;
		removeOnFail: string;
		keepOnComplete: string;
		keepOnFail: string;
		keepLastCompleted: Phrase<"n">;
		keepLastFailed: Phrase<"n">;
		keepCompletedFor: (p: { age: string; count: string | null }) => string;
		keepFailedFor: (p: { age: string; count: string | null }) => string;
		deduplicate: (p: { id: string; ttl: string | null; mode: "keep" | "extend" | "replace" }) => string;
		parent: (p: { id: string; queue: string | null }) => string;
		failParentOnFailure: string;
		ignoreDependencyOnFailure: string;
		removeDependencyOnFailure: string;
		continueParentOnFailure: string;
	};
	schedule: {
		every: Phrase<"duration">;
		limit: Phrase<"n">;
		startDate: Phrase<"date">;
		endDate: Phrase<"date">;
		immediately: string;
		/** `queue.upsertJobScheduler(id, repeat, template)`. */
		upsert: (p: { job: string; queue: string; schedule: string; id: string; data: string | null }) => string;
		remove: Phrase<"id" | "queue">;
		get: Phrase<"id" | "queue">;
		list: Phrase<"queue">;
		/** v5 `queue.removeRepeatable(name, repeat)`. */
		removeRepeatable: (p: { job: string; queue: string; schedule: string }) => string;
		removeRepeatableByKey: Phrase<"key" | "queue">;
	};
	worker: {
		/** `processor` is null when the steps follow as a block. */
		create: (p: { as: string | null; queue: string; processor: string | null; details: string | null }) => string;
		/** The worker as a value (`new Worker(…)` passed somewhere). */
		noun: (p: { queue: string; processor: string | null; details: string | null }) => string;
		/** A processor in its own file, run in a separate process. */
		sandboxed: Phrase<"file">;
		concurrency: Phrase<"n">;
		limiter: Phrase<"max" | "duration">;
		limiterPerGroup: Phrase<"max" | "duration" | "key">;
		manualStart: string;
		lockDuration: Phrase<"duration">;
		stalledInterval: Phrase<"duration">;
		maxStalledCount: Phrase<"n">;
		workerThreads: string;
		run: Phrase<"worker">;
		close: (p: { worker: string; force: boolean }) => string;
		pause: Phrase<"worker">;
		resume: Phrase<"worker">;
		rateLimit: Phrase<"worker" | "duration">;
		rateLimitError: string;
	};
	events: {
		/** `worker.on("failed", …)`; `once` for `.once`; `handler` is null when its steps follow. */
		on: (p: { event: string; source: string; once: boolean; handler: string | null }) => string;
		off: Phrase<"event" | "source">;
		names: Record<BullEvent, string>;
		listen: (p: { queue: string; as: string | null }) => string;
	};
	job: {
		progressPercent: Phrase<"job" | "n">;
		progress: Phrase<"job" | "value">;
		log: Phrase<"job" | "row">;
		fail: Phrase<"job" | "error">;
		complete: (p: { job: string; value: string | null }) => string;
		delay: Phrase<"job" | "until">;
		wait: Phrase<"job">;
		waitChildren: Phrase<"job">;
		retry: Phrase<"job">;
		promote: Phrase<"job">;
		remove: Phrase<"job">;
		updateData: Phrase<"job" | "data">;
		changeDelay: Phrase<"job" | "duration">;
		changePriority: Phrase<"job" | "n">;
		result: (p: { job: string; events: string; timeout: string | null }) => string;
		childResults: Phrase<"job">;
		state: Phrase<"job">;
		discard: Phrase<"job">;
		extendLock: Phrase<"job" | "duration">;
		attemptsMade: Phrase<"job">;
	};
	flow: {
		producer: string;
		create: Phrase<"as">;
		/** A flow node; `children` when it waits on child jobs listed beneath. */
		node: (p: { job: string; queue: string; details: string | null; children: boolean }) => string;
		add: (p: { flow: string; children: boolean }) => string;
		addBulk: string;
	};
	errorLabels: {
		UnrecoverableError: string;
		DelayedError: string;
		WaitingChildrenError: string;
		WaitingError: string;
		RateLimitError: string;
	};
};
