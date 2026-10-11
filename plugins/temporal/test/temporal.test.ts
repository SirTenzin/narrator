import { describe, expect, test } from "bun:test";
import { narrate, narrateWithStats } from "@usenarrator/testkit";
import { temporal } from "../src";

const plugins = [temporal()];

const read = (code: string) => {
	const { text, fallbacks } = narrateWithStats(code, { plugins });
	expect(fallbacks).toBe(0);
	return text;
};

const WF = `import { proxyActivities, sleep, condition, defineSignal, defineQuery, defineUpdate, setHandler, continueAsNew, executeChild, startChild, patched, CancellationScope, ApplicationFailure, uuid4 } from "@temporalio/workflow";\nimport type * as activities from "./activities";\n`;

describe("workflows", () => {
	test("hello world: proxied activities with timeouts and retries, then an activity call", () => {
		expect(
			read(`${WF}const { greet } = proxyActivities<typeof activities>({
	startToCloseTimeout: "1 minute",
	retry: { initialInterval: "1s", backoffCoefficient: 2, maximumInterval: "1m", maximumAttempts: 5, nonRetryableErrorTypes: ["InvalidInput"] },
});

export async function example(name: string): Promise<string> {
	return await greet(name);
}`),
		).toBe(
			[
				'Set up the activities greet (each attempt may take up to 1 minute; up to 5 attempts; waiting 1 second before the first retry, growing 2× each time up to 1 minute; never retrying "InvalidInput" errors).',
				"",
				"To example (async), given name; gives back text:",
				"  Run the activity greet with name, and give back the result.",
			].join("\n"),
		);
	});

	test("durable timers, conditions with timeouts, and signals/queries", () => {
		expect(
			read(`${WF}export const approve = defineSignal<[string]>("approve");
export const getStatus = defineQuery<string>("getStatus");
export async function subscription(email: string) {
	let approved = false;
	let status = "pending";
	setHandler(approve, (by) => {
		approved = true;
		status = by;
	});
	setHandler(getStatus, () => status);
	await sleep("30 days");
	if (await condition(() => approved, "7 days")) await sendWelcome(email);
	await condition(() => approved);
}`),
		).toBe(
			[
				'Define the signal "approve" as approve (carrying text).',
				'Define the query "getStatus" as get status (answered with text).',
				"",
				"To subscription (async), given email:",
				"  Let approved mean false.",
				'  Let status start as "pending".',
				'  When the signal "approve" arrives:',
				"    Set approved to true.",
				"    Set status to by.",
				'  When asked the query "getStatus", answer with status.',
				"  Wait 30 days.",
				"  If approved is true within 7 days, send welcome (email).",
				"  Wait until approved is true.",
			].join("\n"),
		);
	});

	test("updates, child workflows, and continue-as-new", () => {
		expect(
			read(`${WF}const addItem = defineUpdate<number, [string]>("addItem");
export async function cart(items: string[]) {
	setHandler(addItem, (item) => items.push(item));
	const receipt = await executeChild(chargeWorkflow, { args: [items], workflowId: "charge-" + uuid4(), parentClosePolicy: ParentClosePolicy.ABANDON });
	await startChild(auditWorkflow, { args: [receipt] });
	await continueAsNew<typeof cart>(items);
}`),
		).toBe(
			[
				'Define the update "addItem" as add item (carrying a number and text).',
				"",
				"To cart (async), given items:",
				'  When the update "addItem" is requested, add item to items.',
				'  Run the child workflow charge workflow with items and wait for its result (workflow ID "charge-" followed by a random UUID that stays the same on replay; if this workflow closes first: parent close policy\'s abandon), and call the result receipt.',
				"  Start the child workflow audit workflow with receipt, without waiting for it.",
				"  Start this workflow over as a fresh run with items (continue-as-new: same workflow ID, new history).",
			].join("\n"),
		);
	});

	test("patches, cancellation scopes and failures", () => {
		expect(
			read(`${WF}export async function migrate() {
	if (patched("use-v2-billing")) await chargeV2();
	await CancellationScope.nonCancellable(() => cleanup());
	await CancellationScope.withTimeout("10 minutes", async () => {
		await syncAll();
		await notify();
	});
	throw ApplicationFailure.nonRetryable("Card declined", "CardError");
}`),
		).toBe(
			[
				"To migrate (async):",
				'  If this workflow run started after the change "use-v2-billing" was deployed, charge v2.',
				"  Without letting cancellation interrupt it: cleanup.",
				"  Within 10 minutes, cancelling whatever is still running after that:",
				"    Sync all.",
				"    Notify.",
				'  Fail with a non-retryable failure of type "CardError": "Card declined".',
			].join("\n"),
		);
	});

	test("namespace imports work too", () => {
		expect(
			read(`import * as wf from "@temporalio/workflow";\nexport async function f() {\n\tawait wf.sleep(5000);\n\tawait wf.condition(() => !blocked);\n}`),
		).toBe(["To f (async):", "  Wait 5 seconds.", "  Wait until blocked is missing."].join("\n"));
	});
});

