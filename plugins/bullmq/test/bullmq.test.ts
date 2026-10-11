import { describe, expect, test } from "bun:test";
import { narrate, narrateWithStats } from "@usenarrator/testkit";
import { bullmq } from "../src";

const plugins = [bullmq()];

/** Narrates with the BullMQ plugin and asserts nothing fell back to raw code. */
const read = (code: string) => {
	const { text, fallbacks } = narrateWithStats(code, { plugins });
	expect(fallbacks).toBe(0);
	return text;
};

const BULL = `import { Queue, Worker, QueueEvents, FlowProducer, Job, UnrecoverableError } from "bullmq";\n`;

describe("queues and jobs", () => {
	test("the quick-start queue and job", () => {
		expect(
			read(`${BULL}const myQueue = new Queue("foo");
await myQueue.add("myJobName", { foo: "bar" });`),
		).toBe(['Set up the job queue "foo" as my queue.', 'Add a "myJobName" job to my queue with the data foo: "bar".'].join("\n"));
	});

	test("retry, delay and retention options say when and how often a job runs", () => {
		expect(
			read(`${BULL}await queue.add("send-email", payload, {
	delay: 5000,
	attempts: 3,
	backoff: { type: "exponential", delay: 1000 },
	removeOnComplete: true,
	removeOnFail: { age: 24 * 3600 },
});`),
		).toBe(
			[
				'Add a "send-email" job to queue with the data payload:',
				"  • starting after 5 seconds",
				"  • up to 3 attempts",
				"  • waiting 1 second before the first retry and doubling the wait each time",
				"  • deleted once it completes",
				"  • keeping failed jobs for 1 day",
			].join("\n"),
		);
	});

	test("two short options stay inline", () => {
		expect(read(`${BULL}await queue.add("paint", { color: "red" }, { priority: 1, lifo: true });`)).toBe(
			'Add a "paint" job to queue with the data color: "red", priority 1 (lower numbers run first), ahead of jobs already waiting.',
		);
	});

	test("job IDs and deduplication explain what gets skipped", () => {
		const text = read(`${BULL}await queue.add("sync", data, { jobId: "sync-" + orgId, deduplication: { id: orgId, ttl: 5000, extend: true } });`);
		expect(text).toContain('with the job ID "sync-" followed by org ID (not added again while a job with that ID exists)');
		expect(text).toContain("skipped while another job with the deduplication ID org ID is less than 5 seconds old (each duplicate restarts that window)");
	});

	test("the result of add is named after the action", () => {
		expect(read(`${BULL}const job = await queue.add("welcome", { userId }, { delay: 3600000 });`)).toBe(
			'Add a "welcome" job to queue with the data user ID, starting after 1 hour, and call the result job.',
		);
	});

	test("v5 repeatable jobs read their cron pattern and time zone", () => {
		expect(read(`${BULL}await queue.add("report", {}, { repeat: { pattern: "0 15 3 * * *", tz: "Europe/London" } });`)).toBe(
			'Add a "report" job to queue, repeating every day at 03:15 Europe/London time (cron 0 15 3 * * *).',
		);
		expect(read(`${BULL}await queue.add("poll", {}, { repeat: { every: 10000, limit: 100 } });`)).toBe(
			'Add a "poll" job to queue, repeating every 10 seconds, at most 100 times.',
		);
	});

	test("addBulk lists each job", () => {
		expect(
			read(`${BULL}await queue.addBulk([
	{ name: "a", data: { n: 1 } },
	{ name: "b", data: { n: 2 }, opts: { delay: 1000 } },
]);`),
		).toBe(["Add these jobs to queue:", '  • an "a" job (the data n: 1)', '  • a "b" job (the data n: 2, starting after 1 second)'].join("\n"));
	});

	test("queue maintenance", () => {
		const text = read(`${BULL}await queue.drain(true);
await queue.clean(60000, 1000, "failed");
const counts = await queue.getJobCounts("active", "completed", "failed");
const failed = await queue.getJobs(["failed"]);
await queue.pause();
await queue.obliterate({ force: true });
const job = await queue.getJob(jobId);`);
		expect(text).toBe(
			[
				"Remove every waiting and delayed job from queue.",
				"Remove failed jobs older than 1 minute from queue (at most 1000).",
				"Let counts be the number of running, completed, and failed jobs in queue.",
				"Let failed be the failed jobs in queue.",
				"Pause queue, so workers start no new jobs until it resumes.",
				"Delete queue and all of its jobs, even ones still running.",
				"Let job be the job job ID in queue.",
			].join("\n"),
		);
	});

	test("queue defaults are creation details", () => {
		expect(read(`${BULL}export const emailQueue = new Queue("emails", { connection, defaultJobOptions: { attempts: 3, removeOnComplete: 100 } });`)).toBe(
			[
				'Set up the job queue "emails" as email queue:',
				"  • connection: connection",
				"  • every job by default: up to 3 attempts, keeping only the last 100 completed jobs",
			].join("\n"),
		);
	});
});

describe("job schedulers", () => {
	test("upsertJobScheduler with every", () => {
		expect(
			read(`${BULL}await myQueue.upsertJobScheduler("repeat-every-10s", { every: 10000 }, { name: "every-job", data: { jobData: "data" }, opts: {} });`),
		).toBe('Schedule an "every-job" job on my queue every 10 seconds with the data job data: "data" (job scheduler "repeat-every-10s").');
	});

	test("upsertJobScheduler with a cron pattern and no template names the job after the scheduler", () => {
		expect(read(`${BULL}await queue.upsertJobScheduler("weekday-digest", { pattern: "0 9 * * 1-5", tz: "UTC" });`)).toBe(
			'Schedule a "weekday-digest" job on queue every weekday at 09:00 UTC (cron 0 9 * * 1-5) (job scheduler "weekday-digest").',
		);
	});

	test("removing schedulers", () => {
		expect(read(`${BULL}await queue.removeJobScheduler("weekday-digest");`)).toBe('Stop the job scheduler "weekday-digest" on queue.');
		expect(read(`${BULL}await queue.removeRepeatable("report", { pattern: "0 0 * * *" });`)).toBe(
			'Stop repeating a "report" job on queue every day at 00:00 (cron 0 0 * * *).',
		);
	});
});

