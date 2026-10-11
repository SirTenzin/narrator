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

/** Lifecycle hooks a task can declare, each read as when it runs. */
export type Hook =
	| "init"
	| "middleware"
	| "onStart"
	| "onStartAttempt"
	| "onSuccess"
	| "onFailure"
	| "onComplete"
	| "onCancel"
	| "onWait"
	| "onResume"
	| "catchError"
	| "handleError"
	| "cleanup";

/** Scopes an idempotency key can have. */
export type KeyScope = "run" | "attempt" | "global";

/** Trigger.dev phrasebook. A translator implements this type in `src/<locale>.ts`. */
export type TriggerPhrases = {
	time: TimePhrases;
	details: (p: { items: string[] }) => string;
	option: Phrase<"name" | "value">;
	task: {
		/** `task({ id, run, … })` assigned to `as`. */
		define: (p: { id: string; as: string | null; details: string | null }) => string;
		noun: (p: { id: string; details: string | null }) => string;
		/** `schedules.task(…)`; `schedule` is null when schedules are attached elsewhere. */
		defineScheduled: (p: { id: string; as: string | null; schedule: string | null; details: string | null }) => string;
		nounScheduled: (p: { id: string; schedule: string | null; details: string | null }) => string;
		/** `run: handler` given by name. */
		runs: Phrase<"handler">;
		hooks: Record<Hook, string>;
		hookWith: Phrase<"hook" | "handler">;
		schema: Phrase<"schema">;
		description: Phrase<"text">;
		environments: Phrase<"list">;
	};
	config: {
		queue: Phrase<"queue">;
		inlineQueue: (p: { name: string; limit: string | null }) => string;
		machine: Phrase<"machine">;
		maxDuration: Phrase<"duration">;
		ttl: Phrase<"duration">;
		attempts: (p: { n: string; count: number | null }) => string;
		/** Retry waits: from `min` up to `max`, growing by `factor`. */
		backoff: (p: { min: string | null; max: string | null; factor: string | null; randomize: boolean }) => string;
		outOfMemory: Phrase<"machine">;
		retryPolicy: Phrase<"policy">;
	};
	queue: {
		define: (p: { name: string; as: string | null; limit: string | null }) => string;
		noun: (p: { name: string; limit: string | null }) => string;
	};
	trigger: {
		/** `myTask.trigger(payload)` / `tasks.trigger("id", payload)`. */
		start: (p: { task: string; payload: string | null }) => string;
		startAndWait: (p: { task: string; payload: string | null; unwrap: boolean }) => string;
		/** `batchTrigger(items)`: `each` is null when the items are listed beneath. */
		batch: (p: { task: string | null; each: string | null }) => string;
		batchAndWait: (p: { task: string | null; each: string | null }) => string;
		startAndPoll: (p: { task: string; payload: string | null }) => string;
		taskId: Phrase<"id">;
		payload: (p: { payload: string; bare: boolean }) => string;
		item: (p: { task: string | null; payload: string | null; details: string | null }) => string;
		delay: Phrase<"duration">;
		delayUntil: Phrase<"time">;
		idempotencyKey: (p: { key: string; ttl: string | null }) => string;
		concurrencyKey: Phrase<"key">;
		tags: Phrase<"tags">;
		priority: Phrase<"duration">;
		metadata: Phrase<"value">;
		region: Phrase<"region">;
		version: Phrase<"version">;
	};
	wait: {
		for: (p: { duration: string; details: string | null }) => string;
		until: (p: { time: string; details: string | null }) => string;
		createToken: (p: { timeout: string | null; details: string | null }) => string;
		forToken: (p: { token: string; unwrap: boolean }) => string;
		completeToken: (p: { token: string; data: string | null }) => string;
		idempotencyKey: Phrase<"key">;
	};
	metadata: {
		/** Whose metadata: this run's, its parent's, or the root run's. */
		owner: Record<"current" | "parent" | "root", string>;
		set: Phrase<"owner" | "key" | "value">;
		increment: Phrase<"owner" | "key" | "by">;
		decrement: Phrase<"owner" | "key" | "by">;
		append: Phrase<"owner" | "key" | "value">;
		remove: Phrase<"owner" | "key" | "value">;
		del: Phrase<"owner" | "key">;
		replace: Phrase<"owner" | "value">;
		get: Phrase<"owner" | "key">;
		current: Phrase<"owner">;
		flush: Phrase<"owner">;
		stream: Phrase<"owner" | "key" | "value">;
	};
	idempotencyKey: (p: { key: string; scope: KeyScope | null }) => string;
	runs: {
		retrieve: Phrase<"id">;
		cancel: Phrase<"id">;
		replay: Phrase<"id">;
		reschedule: Phrase<"id" | "delay">;
		list: (p: { filter: string | null }) => string;
		subscribe: Phrase<"id">;
		poll: Phrase<"id">;
	};
	schedules: {
		create: (p: { task: string; schedule: string; details: string | null }) => string;
		externalId: Phrase<"id">;
		deduplicationKey: Phrase<"key">;
		del: Phrase<"id">;
		activate: Phrase<"id">;
		deactivate: Phrase<"id">;
		update: (p: { id: string; schedule: string | null; details: string | null }) => string;
		retrieve: Phrase<"id">;
		list: string;
	};
	retry: {
		onThrow: (p: { attempts: string | null }) => string;
		fetch: Phrase<"url">;
	};
	configure: (p: { details: string | null }) => string;
	project: (p: { project: string; details: string | null }) => string;
	runtime: Phrase<"runtime">;
	dirs: Phrase<"dirs">;
	defaultRetry: Phrase<"retry">;
	errorLabels: {
		AbortTaskRunError: string;
	};
};
