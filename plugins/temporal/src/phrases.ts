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

/** Message kinds a workflow can define and handle. */
export type MessageKind = "signal" | "query" | "update";

/** Temporal phrasebook. A translator implements this type in `src/<locale>.ts`. */
export type TemporalPhrases = {
	time: TimePhrases;
	details: (p: { items: string[] }) => string;
	option: Phrase<"name" | "value">;
	activities: {
		/** `const { a, b } = proxyActivities(opts)`; `local` for `proxyLocalActivities`. */
		proxy: (p: { names: string | null; as: string | null; local: boolean; details: string | null }) => string;
		startToClose: Phrase<"duration">;
		scheduleToClose: Phrase<"duration">;
		scheduleToStart: Phrase<"duration">;
		heartbeat: Phrase<"duration">;
		taskQueue: Phrase<"queue">;
		/** A call to a proxied activity: `greet(name)`. */
		call: (p: { activity: string; args: string | null }) => string;
		heartbeatNow: (p: { details: string | null }) => string;
		info: string;
		sleep: Phrase<"duration">;
		cancelled: string;
	};
	retry: {
		attempts: (p: { n: string; count: number | null }) => string;
		unlimited: string;
		/** First wait, growth factor and cap between attempts. */
		backoff: (p: { initial: string | null; factor: string | null; max: string | null }) => string;
		nonRetryable: Phrase<"types">;
	};
	workflow: {
		sleep: Phrase<"duration">;
		/** `await condition(fn, timeout?)` as a step. */
		waitUntil: (p: { condition: string; timeout: string | null }) => string;
		/** `condition(fn, timeout)` used as a yes/no value. */
		cameTrue: (p: { condition: string; timeout: string; neg: boolean }) => string;
		continueAsNew: (p: { args: string | null }) => string;
		info: string;
		uuid: string;
		patched: (p: { id: string; neg: boolean }) => string;
		deprecatePatch: Phrase<"id">;
		isCancellation: (p: { error: string; neg: boolean }) => string;
		cancellable: string;
		nonCancellable: string;
		withTimeout: Phrase<"duration">;
		external: Phrase<"id">;
	};
	messages: {
		define: (p: { kind: MessageKind; name: string; as: string; types: string | null }) => string;
		noun: (p: { kind: MessageKind; name: string }) => string;
		/** `setHandler(message, fn)`; `action` is set when the handler is one line said inline. */
		handle: (p: { kind: MessageKind | null; message: string; action: string | null }) => string;
		handleWith: (p: { kind: MessageKind | null; message: string; handler: string }) => string;
		/** A query handler that just returns a value. */
		answer: Phrase<"message" | "value">;
		unset: Phrase<"message">;
	};
	child: {
		execute: (p: { workflow: string; args: string | null; details: string | null }) => string;
		start: (p: { workflow: string; args: string | null; details: string | null }) => string;
		parentClosePolicy: Phrase<"policy">;
	};
	failure: {
		nonRetryable: (p: { message: string | null; type: string | null }) => string;
		retryable: (p: { message: string | null; type: string | null }) => string;
		create: (p: { message: string | null; type: string | null; nonRetryable: boolean }) => string;
	};
	worker: {
		create: (p: { as: string | null; queue: string; details: string | null }) => string;
		workflowsFrom: Phrase<"path">;
		activities: Phrase<"activities">;
		namespace: Phrase<"namespace">;
		maxActivities: Phrase<"n">;
		maxWorkflows: Phrase<"n">;
		run: Phrase<"worker">;
		/** `worker.runUntil(work)`; the work follows after a colon or beneath. */
		runUntil: Phrase<"worker">;
		shutdown: Phrase<"worker">;
	};
	connection: (p: { address: string | null; details: string | null }) => string;
	client: (p: { as: string | null; details: string | null }) => string;
	start: {
		/** `client.workflow.start(wf, opts)`: start without waiting. */
		start: (p: { workflow: string; args: string | null; details: string | null }) => string;
		/** `client.workflow.execute(wf, opts)`: start and wait for the result. */
		execute: (p: { workflow: string; args: string | null; details: string | null }) => string;
		signalWithStart: (p: { workflow: string; signal: string; args: string | null; details: string | null }) => string;
		taskQueue: Phrase<"queue">;
		workflowId: Phrase<"id">;
		cron: Phrase<"schedule">;
		startDelay: Phrase<"duration">;
		executionTimeout: Phrase<"duration">;
		runTimeout: Phrase<"duration">;
		reusePolicy: Phrase<"policy">;
		conflictPolicy: Phrase<"policy">;
		getHandle: Phrase<"id">;
		list: (p: { query: string | null }) => string;
	};
	handle: {
		signal: (p: { message: string; workflow: string; args: string | null }) => string;
		query: (p: { message: string; workflow: string; args: string | null }) => string;
		executeUpdate: (p: { message: string; workflow: string; args: string | null }) => string;
		startUpdate: (p: { message: string; workflow: string; args: string | null }) => string;
		result: Phrase<"workflow">;
		/** `await handle.result()` as a step of its own. */
		waitResult: Phrase<"workflow">;
		cancel: Phrase<"workflow">;
		terminate: (p: { workflow: string; reason: string | null }) => string;
		describe: Phrase<"workflow">;
	};
	schedule: {
		create: (p: { id: string; action: string; when: string; details: string | null }) => string;
		startWorkflow: (p: { workflow: string; args: string | null; queue: string | null }) => string;
		every: Phrase<"duration">;
		overlap: Phrase<"policy">;
		paused: string;
		getHandle: Phrase<"id">;
	};
	errorLabels: {
		ApplicationFailure: string;
		CancelledFailure: string;
	};
};
