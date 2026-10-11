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

/** Inngest phrasebook. A translator implements this type in `src/<locale>.ts`. */
export type InngestPhrases = {
	time: TimePhrases;
	details: (p: { items: string[] }) => string;
	option: Phrase<"name" | "value">;
	client: {
		create: Phrase<"id" | "as">;
		noun: Phrase<"id">;
	};
	fn: {
		/** `inngest.createFunction(…)` assigned to `as`; `triggers` says when it runs. */
		define: (p: { id: string; as: string | null; triggers: string; details: string | null }) => string;
		noun: (p: { id: string; triggers: string; details: string | null }) => string;
		/** Steps given by a named handler rather than inline. */
		handler: Phrase<"handler">;
		displayName: Phrase<"name">;
		onFailure: string;
		onFailureWith: Phrase<"handler">;
	};
	triggers: {
		/** Several triggers, any of which starts a run. */
		any: (p: { triggers: string[] }) => string;
		event: (p: { event: string; condition: string | null }) => string;
		cron: Phrase<"schedule">;
		none: string;
		invoked: string;
		other: Phrase<"value">;
	};
	config: {
		concurrency: (p: { n: string; key: string | null; scope: "fn" | "env" | "account" }) => string;
		throttle: (p: { limit: string; period: string; key: string | null; burst: string | null }) => string;
		rateLimit: (p: { limit: string; period: string; key: string | null }) => string;
		debounce: (p: { period: string; key: string | null; timeout: string | null }) => string;
		retries: (p: { n: string; count: number | null }) => string;
		cancelOn: (p: { event: string; match: string | null; condition: string | null; timeout: string | null }) => string;
		priority: Phrase<"expr">;
		batch: (p: { size: string; timeout: string | null; key: string | null }) => string;
		idempotency: Phrase<"key">;
		singleton: (p: { key: string | null; mode: "skip" | "cancel" }) => string;
		startTimeout: Phrase<"duration">;
		finishTimeout: Phrase<"duration">;
	};
	steps: {
		/** `step.run(id, fn)`: a block step; `action` is set when the body is one line said inline. */
		run: (p: { id: string; action: string | null }) => string;
		sleep: Phrase<"duration" | "id">;
		sleepUntil: Phrase<"time" | "id">;
		waitForEvent: (p: { event: string; match: string | null; condition: string | null; timeout: string | null; id: string; as: string | null }) => string;
		waitForSignal: (p: { signal: string; timeout: string | null; id: string; as: string | null }) => string;
		sendEvent: Phrase<"events" | "id">;
		invoke: (p: { fn: string; data: string | null; timeout: string | null; id: string }) => string;
		fetch: Phrase<"url">;
		aiInfer: Phrase<"model" | "id">;
		aiWrap: (p: { fn: string; args: string | null; id: string }) => string;
	};
	events: {
		one: (p: { name: string; data: string | null }) => string;
		/** `bare` when the value already reads as data (a variable named `data`). */
		data: (p: { data: string; bare: boolean }) => string;
		several: string;
		send: Phrase<"events">;
		/** v4 `eventType("user/created", { schema })`. */
		type: (p: { name: string; schema: string | null }) => string;
	};
	/** `serve({ client, functions })`; `handlers` lists exported request handlers (`GET`, `POST`) when destructured. */
	serve: (p: { functions: string; listed: boolean; client: string | null; framework: string | null; handlers: string | null }) => string;
	errorLabels: {
		NonRetriableError: string;
		RetryAfterError: string;
		StepError: string;
	};
};
