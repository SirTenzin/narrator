import { describe, expect, test } from "bun:test";
import { narrate, narrateWithStats } from "@usenarrator/testkit";
import { triggerDev } from "../src";

const plugins = [triggerDev()];

const read = (code: string) => {
	const { text, fallbacks } = narrateWithStats(code, { plugins });
	expect(fallbacks).toBe(0);
	return text;
};

const SDK = `import { task, schemaTask, schedules, tasks, batch, wait, metadata, idempotencyKeys, runs, retry, queue, AbortTaskRunError } from "@trigger.dev/sdk";\n`;
const V3 = `import { task, metadata, queue, schedules, runs } from "@trigger.dev/sdk/v3";\n`;

describe("tasks", () => {
	test("the hello-world task with retry, queue, machine and max duration", () => {
		expect(
			read(`${SDK}export const helloWorld = task({
	id: "hello-world",
	retry: { maxAttempts: 10, factor: 1.8, minTimeoutInMs: 500, maxTimeoutInMs: 30_000, randomize: false },
	queue: myQueue,
	machine: "small-2x",
	maxDuration: 300,
	run: async (payload: { message: string }, { ctx }) => {
		await wait.for({ seconds: 5 });
		return { message: payload.message };
	},
});`),
		).toBe(
			[
				'Define the Trigger.dev task "hello-world" as hello world (up to 10 attempts; waiting 500 milliseconds to 30 seconds between attempts, growing 1.8× each time; on the queue my queue; on a small-2x machine; stopped after 5 minutes):',
				"  Wait 5 seconds.",
				"  Give back an object with message: payload's message.",
			].join("\n"),
		);
	});

	test("lifecycle hooks read as when they run", () => {
		expect(
			read(`${SDK}export const t = task({
	id: "with-hooks",
	run: async (payload) => process(payload),
	onStartAttempt: async ({ ctx }) => { logStart(ctx); },
	onSuccess: async ({ output }) => { await notify(output); },
	onFailure: async ({ error }) => { await alertTeam(error); },
	catchError: handleError,
});`),
		).toBe(
			[
				'Define the Trigger.dev task "with-hooks" as t:',
				"  Process (payload), and give back the result.",
				"  Before each attempt:",
				"    Log start.",
				"  When the run succeeds:",
				"    Notify (output).",
				"  When the run fails after its last attempt:",
				"    Alert team (error).",
				"  Whenever an attempt throws, run handle error.",
			].join("\n"),
		);
	});

	test("scheduled tasks say when they run, in which time zone, and where", () => {
		expect(
			read(`${V3}export const pushHourlyMetersTask = schedules.task({
	id: "push-hourly-meters",
	cron: { pattern: "10 * * * *", environments: ["PRODUCTION"] },
	maxDuration: 600,
	retry: { maxAttempts: 3 },
	run: async (payload) => pushMeters(payload.timestamp),
});`),
		).toBe(
			[
				'Define the scheduled task "push-hourly-meters" as push hourly meters task, run every hour at minute 10 (cron 10 * * * *) (only in PRODUCTION; stopped after 10 minutes; up to 3 attempts):',
				"  Push meters (payload's timestamp), and give back the result.",
			].join("\n"),
		);
		expect(read(`${SDK}export const daily = schedules.task({ id: "daily", cron: { pattern: "0 5 * * *", timezone: "Asia/Tokyo" }, run: sendDigest });`)).toBe(
			['Define the scheduled task "daily" as daily, run every day at 05:00 Asia/Tokyo time (cron 0 5 * * *):', "  • run send digest"].join("\n"),
		);
		expect(read(`${SDK}export const later = schedules.task({ id: "later", cron: "0 9 * * 1", run: go });`)).toContain(
			"run every Monday at 09:00 UTC (cron 0 9 * * 1)",
		);
	});

	test("schemaTask and queues", () => {
		expect(read(`${SDK}export const migrationRunQueue = queue({ name: "migration-run", concurrencyLimit: 1 });`)).toBe(
			'Define the queue "migration-run" as migration run queue, running at most 1 at a time.',
		);
		expect(read(`${SDK}export const v = schemaTask({ id: "validated", schema: payloadSchema, run: async ({ name }) => greet(name) });`)).toBe(
			['Define the Trigger.dev task "validated" as v (payload checked against payload schema):', "  Give back the result of greet (name)."].join("\n"),
		);
	});
});

