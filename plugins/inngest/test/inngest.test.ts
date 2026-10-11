import { describe, expect, test } from "bun:test";
import { en as english } from "@usenarrator/locale-en";
import { narrate, narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { en, type InngestPhrases, inngest } from "../src";

const plugins = [inngest()];

const read = (code: string) => {
	const { text, fallbacks } = narrateWithStats(code, { plugins });
	expect(fallbacks).toBe(0);
	return text;
};

const V3 = `import { Inngest, NonRetriableError } from "inngest";\n`;
const V4 = `import { Inngest, cron, eventType, staticSchema } from "inngest";\n`;

describe("clients and functions", () => {
	test("the v3 quick start: a client and an event-triggered function with durable steps", () => {
		expect(
			read(`${V3}export const inngest = new Inngest({ id: "my-app" });
export const helloWorld = inngest.createFunction(
	{ id: "hello-world" },
	{ event: "test/hello.world" },
	async ({ event, step }) => {
		await step.sleep("wait-a-moment", "1s");
		return { message: \`Hello \${event.data.email}!\` };
	},
);`),
		).toBe(
			[
				'Set up the Inngest client for the app "my-app" as inngest.',
				"",
				'Define the Inngest function "hello-world" as hello world, run whenever test/hello.world is sent:',
				'  Wait 1 second (step "wait-a-moment").',
				"  Give back an object with message: \"Hello {event's data's email}!\".",
			].join("\n"),
		);
	});

	test("v4 triggers live in the options and can mix cron and events", () => {
		expect(
			read(`${V4}export const digest = inngest.createFunction(
	{ id: "daily-digest", triggers: [cron("TZ=Europe/Paris 0 9 * * 1-5"), { event: "app/digest.requested" }] },
	async ({ step }) => {
		await step.run("send", sendDigest);
	},
);`),
		).toBe(
			[
				'Define the Inngest function "daily-digest" as digest, run every weekday at 09:00 Europe/Paris time (cron TZ=Europe/Paris 0 9 * * 1-5) or whenever app/digest.requested is sent:',
				'  Step "send": run send digest.',
			].join("\n"),
		);
	});

	test("v4 event types name the event they stand for", () => {
		expect(
			read(`${V4}const userCreated = eventType("user/created", { schema: staticSchema<{ id: string }>() });
export const onUser = inngest.createFunction({ id: "on-user", triggers: [userCreated] }, async ({ event }) => notify(event.data.id));
await inngest.send(userCreated.create({ id: "1" }));`),
		).toBe(
			[
				"Let user created be the event type user/created, with data checked against a static schema.",
				"",
				'Define the Inngest function "on-user" as on user, run whenever user/created is sent:',
				"  Notify (event's data's ID), and give back the result.",
				"",
				'Send the event user/created with the data ID: "1" to Inngest.',
			].join("\n"),
		);
	});

	test("flow control reads as limits on when runs start", () => {
		const text = read(`${V3}inngest.createFunction(
	{
		id: "sync-contacts",
		name: "Sync contacts",
		concurrency: [{ limit: 1, key: "event.data.accountId" }, { limit: 50, scope: "account", key: '"openai"' }],
		throttle: { limit: 1, period: "5s", key: "event.data.userId", burst: 2 },
		rateLimit: { limit: 1, period: "4h", key: "event.data.companyId" },
		debounce: { period: "5m", key: "event.data.accountId", timeout: "10m" },
		retries: 0,
		priority: { run: "event.data.plan == 'enterprise' ? 120 : 0" },
		batchEvents: { maxSize: 100, timeout: "5s" },
		idempotency: "event.data.cartId",
		singleton: { key: "event.data.userId", mode: "cancel" },
		timeouts: { start: "10s", finish: "30m" },
	},
	{ event: "crm/contacts.updated", if: "event.data.full == true" },
	handleSync,
);`);
		expect(text).toBe(
			[
				'The Inngest function "sync-contacts", run whenever crm/contacts.updated is sent and event.data.full == true holds (shown as "Sync contacts"; at most 1 run at a time per event.data.accountId; at most 50 runs at a time per "openai" across the account; starting at most 1 run per 5 seconds per event.data.userId (bursts of 2), queueing the rest; ignoring events beyond 1 per 4 hours per event.data.companyId; waiting for 5 minutes without new events per event.data.accountId (at most 10 minutes), then running once with the latest; never retried; prioritized by event.data.plan == \'enterprise\' ? 120 : 0; taking events in batches of up to 100, waiting at most 5 seconds to fill one; running once per event.data.cartId in any 24 hours; one run at a time per event.data.userId, a new event cancelling the running one; cancelled if not started within 10 seconds; cancelled if not finished within 30 minutes):',
				"  • run handle sync",
			].join("\n"),
		);
	});

	test("cancelOn and onFailure", () => {
		expect(
			read(`${V3}export const remind = inngest.createFunction(
	{
		id: "reminder",
		cancelOn: [{ event: "tasks/deleted", match: "data.id", timeout: "1d" }],
		onFailure: async ({ error }) => {
			await alertTeam(error);
		},
	},
	{ event: "tasks/reminder.created" },
	async ({ step }) => {
		await step.sleepUntil("sleep-until-due", dueAt);
	},
);`),
		).toBe(
			[
				'Define the Inngest function "reminder" as remind, run whenever tasks/reminder.created is sent (cancelled if tasks/deleted arrives with the same data.id within 1 day):',
				'  Wait until due at (step "sleep-until-due").',
				"  If a run still fails after its last retry:",
				"    Alert team (error).",
			].join("\n"),
		);
	});
});

describe("steps", () => {
	const fn = (body: string) =>
		read(`${V3}export const f = inngest.createFunction({ id: "f" }, { event: "a/b" }, async ({ event, step }) => {\n${body}\n});`)
			.split("\n")
			.slice(1)
			.join("\n");

	test("step.run: block steps keep their lines; one-liners stay inline; results are named", () => {
		expect(
			fn(`const user = await step.run("load-user", async () => {
	return db.users.find(event.data.userId);
});
await step.run("charge", async () => {
	await stripe.charges.create({ amount: 100 });
	await audit("charged");
});`),
		).toBe(
			[
				"  Step \"load-user\": find DB's users (event's data's user ID), and call the result user.",
				'  Step "charge":',
				"    Create stripe's charges (amount: 100).",
				'    Run audit ("charged").',
			].join("\n"),
		);
	});

	test("waitForEvent says what it waits for, how long, and what happens on timeout", () => {
		expect(fn(`const paid = await step.waitForEvent("wait-for-payment", { event: "app/invoice.paid", match: "data.invoiceId", timeout: "7d" });`)).toBe(
			'  Wait for app/invoice.paid matching data.invoiceId, up to 7 days (step "wait-for-payment"), and call it paid (nothing if it never arrives).',
		);
		expect(fn(`await step.waitForEvent("wait", { event: "app/approved", if: "async.data.id == event.data.id", timeout: "1h30m" });`)).toBe(
			'  Wait for app/approved where async.data.id == event.data.id, up to 1 hour and 30 minutes (step "wait").',
		);
	});

	test("sendEvent, invoke, sleep", () => {
		expect(
			fn(`await step.sendEvent("fan-out", [
	{ name: "app/email.send", data: { to: a } },
	{ name: "app/sms.send", data: { to: b } },
]);
const square = await step.invoke("compute-square", { function: computeSquare, data: { number: 4 }, timeout: "1h" });
await step.sleep("pause", 5000);
throw new NonRetriableError("bad input");`),
		).toBe(
			[
				'  Send these events (step "fan-out"):',
				"    • the event app/email.send with the data to: a",
				"    • the event app/sms.send with the data to: b",
				'  Run the Inngest function compute square with the data number: 4 and wait for its result, up to 1 hour (step "compute-square"), and call the result square.',
				'  Wait 5 seconds (step "pause").',
				'  Fail with a non-retriable error (the run fails without retrying): "bad input".',
			].join("\n"),
		);
	});

	test("returning a step's result", () => {
		expect(fn(`return step.run("final", () => summarize(event.data));`)).toBe('  Step "final": summarize (event\'s data), and give back the result.');
	});
});

describe("events and serving", () => {
	test("inngest.send", () => {
		expect(read(`${V3}await inngest.send({ name: "app/user.created", data: { userId: "123" } });`)).toBe(
			'Send the event app/user.created with the data user ID: "123" to Inngest.',
		);
	});

	test("serve handlers per framework", () => {
		expect(read(`import { serve } from "inngest/next";\nexport const { GET, POST, PUT } = serve({ client: inngest, functions: [helloWorld] });`)).toBe(
			"Serve the Inngest functions hello world of inngest over HTTP (inngest/next), exported as the GET, POST, and PUT handlers.",
		);
		expect(read(`import { serve } from "inngest/express";\napp.use("/api/inngest", serve({ client: inngest, functions }));`)).toContain(
			"serve the Inngest functions in functions of inngest over HTTP (inngest/express)",
		);
	});
});

describe("stays out of the way", () => {
	test("files without Inngest read as before", () => {
		const code = `await step.run("x", () => go());\nres.send({ name: "a" });\nconst f = client.createFunction({ id: "x" }, handler);`;
		expect(narrate(code, { plugins })).toBe(narrate(code));
	});

	test("res.send and other serve functions are left alone", () => {
		const code = `${V3}import { serve } from "@hono/node-server";\nres.send({ name: "a", data: 1 });\nserve({ fetch: app.fetch });`;
		expect(narrate(code, { plugins })).toBe(narrate(code));
	});
});

describe("step IDs and computed durations", () => {
	test("{ id, name } step options read as the ID; computed timeouts are shown as written", () => {
		const text = read(`${V3}export const f = inngest.createFunction({ id: "f" }, { event: "a/b" }, async ({ step }) => {
	await step.run({ id: "fetch-user", name: "Fetch user" }, () => fetchUser());
	await step.waitForEvent("wait", { event: "app/approved", timeout: options.timeout ?? "1h" });
});`);
		expect(text).toContain('Step "fetch-user": fetch user.');
		expect(text).toContain('Wait for app/approved, up to options\' timeout, or "1h" if that\'s missing (step "wait").');
	});
});

describe("phrasebook", () => {
	test("rules take every word from the phrasebook", () => {
		const de: InngestPhrases = {
			...en,
			steps: { ...en.steps, sleep: ({ duration, id }) => `warte ${duration} (Schritt ${id})` },
			time: { ...en.time, amount: ({ n }) => `${n} Tag` },
		};
		const text = narrate(`${V3}inngest.createFunction({ id: "f" }, { event: "a/b" }, async ({ step }) => { await step.sleep("s", "1d"); });`, {
			plugins,
			locale: { ...english, plugins: { inngest: de } },
		});
		expect(text).toContain('Warte 1 Tag (Schritt "s").');
	});

	test("a complete translation has no gaps, and the plugin declares the versions it reads", () => {
		expect(phrasebookGaps(en, { ...en })).toEqual({ missing: [], extra: [] });
		expect(inngest().library).toEqual({ name: "inngest", versions: ">=3 <5" });
	});
});
