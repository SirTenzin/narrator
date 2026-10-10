import { describe, expect, test } from "bun:test";
import { narrate, narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { effect, en } from "../src";

const IMPORT = `import { Cause, Config, ConfigProvider, Deferred, Effect, Exit, Fiber, Layer, Match, Metric, Option, PubSub, Queue, Ref, Request, RequestResolver, Schedule, Schema, Stream, SubscriptionRef } from "effect"\n`;

function read(code: string, version?: 3 | 4) {
	const { text, fallbacks } = narrateWithStats(IMPORT + code, { plugins: [effect(version ? { version } : {})] });
	expect(fallbacks).toBe(0);
	return text;
}

describe("curried calls anywhere (engine curried rule keys)", () => {
	const text = read(`
const handlers = {
  getUser: Effect.fn("getUser")(function* (id: string) { return yield* Users }),
  parse: Schema.decodeUnknown(User)(input),
  layer: Layer.succeed(Db)({ query: () => Effect.succeed([]) }),
}`);
	test("Effect.fn inside an object literal, with its span", () =>
		expect(text).toContain(`  • get user: an effect function of ID that runs these steps:
    Traced as the span "getUser".
    Get the Users service, and give back the result.`));
	test("Schema.decodeUnknown(S)(x) inside an object literal", () => expect(text).toContain("  • parse: input, checked to be a user"));
	test("v4 Layer.succeed(Tag)(impl)", () => expect(text).toContain("  • layer: a layer that provides the Db service as an object with:"));
});

describe("yield* nested inside expressions", () => {
	const text = read(`
const p = Effect.gen(function* () {
  if (yield* isAdmin) { yield* Effect.log("admin") }
  const total = (yield* getA) + (yield* getB)
  if ((yield* Ref.get(counter)) > 10) yield* Effect.log("big")
  const db = (yield* Database).pipe(withRetries)
})`);
	test("as a condition", () => expect(text).toContain(`If is admin, log "admin".`));
	test("as operands", () => expect(text).toContain("Let total be the result of get a plus the result of get b."));
	test("an Effect call reads as its own value", () => expect(text).toContain(`If the current value of counter is more than 10, log "big".`));
	test("a yielded service", () => expect(text).toContain("Let DB be the Database service, then apply with retries."));
});

describe("Option.some is a value, not a yes/no check", () => {
	test("declaration, return and arrow body", () => {
		const text = read(`
const x = Option.some(1)
const wrap = (n: number) => Option.some(n)
function first(xs: number[]) { return Option.some(xs[0]) }`);
		expect(text).toContain("Let x be an Option holding 1.");
		expect(text).toContain("an Option holding n");
		expect(text).toContain("Give back an Option holding the first of xs.");
		expect(text).not.toContain("whether");
	});
	test("an array's .some(...) is still a check", () => expect(read(`const any = xs.some((x) => x > 1)`)).toContain("Let any mean"));
});

describe("bare Effect values (phrasebook constants)", () => {
	test("as values", () => {
		const text = read(`
const v = Effect.void
const n = Effect.never
const l = Layer.empty
const s = Stream.empty
const d = program.pipe(Effect.as(Effect.void))`);
		expect(text).toContain("Let v be an effect that does nothing.");
		expect(text).toContain("Let n be an effect that never finishes.");
		expect(text).toContain("Let l be an empty layer.");
		expect(text).toContain("Let s be an empty stream.");
	});
	test("as steps", () =>
		expect(read(`const p = Effect.gen(function* () { yield* Effect.void; yield* Effect.yieldNow() })`)).toContain(
			"Do nothing.\n  Let other fibers run first.",
		));
	test("constants are part of the phrasebook", () => expect(Object.keys(en.constants)).toContain("Effect.void"));
});

describe("tagged error construction keeps every field", () => {
	test("yielded, failed with, mapped to", () => {
		const text = read(`
class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.String, reason: Schema.String }) {}
const p = Effect.gen(function* () {
  if (!user) return yield* new NotFound({ id, reason: "deleted" })
})
const f = Effect.fail(new Unauthorized({ userId: user.id }))
const m = load.pipe(Effect.mapError((cause) => new LoadError({ cause, path })))
const err = new NotFound({ id: "1", reason: "gone" })`);
		expect(text).toContain(`If user is missing, fail with a not found error (ID and reason: "deleted").`);
		expect(text).toContain("Let f be an effect that fails with an unauthorized error (user ID: user's ID).");
		expect(text).toContain("if it fails, turn the error (cause) into a load error (cause and path)");
		expect(text).toContain(`Let error be a new not found (ID: "1" and reason: "gone").`);
	});
});

describe("Config and ConfigProvider", () => {
	test("v3 lower-case constructors, nesting and providers", () => {
		const text = read(
			`
const p = Effect.gen(function* () {
  const host = yield* Config.string("HOST").pipe(Config.withDefault("localhost"))
  const env = yield* Config.literal("dev", "prod")("APP_ENV")
  const hosts = yield* Config.array(Config.string(), "HOSTS")
  const db = yield* Config.all({ url: Config.redacted("DB_URL"), pool: Config.integer("DB_POOL") }).pipe(Config.nested("DB"))
})
const t = p.pipe(Effect.withConfigProvider(ConfigProvider.fromJson({ HOST: "example.com" })))`,
			3,
		);
		expect(text).toContain(`Read the HOST setting (text), then use "localhost" if it isn't set, and call the result host.`);
		expect(text).toContain(`Read the APP_ENV setting (one of "dev" or "prod"), and call the result env.`);
		expect(text).toContain("Read the HOSTS setting (a list where each item is text), and call the result hosts.");
		expect(text).toContain(`    1. Read these settings together:
      • URL: the DB_URL setting (secret)
      • pool: the DB_POOL setting (a whole number)
    2. Look it up under DB`);
		expect(text).toContain(`Let t be p, then take its settings from the settings in an object with host: "example.com".`);
	});
	test("v4 PascalCase constructors and Config.schema", () => {
		const text = read(
			`
const port = Config.Port("PORT")
const level = Config.Literals(["debug", "info"], "LOG_LEVEL")
const limits = Config.schema(Schema.Struct({ max: Schema.Int }), "LIMITS")
const live = ConfigProvider.layer(ConfigProvider.fromUnknown(defaults))`,
			4,
		);
		expect(text).toContain("Let port be the PORT setting (a port number).");
		expect(text).toContain(`Let level be the LOG_LEVEL setting (one of "debug" or "info").`);
		expect(text).toContain("Let limits be the LIMITS setting (an object with max (a whole number)).");
		expect(text).toContain("Let live be a layer that makes everything read its settings from the settings in defaults.");
	});
	test("pinned versions keep each other's names out", () => {
		expect(read(`const port = Config.Port("PORT")`, 3)).not.toContain("setting");
		expect(read(`const host = Config.string("HOST")`, 4)).not.toContain("setting");
	});
});

describe("Ref, SynchronizedRef, SubscriptionRef", () => {
	test("make / update / get-and-set / changes", () => {
		const text = read(
			`
const p = Effect.gen(function* () {
  const n = yield* Ref.updateAndGet(counter, (x) => x + 1)
  const old = yield* Ref.getAndSet(counter, 0)
  yield* SynchronizedRef.updateEffect(cache, (c) => refresh(c))
  const watched = yield* SubscriptionRef.make(0)
  const latest = yield* watched
})
const changes = SubscriptionRef.changes(watched)`,
			3,
		);
		expect(text).toContain("Update counter to x plus 1, getting back the new value, and call the result n.");
		expect(text).toContain("Set counter to 0, getting back its old value, and call the result old.");
		expect(text).toContain("Update cache by running: refresh (c).");
		expect(text).toContain("Create a mutable reference others can watch for changes, starting at 0, and call the result watched.");
		expect(text).toContain("Read the current value of watched, and call the result latest.");
		expect(text).toContain("Let changes be a stream of every value watched takes.");
	});
});

describe("Queue, PubSub, Deferred", () => {
	const text = read(
		`
const p = Effect.gen(function* () {
  const q = yield* Queue.bounded<number>(100)
  yield* Queue.offer(q, 1)
  const item = yield* Queue.take(q)
  const next = yield* q
  const hub = yield* PubSub.unbounded<string>()
  yield* PubSub.publish(hub, "hello")
  const sub = yield* PubSub.subscribe(hub)
  const done = yield* Deferred.make<string>()
  yield* Deferred.succeed(done, "ok")
  const v = yield* Deferred.await(done)
  if (yield* Deferred.isDone(done)) yield* Effect.log("ready")
})`,
		3,
	);
	test("queue", () => {
		expect(text).toContain("Create a queue holding up to 100 items, and call the result q.");
		expect(text).toContain("Add 1 to q.");
		expect(text).toContain("Take the next item from q, waiting if it's empty, and call the result item.");
		expect(text).toContain("Take the next item from q, waiting if it's empty, and call the result next.");
	});
	test("pub/sub", () => {
		expect(text).toContain("Create a pub/sub hub with no size limit, and call the result hub.");
		expect(text).toContain(`Publish "hello" to hub.`);
		expect(text).toContain("Subscribe to hub, and call the result subscription.");
	});
	test("deferred", () => {
		expect(text).toContain("Create a value to be filled in later, and call the result done.");
		expect(text).toContain(`Fill in done with "ok".`);
		expect(text).toContain("Wait for done to be filled in, and call the result v.");
		expect(text).toContain(`If done is filled in, log "ready".`);
	});
});

describe("fibers, races, interruption", () => {
	test("Fiber ops and races", () => {
		const text = read(
			`
const p = Effect.gen(function* () {
  const f = yield* Effect.fork(task)
  const exit = yield* Fiber.await(f)
  yield* Fiber.interruptAll([f, g])
  const winner = yield* Effect.race(fetchA, fetchB)
})
const guarded = job.pipe(Effect.uninterruptible, Effect.onInterrupt(() => Effect.log("stopped")), Effect.race(timeoutAfter))`,
			3,
		);
		expect(text).toContain("Wait for f to end, whatever happens, and call the result exit.");
		expect(text).toContain("Stop all of f and g.");
		expect(text).toContain("Run these at once and keep whichever finishes first, and call the result winner:\n    • run fetch a\n    • run fetch b");
		expect(text).toContain(`  2. Don't let it be interrupted
  3. If it's interrupted, log "stopped"
  4. Race it against timeout after, keeping whichever finishes first`);
	});
});

describe("batched requests", () => {
	test("Request.tagged, resolvers, Effect.request", () => {
		const text = read(
			`
const GetUserById = Request.tagged<GetUserById>("GetUserById")
const UserResolver = RequestResolver.makeBatched((requests: GetUserById[]) => loadUsers(requests))
const OneByOne = RequestResolver.fromEffect((req: GetUserById) => fetchUser(req.id))
const getUser = (id: number) => Effect.request(GetUserById({ id }), UserResolver)`,
			3,
		);
		expect(text).toContain(`Let get user by ID be a request type tagged "GetUserById".`);
		expect(text).toContain("Let user resolver be a resolver that answers requests in batches (call each batch requests) by: load users (requests).");
		expect(text).toContain("Let one by one be a resolver that answers each request (request) by: fetch user (request's ID).");
		expect(text).toContain("the answer to get user by ID (ID), fetched through user resolver");
	});
	test("v4 RequestResolver.make is batched", () =>
		expect(read(`const R = RequestResolver.make((entries) => complete(entries))`, 4)).toContain(
			"a resolver that answers requests in batches (call each batch entries) by: run complete (entries)",
		));
});

describe("Match", () => {
	test("Match.type with when / tag / refinements / orElse", () => {
		expect(
			read(`
const area = Match.type<Shape>().pipe(
  Match.when({ _tag: "Circle" }, (c) => c.radius),
  Match.tag("Square", "Rect", (s) => s.width),
  Match.when(Match.string, (s) => s.length),
  Match.orElse(() => 0),
)`),
		).toBe(`Let area be a function that picks one of these, depending on its input:
  • if its tag is "Circle" (call it c): c's radius
  • if its tag is "Square" or "Rect" (call it s): s' width
  • if it's text (call it s): the number of s
  • otherwise: 0`);
	});
	test("Match.value with predicates and exhaustive", () =>
		expect(
			read(`const label = Match.value(status).pipe(Match.when("active", () => "On"), Match.when((s) => s.startsWith("x"), () => "X"), Match.exhaustive)`),
		).toBe(
			`Let label be one of these, depending on status (every case is covered):
  • if it's "active": "On"
  • if s starts with "x": "X"`,
		));
	test("Match.tagsExhaustive", () =>
		expect(read(`const f = Match.type<Event>().pipe(Match.tagsExhaustive({ Created: (e) => e.id, Deleted: () => null }))`)).toContain(`(every case is covered):
  • if its tag is "Created" (call it e): e's ID
  • if its tag is "Deleted": nothing`));
});

describe("metrics, spans, Cause and Exit", () => {
	test("v3 metrics and Effect.fn spans", () => {
		const text = read(
			`
const requests = Metric.counter("http_requests", { description: "Total requests" })
export const getUser = Effect.fn("UserRepo.getUser")(function* (id: string) {
  yield* Effect.annotateCurrentSpan("userId", id)
  yield* Metric.increment(requests)
  return yield* Users.find(id)
})
const timed = program.pipe(Metric.trackDuration(latency), Metric.tagged("route", "/users"))`,
			3,
		);
		expect(text).toContain(`Let requests be a counter named "http_requests".`);
		expect(text).toContain(`Add "userId": ID to the current trace span.`);
		expect(text).toContain("Add 1 to requests.");
		expect(text).toContain(`To get user, given ID:\n  Traced as the span "UserRepo.getUser".`);
		expect(text).toContain(`  2. Record how long it takes in latency\n  3. Tag its metrics with "route": "/users"`);
	});
	test("v4 metrics", () => {
		const text = read(`const t = program.pipe(Effect.trackDuration(latency))\nconst u = Metric.update(requests, 1)`, 4);
		expect(text).toContain("Let t be program, then record how long it takes in latency.");
		expect(text).toContain("Let u be record 1 in requests.");
	});
	test("Cause and Exit", () => {
		const text = read(`
const handled = program.pipe(Effect.catchAllCause((cause) => Effect.logError(Cause.pretty(cause))))
if (Cause.isInterruptedOnly(cause)) console.log("cancelled")
const e = Exit.fail(new Timeout({ after: 5 }))`);
		expect(text).toContain("if it fails or crashes (call the cause cause), log a readable description of cause as an error");
		expect(text).toContain(`If cause was only an interruption, log "cancelled".`);
		expect(text).toContain("Let e be a failed exit holding a timeout error (after: 5).");
	});
});

describe("services and layers", () => {
	test("Effect.Service with dependencies and accessors; .Default layers by name", () => {
		const text = read(
			`
class Users extends Effect.Service<Users>()("Users", {
  succeed: { find: (id: string) => Effect.succeed(id) },
  dependencies: [Db.Default],
  accessors: true,
}) {}
const AppLive = Layer.mergeAll(Users.Default, Logger.layer, Layer.effectDiscard(Effect.log("booted")))
const main = program.pipe(Effect.provide(Users.Default))`,
			3,
		);
		expect(text).toContain("  Needs the default Db layer.\n  Its methods can be called straight on Users, without getting the service first.");
		expect(text).toContain(
			`Let app live be a layer combining the default Users layer, the Logger layer, and a layer that runs an effect that logs "booted" when it's built, providing nothing.`,
		);
		expect(text).toContain("Let main be program, then provide the default Users layer.");
	});
	test("Layer.unwrapEffect (v3) / Layer.unwrap (v4), Layer.fresh", () => {
		expect(read(`const L = Layer.unwrapEffect(makeLayer)`, 3)).toContain("Let L be the layer built by running make layer.");
		expect(read(`const L = Layer.unwrap(makeLayer)`, 4)).toContain("Let L be the layer built by running make layer.");
		expect(read(`const L = Layer.fresh(DbLive)`)).toContain("Let L be a fresh copy of DB live, not shared with other users.");
	});
});

describe("Schema transformations, brands, filters", () => {
	test("brand, filter message, transform, parseJson, TaggedStruct, pick", () => {
		const text = read(`
const Password = Schema.String.pipe(Schema.minLength(8), Schema.brand("Password"))
const Form = Schema.Struct({ a: Schema.String, b: Schema.String }).pipe(Schema.filter((f) => f.a === f.b, { message: () => "Passwords must match" }))
const Created = Schema.transform(Schema.String, Schema.DateFromSelf, { decode: (s) => new Date(s), encode: (d) => d.toISOString() })
const Payload = Schema.parseJson(Schema.Struct({ id: Schema.Number }))
const Shape = Schema.TaggedStruct("Circle", { radius: Schema.Number })
const Public = Schema.Struct({ id: Schema.Number, name: Schema.String, secret: Schema.String }).pipe(Schema.pick("id", "name"))`);
		expect(text).toContain(`Let password be a schema for text, at least 8 characters and branded as "Password".`);
		expect(text).toContain(`Let form be a schema for an object with a (text) and b (text), with an extra check ("Passwords must match").`);
		expect(text).toContain("Let created be a schema for a date, converted from text.");
		expect(text).toContain("Let payload be a schema for an object with ID (a number), written as JSON text.");
		expect(text).toContain(`Let shape be a schema for an object tagged "Circle", with radius (a number).`);
		expect(text).toContain("keeping only ID and name");
	});
	test("v4 decodeTo and fromJsonString", () => {
		const text = read(
			`const D = Schema.String.pipe(Schema.decodeTo(Schema.Number, numberFromString))\nconst J = Schema.fromJsonString(Schema.Struct({ ok: Schema.Boolean }))`,
			4,
		);
		expect(text).toContain("Let D be a schema for a number, converted from text.");
		expect(text).toContain("Let J be a schema for an object with ok (true or false), written as JSON text.");
	});
});

describe("Stream ops", () => {
	test("batching, timing and text pipelines", () => {
		const text = read(`
const batches = events.pipe(
  Stream.groupedWithin(100, "1 second"),
  Stream.debounce("200 millis"),
  Stream.throttle({ cost: () => 1, units: 10, duration: "1 second" }),
  Stream.takeWhile((e) => e.ok),
  Stream.zipWithIndex,
  Stream.retry(Schedule.spaced("5 seconds")),
  Stream.runForEach((batch) => save(batch)),
)
const lines = Stream.fromQueue(q).pipe(Stream.decodeText, Stream.splitLines, Stream.runCollect)`);
		expect(text).toContain(`  2. Group the items into batches of up to 100, or whatever arrived within 1 second
  3. Wait for 200 millis of quiet, then pass on only the latest item
  4. Let through at most 10 items every 1 second
  5. Take items as long as e's ok is set
  6. Pair each item with its position
  7. If it fails, restart it every 5 seconds
  8. For each item (batch), save (batch)`);
		expect(text).toContain(`  1. Start with a stream of the items taken from q
  2. Decode the bytes as text
  3. Split the text into lines
  4. Collect every item into a list`);
	});
});

describe("guards: only Effect's own modules", () => {
	test("a Queue from another library is left alone", () => {
		const code = `import { Effect } from "effect"\nimport { Queue } from "bullmq"\nconst q = Queue.bounded(10)\nconst m = Match.value(x)`;
		expect(narrate(code, { plugins: [effect()] })).toBe(narrate(code));
	});
	test("files that don't import Effect are untouched", () => {
		const code = `const r = Ref.make(0)\nconst q = Queue.offer(queue, 1)\nconst c = Config.string("HOST")\nconst x = Option.some(1)\nconst t = (yield_ as any)`;
		expect(narrate(code, { plugins: [effect()] })).toBe(narrate(code));
	});
	test("English is complete", () => expect(phrasebookGaps(en, en)).toEqual({ missing: [], extra: [] }));
});