describe("activities, workers and the client", () => {
	test("activity heartbeats and sleeps", () => {
		expect(
			read(`import { heartbeat, sleep, activityInfo } from "@temporalio/activity";
export async function fakeProgress(sleepIntervalMs = 1000) {
	const start = activityInfo().heartbeatDetails ?? 1;
	await sleep(sleepIntervalMs);
	heartbeat(start);
}`),
		).toBe(
			[
				"To fake progress (async), given sleep interval ms (default 1000):",
				"  Let start be the heartbeat details from this activity's info, or 1 if that's missing.",
				"  Pause for sleep interval ms, stopping early if the activity is cancelled.",
				"  Send a heartbeat with start so Temporal knows this activity is still alive.",
			].join("\n"),
		);
	});

	test("a worker for a task queue", () => {
		expect(
			read(`import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";
const connection = await NativeConnection.connect({ address: "localhost:7233" });
const worker = await Worker.create({ connection, namespace: "default", taskQueue: "hello-world", workflowsPath: require.resolve("./workflows"), activities });
await worker.run();`),
		).toBe(
			[
				'Let connection be a connection to the Temporal server at "localhost:7233".',
				'Set up a Temporal worker as worker for the task queue "hello-world" (namespace "default"; workflows from "./workflows"; activities: activities).',
				"Run worker, taking work from its task queue until it shuts down.",
			].join("\n"),
		);
	});

	test("starting, signalling, querying and awaiting workflows", () => {
		expect(
			read(`import { Client, Connection } from "@temporalio/client";
import { approve, getStatus, subscription } from "./workflows";
const client = new Client({ connection, namespace: "billing" });
const handle = await client.workflow.start(subscription, { taskQueue: "subscriptions", args: [email], workflowId: \`sub-\${userId}\`, workflowExecutionTimeout: "365 days" });
await handle.signal(approve, "admin");
const status = await handle.query(getStatus);
const result = await handle.result();
const total = await client.workflow.execute(sumWorkflow, { taskQueue: "math", args: [1, 2] });
await client.workflow.getHandle(workflowId).terminate("duplicate");`),
		).toBe(
			[
				'Set up a Temporal client as client (namespace "billing").',
				'Start the workflow subscription with email, without waiting for it to finish (task queue "subscriptions"; workflow ID "sub-{user ID}"; stopped if not finished within 365 days, retries and continue-as-new included), and call the result handle.',
				'Send approve with "admin" to handle.',
				"Let status be the answer handle gives to get status.",
				"Let result be handle's result once the workflow finishes.",
				'Run the workflow sum workflow with 1 and 2 and wait for its result (task queue "math"), and call the result total.',
				'Stop the workflow workflow ID immediately because "duplicate".',
			].join("\n"),
		);
	});

	test("schedules and cron workflows", () => {
		expect(
			read(`import { Client } from "@temporalio/client";
await client.schedule.create({
	scheduleId: "nightly-report",
	spec: { cronExpressions: ["0 2 * * *"], timezone: "America/New_York" },
	action: { type: "startWorkflow", workflowType: reportWorkflow, args: [], taskQueue: "reports" },
	policies: { overlap: ScheduleOverlapPolicy.SKIP },
});
await client.workflow.start(cleanup, { taskQueue: "ops", workflowId: "cleanup", cronSchedule: "0 * * * *" });`),
		).toBe(
			[
				'Create the schedule "nightly-report" to start the workflow report workflow on the task queue "reports" every day at 02:00 America/New_York time (cron 0 2 * * *) (when runs overlap: schedule overlap policy\'s skip).',
				'Start the workflow cleanup, without waiting for it to finish (task queue "ops"; workflow ID "cleanup"; repeating every hour, on the hour (cron 0 * * * *)).',
			].join("\n"),
		);
	});
});

describe("stays out of the way", () => {
	test("other sleep, condition and signal functions are untouched", () => {
		const code = `import { sleep } from "./utils";\nawait sleep(1000);\nawait condition(() => ready);\ncontroller.signal(x);\nconst r = await res.result();\nawait worker.run();`;
		expect(narrate(code, { plugins })).toBe(narrate(code));
	});

	test("a Temporal file still leaves foreign calls alone", () => {
		const code = `import { sleep } from "@temporalio/workflow";\nimport { setTimeout } from "node:timers/promises";\nawait setTimeout(100);\nabort.signal(reason);\nawait queue.create({ name: "x" });`;
		expect(narrate(code, { plugins })).toBe(narrate(code));
	});
});