describe("workers", () => {
	test("an inline processor's steps sit under the worker", () => {
		expect(
			read(`${BULL}const worker = new Worker("foo", async (job) => {
	await job.updateProgress(42);
	return sendEmail(job.data);
}, { connection, concurrency: 50, limiter: { max: 10, duration: 1000 } });`),
		).toBe(
			[
				'Start a worker as worker that handles each job from the "foo" queue (connection: connection, up to 50 jobs at a time, at most 10 jobs per second):',
				"  Report job as 42% done.",
				"  Send email (job's data), and give back the result.",
			].join("\n"),
		);
	});

	test("sandboxed and named processors", () => {
		expect(read(`${BULL}const worker = new Worker("Paint", __dirname + "/processor.js", { concurrency: 4, autorun: false });`)).toBe(
			'Start a worker as worker that handles each job from the "Paint" queue with the processor file dirname plus "/processor.js" in a separate process (up to 4 jobs at a time, not started until it is run).',
		);
		expect(read(`${BULL}new Worker(QUEUE_NAME, processEmail, { limiter: { max: 100, duration: 60000, groupKey: "orgId" } });`)).toBe(
			'Start a worker that handles each job from queue name with process email (at most 100 jobs per minute for each "orgId").',
		);
	});

	test("events read as when they fire", () => {
		expect(
			read(`${BULL}worker.on("completed", (job) => {
	console.log(\`\${job.id} has completed!\`);
});
worker.on("failed", (job, err) => console.log(err.message));
queueEvents.once("drained", onDrained);`),
		).toBe(
			[
				"Whenever a job completes on worker:",
				'  Log "{job\'s ID} has completed!".',
				"",
				"Whenever a job fails on worker:",
				"  Log (with error's message).",
				"",
				"The first time there are no more waiting jobs on queue events, run on drained.",
			].join("\n"),
		);
	});

	test("job methods inside a processor", () => {
		expect(
			read(`${BULL}async function processJob(job: Job, token?: string) {
	if (job.attemptsMade > 3) throw new UnrecoverableError("Gave up");
	await job.log("starting");
	await job.moveToDelayed(Date.now() + 5000, token);
	const result = await job.waitUntilFinished(queueEvents, 30000);
	const children = await job.getChildrenValues();
}`),
		).toBe(
			[
				"To process job (async), given job (Job) and token:",
				"  If the number of attempts job has made is more than 3:",
				'    Fail with an unrecoverable error (the job fails without further retries): "Gave up".',
				'  Add "starting" to job\'s log.',
				"  Put job back to wait until the current time plus 5000.",
				"  Let result be job's result once it finishes (watched through queue events, for at most 30 seconds).",
				"  Let children be the results of job's child jobs.",
			].join("\n"),
		);
	});

	test("closing and rate limiting", () => {
		expect(read(`${BULL}await worker.close();\nawait worker.rateLimit(60000);\nthrow Worker.RateLimitError();`)).toBe(
			[
				"Close worker once its running jobs finish.",
				"Stop worker taking new jobs for 1 minute.",
				"Fail with a rate-limit signal (the job goes back to waiting).",
			].join("\n"),
		);
	});

	test("QueueEvents", () => {
		expect(read(`${BULL}const queueEvents = new QueueEvents("Paint");`)).toBe('Listen to the events of the "Paint" queue as queue events.');
	});
});

describe("flows", () => {
	test("a parent job runs after its children", () => {
		expect(
			read(`${BULL}const flowProducer = new FlowProducer();
const flow = await flowProducer.add({
	name: "renovate-interior",
	queueName: "renovate",
	children: [
		{ name: "paint", data: { place: "ceiling" }, queueName: "steps" },
		{ name: "fix", data: { place: "floor" }, queueName: "steps", opts: { attempts: 2 } },
	],
});`),
		).toBe(
			[
				"Set up a flow producer as flow producer, for adding jobs together with their child jobs.",
				"",
				'Add a "renovate-interior" job on the "renovate" queue, run once these child jobs finish, and call the result flow:',
				'  • a "paint" job on the "steps" queue (the data place: "ceiling")',
				'  • a "fix" job on the "steps" queue (the data place: "floor", up to 2 attempts)',
			].join("\n"),
		);
	});
});

describe("stays out of the way", () => {
	test("Set.add and other emitters are untouched", () => {
		const plain = narrate(`const s = new Set<number>();\ns.add(1);\nemitter.on("completed", done);`);
		expect(read(`${BULL}const s = new Set<number>();\ns.add(1);\nemitter.on("completed", done);`)).toBe(plain);
	});

	test("files that don't use BullMQ read as before", () => {
		const code = `const queue = new Queue("x");\nawait queue.add("a", { b: 1 });\nworker.on("failed", (job) => retry(job));\nconst w = new Worker("./w.js");`;
		expect(narrate(code, { plugins })).toBe(narrate(code));
	});

	test("Queue and Worker from other libraries are left alone", () => {
		const code = `import { Queue } from "./myQueue";\nimport { Worker } from "node:worker_threads";\nconst q = new Queue("x");\nconst w = new Worker("./w.js");`;
		expect(narrate(code, { plugins })).toBe(narrate(code));
	});
});