describe("triggering", () => {
	test("trigger queues a run without waiting; options say when and how often", () => {
		expect(
			read(
				`${SDK}const handle = await emailTask.trigger({ to: user.email }, { idempotencyKey: \`welcome:\${user.id}\`, idempotencyKeyTTL: "7d", delay: "1h", tags: ["user", "welcome"] });`,
			),
		).toBe(
			[
				"Queue a run of email task with the payload to: user's email, without waiting for it, and call the result handle:",
				'  • at most once per idempotency key "welcome:{user\'s ID}" within 7 days',
				"  • starting after 1 hour",
				'  • tagged "user" and "welcome"',
			].join("\n"),
		);
	});

	test("triggerAndWait and unwrap", () => {
		expect(read(`${SDK}const result = await childTask.triggerAndWait(payload);`)).toBe(
			"Start child task with payload and wait for it to finish, and call the result result.",
		);
		expect(read(`${SDK}const output = await childTask.triggerAndWait({ id }, { concurrencyKey: orgId }).unwrap();`)).toBe(
			[
				"Start child task with the payload ID and wait for it to finish, taking its output (failing if the run failed), and call the result output:",
				"  • with its queue's concurrency counted separately per org ID",
			].join("\n"),
		);
	});

	test("tasks.trigger by ID, priority, and v3 on-demand queues", () => {
		expect(read(`${SDK}await tasks.trigger<typeof helloWorld>("hello-world", { message: "hi" }, { priority: 300 });`)).toBe(
			'Queue a run of the task "hello-world" with the payload message: "hi", without waiting for it (queued as if it arrived 5 minutes earlier).',
		);
		expect(read(`${V3}await myTask.trigger(data, { queue: { name: "my-queue", concurrencyLimit: 10 } });`)).toBe(
			'Queue a run of my task with the payload data, without waiting for it (on the queue "my-queue", at most 10 at a time).',
		);
	});

	test("batches list their items", () => {
		expect(read(`${SDK}await childTask.batchTrigger([{ payload: { n: 1 } }, { payload: { n: 2 }, options: { delay: "5m" } }]);`)).toBe(
			["Queue runs of child task, without waiting for them:", "  • the payload n: 1", "  • the payload n: 2 (starting after 5 minutes)"].join("\n"),
		);
		expect(
			read(`${SDK}const results = await batch.triggerByTaskAndWait([{ task: childTask, payload: { foo: "x" } }, { task: otherTask, payload: { id: 1 } }]);`),
		).toBe(
			[
				"Start runs and wait for every run to finish, and call the result results:",
				'  • child task with the payload foo: "x"',
				"  • other task with the payload ID: 1",
			].join("\n"),
		);
		expect(read(`${SDK}await sendWebhooksTask.batchTrigger(submissions);`)).toBe(
			"Queue runs of send webhooks task for each item in submissions, without waiting for them.",
		);
	});
});

describe("inside a run", () => {
	test("waits, tokens and retries", () => {
		expect(
			read(`${SDK}await wait.for({ minutes: 5 });
await wait.until({ date: deadline });
const token = await wait.createToken({ timeout: "1d" });
const approval = await wait.forToken<{ ok: boolean }>(token).unwrap();
await wait.completeToken(token, { ok: true });
const data = await retry.onThrow(async () => fetchData(url), { maxAttempts: 3 });
if (!data) throw new AbortTaskRunError("no data");`),
		).toBe(
			[
				"Wait 5 minutes.",
				"Wait until deadline.",
				"Let token be a new wait token that times out after 1 day.",
				"Wait until token is completed, taking its data (failing if it timed out), and call the result approval.",
				"Complete token with an object with ok: true.",
				"Try up to 3 times, retrying whenever this throws: fetch data (URL), and call the result data.",
				'If data is missing, fail with an error that stops the run without retrying: "no data".',
			].join("\n"),
		);
	});

	test("run metadata, including the parent's", () => {
		expect(
			read(`${V3}metadata.set(TOTAL_ROWS_KEY, rowCount);
await metadata.increment("processed", 10);
metadata.parent.append("logs", "step done");
metadata.root.set("status", "running");
const progress = metadata.get("progress");`),
		).toBe(
			[
				"Set the run's total rows key metadata to row count.",
				'Add 10 to the run\'s "processed" metadata.',
				'Append "step done" to the parent run\'s "logs" metadata.',
				'Set the root run\'s "status" metadata to "running".',
				'Let progress be the run\'s "progress" metadata.',
			].join("\n"),
		);
	});

	test("idempotency keys, runs and schedules", () => {
		expect(
			read(`${SDK}const key = await idempotencyKeys.create(["charge", orderId], { scope: "global" });
const run = await runs.retrieve(handle.id);
await runs.cancel(runId);
await schedules.create({ task: reminderTask.id, cron: "0 9 * * *", timezone: "Europe/London", externalId: userId, deduplicationKey: \`\${userId}-reminder\` });`),
		).toBe(
			[
				'Let key be an idempotency key from a list of "charge" and order ID (shared by every run).',
				"Let run be the run handle's ID, fetched from Trigger.dev.",
				"Cancel the run run ID.",
				'Attach a schedule to reminder task\'s ID that runs it every day at 09:00 Europe/London time (cron 0 9 * * *) (for user ID; not created twice for the key "{user ID}-reminder").',
			].join("\n"),
		);
	});
});

describe("stays out of the way", () => {
	test("jQuery triggers, local arrays named runs, and other task() helpers are untouched", () => {
		const code = `import { task } from "gulp";\n$(el).trigger("click");\nconst done = runs.filter((r) => r.ok);\ntask("build", () => compile());\nmetadata.set("a", 1);`;
		expect(narrate(code, { plugins })).toBe(narrate(code));
	});

	test("a file using the SDK still leaves non-SDK owners alone", () => {
		const code = `${V3}const runs = await db.select().from(runsTable);\nconst latest = runs.find((r) => r.live);\ncache.set("k", 1);\nemitter.trigger("x");`;
		expect(narrate(code, { plugins })).toBe(narrate(code));
	});
});
