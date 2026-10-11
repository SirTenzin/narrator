import { describe, expect, test } from "bun:test";
import { en as english } from "@usenarrator/locale-en";
import { narrate, narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { type EffectPhrases, effect, en } from "../src";

const IMPORT = `import { Config, Context, Data, Duration, Effect, Either, Layer, Option, Result, Schedule, Schema, Stream } from "effect"\n`;

/** Narrates with the Effect plugin and asserts nothing fell back to raw code. */
function read(code: string, version?: 3 | 4) {
	const { text, fallbacks } = narrateWithStats(IMPORT + code, { plugins: [effect(version ? { version } : {})] });
	expect(fallbacks).toBe(0);
	return text;
}

describe("Effect.gen reads each yield* as a step", () => {
	const text = read(`
const program = Effect.gen(function* () {
  const db = yield* Database
  const rows = yield* db.query("select * from users")
  const { id, name } = yield* loadProfile
  if (rows.length === 0) return yield* new UserNotFound({ id: "1" })
  yield* Effect.log("loaded", rows.length)
  yield* Effect.sleep("1 second")
  return yield* summarize(rows)
})`);

	test("service access", () => expect(text).toContain("Get the Database service, and call it DB."));
	test("run and name the result", () => expect(text).toContain(`Query DB ("select * from users"), and call the result rows.`));
	test("destructured results", () => expect(text).toContain("Run load profile, and take its ID and name."));
	test("yielding an error fails", () => expect(text).toContain('If rows are empty, fail with a user not found error (ID: "1").'));
	test("log and sleep", () => {
		expect(text).toContain(`Log "loaded" and the number of rows.`);
		expect(text).toContain("Wait 1 second.");
	});
	test("return yield*", () => expect(text).toContain("Summarize (rows), and give back the result."));
	test("gen header", () => expect(text).toContain("Let program be an effect that runs these steps:"));
});

describe("pipe chains read as numbered steps", () => {
	test(".pipe with a block subject", () => {
		const text = read(`
const fetchUser = Effect.gen(function* () {
  return yield* Users
}).pipe(
  Effect.retry(Schedule.exponential("100 millis").pipe(Schedule.compose(Schedule.recurs(3)), Schedule.jittered)),
  Effect.timeout("5 seconds"),
  Effect.catchTag("UserNotFound", () => Effect.succeed(null)),
  Effect.tap((user) => Effect.log(user)),
)`);
		expect(text).toBe(`Let fetch user be the result of these steps:
  1. Start with an effect that runs these steps:
    Get the Users service, and give back the result.
  2. Retry with exponential backoff starting at 100 millis, up to 3 times, and with random jitter
  3. Give up if it takes longer than 5 seconds
  4. If it fails with "UserNotFound", succeed with nothing
  5. With the result (user), also log user`);
	});

	test("one simple step reads inline", () => {
		expect(read(`const main = program.pipe(Effect.provide(MainLive))`)).toContain("Let main be program, then provide main live.");
	});

	test("pipe() function form and data-first combinators", () => {
		const text = read(`
const a = pipe(Effect.succeed(5), Effect.map((x) => x + 1), Effect.delay(Duration.seconds(2)))
const b = Effect.map(loadUser, (user) => user.email)`);
		expect(text).toContain("1. Start with an effect that succeeds with 5");
		expect(text).toContain("2. Turn the result (x) into x plus 1");
		expect(text).toContain("3. Wait 2 seconds before starting");
		expect(text).toContain("Let b be load user, then turn the result (user) into user's email.");
	});

	test("files that don't import Effect keep their own .pipe narration", () => {
		const code = `const out = stream.pipe(transform)`;
		expect(narrate(code, { plugins: [effect()] })).toBe(narrate(code));
	});
});

describe("constructors", () => {
	test("succeed / fail / sync / promise / tryPromise / try", () => {
		const text = read(`
const a = Effect.succeed(42)
const b = Effect.fail(new NotFound())
const c = Effect.sync(() => Date.now())
const d = Effect.promise(() => fetch(url))
const e = Effect.tryPromise({ try: () => fetch(url), catch: (cause) => new FetchError({ cause }) })
const f = Effect.try(() => JSON.parse(raw))`);
		expect(text).toContain("Let a be an effect that succeeds with 42.");
		expect(text).toContain("Let b be an effect that fails with a not found error.");
		expect(text).toContain("Let c be an effect that computes the current time.");
		expect(text).toContain("Let d be an effect that waits for fetch (URL).");
		expect(text).toContain("Let e be an effect that waits for fetch (URL), turning any failure into a fetch error (cause).");
		expect(text).toContain("Let f be an effect that tries to compute raw parsed from JSON.");
	});

	test("Effect.all and Effect.forEach with concurrency", () => {
		const text = read(`
const both = Effect.all([getA, getB])
const fast = Effect.all({ user: getUser, posts: getPosts }, { concurrency: "unbounded" })
const users = Effect.forEach(ids, (id) => getUser(id), { concurrency: 5 })`);
		expect(text).toContain("Let both be all of these, one after another:\n  • run get a\n  • run get b");
		expect(text).toContain("Let fast be all of these, all at the same time:\n  • user: run get user\n  • posts: run get posts");
		expect(text).toContain("Let users be the results of doing this for each ID in IDs, up to 5 at a time:\n  Get user (ID).");
	});

	test("yield* Effect.all into an array pattern", () => {
		const text = read(`const p = Effect.gen(function* () {
  const [a, b] = yield* Effect.all([getA(), getB()], { concurrency: 2 })
})`);
		expect(text).toContain("Run all of these, up to 2 at a time, and call the results a and b:");
	});
});

describe("error handling", () => {
	test("catchTags, catchAll, tapError, mapError, orElse, either", () => {
		const text = read(
			`
const handled = fetchUser.pipe(
  Effect.catchTags({ NotFound: () => Effect.succeed(null), Timeout: (e) => Effect.fail(e) }),
  Effect.tapError((err) => Effect.logError(err)),
  Effect.mapError((err) => new ApiError({ cause: err })),
  Effect.orElse(() => fallback),
  Effect.catchAll((err) => Effect.logError("failed", err)),
  Effect.either,
)`,
			3,
		);
		expect(text).toContain(`2. Handle each kind of failure:
    • if it fails with "NotFound", succeed with nothing
    • if it fails with "Timeout" (call it e), fail with e`);
		expect(text).toContain("3. If it fails (call the error error), also log error as an error");
		expect(text).toContain("4. If it fails, turn the error (error) into an API error");
		expect(text).toContain("5. If it fails, run fallback instead");
		expect(text).toContain(`6. If it fails (call the error error), log "failed" and error as an error`);
		expect(text).toContain("7. Capture success or failure as an Either");
	});

	test("Effect.catch means catch-all in v4", () => {
		const code = `const safe = load.pipe(Effect.catch((error) => Effect.succeed(0)))`;
		expect(read(code, 4)).toContain("Let safe be load, then if it fails, succeed with 0.");
		expect(read(code)).toContain("Let safe be load, then if it fails, succeed with 0.");
	});

	test("Effect.catch is the discriminator form in v3", () => {
		const code = `const safe = Effect.catch(load, "_tag", { failure: "NotFound", onFailure: () => Effect.succeed(0) })`;
		expect(read(code, 3)).toContain(`Let safe be load, then if it fails with "NotFound", succeed with 0.`);
		expect(read(code)).toContain(`Let safe be load, then if it fails with "NotFound", succeed with 0.`);
	});

	test("v3-only names are left alone when pinned to v4", () => {
		const code = `const x = load.pipe(Effect.catchAll(() => Effect.succeed(0)))`;
		expect(read(code, 3)).toContain("if it fails, succeed with 0");
		expect(read(code, 4)).not.toContain("if it fails, succeed with 0");
	});
});

describe("running effects", () => {
	test("runPromise / runSync / runFork / runMain", () => {
		const text = read(`
Effect.runPromise(program).then(console.log)
const n = Effect.runSync(Effect.succeed(1))
Effect.runFork(main)
NodeRuntime.runMain(main)
program.pipe(Effect.provide(AppLive), Effect.runPromise)`);
		expect(text).toContain("a promise of what program produces");
		expect(text).toContain("Let n be the result of running an effect that succeeds with 1 right away.");
		expect(text).toContain("Start main in the background.");
		expect(text).toContain("Run main as the main program.");
		expect(text).toContain("3. Run it and get a promise of its result");
	});
});

describe("layers and services", () => {
	test("v3 Context.Tag, Effect.Service and Layer constructors", () => {
		const text = read(
			`
class Database extends Context.Tag("Database")<Database, { readonly query: (sql: string) => Effect.Effect<unknown[]>; readonly close: Effect.Effect<void> }>() {}
class Cache extends Effect.Service<Cache>()("Cache", {
  effect: Effect.gen(function* () {
    const ttl = yield* Config.integer("CACHE_TTL")
    return { ttl }
  }),
  dependencies: [Redis.Default],
}) {}
const DbLive = Layer.succeed(Database, { query: () => Effect.succeed([]) })
const PoolLive = Layer.scoped(Pool, makePool)
const AppLive = Layer.merge(DbLive, PoolLive).pipe(Layer.provide(ConfigLive))`,
			3,
		);
		expect(text).toContain("Service Database, offering query and close.");
		expect(text).toContain(`Service Cache:
  Built by an effect that runs these steps:
    Read the CACHE_TTL setting (a whole number), and call the result TTL.
    Give back an object with TTL.
  Needs the default Redis layer.`);
		expect(text).toContain(
			"Let DB live be a layer that provides the Database service as an object with:\n  • query: a function giving back an effect that succeeds with an empty list",
		);
		expect(text).toContain("Let pool live be a layer that provides the Pool service, built by make pool and cleaned up when the layer shuts down.");
		expect(text).toContain("Let app live be a layer combining DB live and pool live, then feed in config live to satisfy its dependencies.");
	});

	test("v4 Context.Service with make, Layer.effect(this, this.make) and use", () => {
		const text = read(
			`
class Users extends Context.Service<Users, { readonly find: (id: string) => Effect.Effect<User> }>()("Users") {
  static readonly layer = Layer.effect(this, this.make)
}
class Logger extends Context.Service<Logger>()("Logger", {
  make: Effect.succeed({ log: (msg: string) => Effect.log(msg) }),
}) {}
const DbTag = Context.Service<Db>("Db")
const found = Users.use((users) => users.find("1"))`,
			4,
		);
		expect(text).toContain("Service Users, offering find:\n  Field layer starts as a layer that provides the Users service, built by its make effect.");
		expect(text).toContain("Service Logger:\n  Built by an effect that succeeds with an object with log");
		expect(text).toContain(`Let DB tag be a service named "Db".`);
		expect(text).toContain(`Let found be the result of using the Users service (as users) to find users ("1").`);
	});

	test("provideService", () => {
		expect(read(`const p = program.pipe(Effect.provideService(Random, fixedRandom))`)).toContain("program, then provide fixed random as the Random service");
	});
});

describe("Effect.fn", () => {
	test("declaration reads like a function, with its pipeline after", () => {
		const text = read(`
export const getUser = Effect.fn("getUser")(function* (id: string) {
  const users = yield* Users
  return yield* users.find(id)
}, Effect.withSpan("users.get"), Effect.timeout(Duration.seconds(3)))`);
		expect(text).toBe(`To get user, given ID:
  Get the Users service, and call it users.
  Find users (ID), and give back the result.
  Then apply these steps to the whole thing:
    1. Trace it as the span "users.get"
    2. Give up if it takes longer than 3 seconds`);
	});
});

describe("errors and data", () => {
	test("Data.TaggedError and yielding it", () => {
		const text = read(`
class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string; readonly hint?: string }> {}
const find = Effect.gen(function* () {
  return yield* new NotFound({ id: "x" })
})`);
		expect(text).toContain("Error type NotFound, carrying ID (text) and hint (text, optional).");
		expect(text).toContain(`Fail with a not found error (ID: "x").`);
	});

	test("Schema.TaggedError (v3) and Schema.TaggedErrorClass (v4)", () => {
		expect(read(`class HttpError extends Schema.TaggedError<HttpError>()("HttpError", { status: Schema.Number }) {}`, 3)).toContain(
			"Error type HttpError, carrying status (a number).",
		);
		expect(read(`class HttpError extends Schema.TaggedErrorClass<HttpError>()("HttpError", { status: Schema.Number }) {}`, 4)).toContain(
			"Error type HttpError, carrying status (a number).",
		);
	});

	test("Option, Either and Result basics", () => {
		const text = read(`
const label = Option.match(maybeUser, { onNone: () => "guest", onSome: (u) => u.name })
const some = Option.some(1)
const none = Option.none()
const name = Option.getOrElse(maybeName, () => "anon")
if (Option.isSome(maybeUser)) console.log("hi")
const r = Either.right(1)
const ok = Result.succeed(42)
if (Result.isFailure(ok)) console.log("bad")`);
		expect(text).toContain(`Let label be one of these, depending on maybe user:
  • if it's empty: "guest"
  • if it has a value (call it u): u's name`);
		expect(text).toContain("Let some be an Option holding 1.");
		expect(text).toContain("Let none be an empty Option.");
		expect(text).toContain(`Let name be maybe name, then use "anon" if it's empty.`);
		expect(text).toContain("If maybe user has a value, log");
		expect(text).toContain("Let r be a success (Right) holding 1.");
		expect(text).toContain("Let ok be a successful Result holding 42.");
		expect(text).toContain("If ok failed, log");
	});
});

describe("Schema", () => {
	test("Struct with optional fields and checks (v3 pipe style)", () => {
		const text = read(`
const User = Schema.Struct({
  id: Schema.Number.pipe(Schema.int(), Schema.positive()),
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(50)),
  role: Schema.Literal("admin", "member"),
  tags: Schema.Array(Schema.String),
  email: Schema.optional(Schema.String),
})`);
		expect(text).toBe(
			`Let user be a schema for an object with ID (a number, whole and positive), name (text, at least 1 character and at most 50 characters), role (one of "admin" or "member"), tags (a list where each item is text), and email (text, optional).`,
		);
	});

	test("v4 check style, Literals, Union of an array", () => {
		const text = read(
			`
const Age = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 150 }))
const Color = Schema.Literals(["red", "green"])
const Id = Schema.Union([Schema.String, Schema.Number])`,
			4,
		);
		expect(text).toContain("Let age be a schema for a number, whole and between 0 and 150.");
		expect(text).toContain(`Let color be a schema for one of "red" or "green".`);
		expect(text).toContain("Let ID be a schema for either text or a number.");
	});

	test("Schema.Date depends on the version", () => {
		const code = `const When = Schema.Struct({ at: Schema.Date })`;
		expect(read(code, 3)).toContain("at (a date written as text)");
		expect(read(code, 4)).toContain("at (a date)");
	});

	test("Schema.Class and decoding", () => {
		const text = read(`
class Person extends Schema.Class<Person>("Person")({ name: Schema.String, age: Schema.NullOr(Schema.Number) }) {}
const parse = Effect.gen(function* () {
  const person = yield* Schema.decodeUnknown(Person)(body)
  const strict = Schema.decodeUnknownSync(Person)(raw)
})
const check = Schema.decodeUnknown(Person)`);
		expect(text).toContain("Schema class Person, with name (text) and age (a number, or null).");
		expect(text).toContain("Check that body is a person, and call the result person.");
		expect(text).toContain("Let strict be raw, checked to be a person (throwing if it isn't).");
		expect(text).toContain("Let check be a checker for a person.");
	});
});

describe("Stream", () => {
	test("constructors, steps and sinks", () => {
		const text = read(`
const evens = Stream.range(1, 10).pipe(
  Stream.map((n) => n * 2),
  Stream.filter((n) => n > 5),
  Stream.mapEffect((n) => save(n), { concurrency: 4 }),
  Stream.take(3),
  Stream.runCollect,
)
const s = Stream.make(1, 2, 3)`);
		expect(text).toContain(`Let evens be the result of these steps:
  1. Start with a stream of the numbers from 1 to 10
  2. Turn each item (n) into n times 2
  3. Keep only the items (n) where n is more than 5
  4. For each item (n), save (n) (up to 4 at a time)
  5. Take the first 3 items
  6. Collect every item into a list`);
		expect(text).toContain("Let s be a stream of 1, 2, and 3.");
	});
});

describe("Scope and resources", () => {
	test("acquireRelease, addFinalizer and scoped", () => {
		const text = read(`
const conn = Effect.acquireRelease(Effect.promise(() => connect()), (c) => Effect.sync(() => c.close()))
const job = Effect.gen(function* () {
  yield* Effect.addFinalizer(() => Effect.log("bye"))
  const c = yield* conn
}).pipe(Effect.scoped)`);
		expect(text).toContain(`Let conn be a scoped resource:
  • to acquire: wait for connect
  • when the scope closes: close c`);
		expect(text).toContain(`When the scope closes, log "bye".`);
		expect(text).toContain("Run it in its own scope, releasing its resources when done");
	});
});

describe("Schedule", () => {
	test("standalone schedules and retry options", () => {
		const text = read(`
const policy = Schedule.spaced("1 second")
const backoff = Schedule.exponential(Duration.millis(50), 2)
const r = task.pipe(Effect.retry({ times: 3, while: (e) => e._tag === "Timeout" }))
const rep = task.pipe(Effect.repeat(Schedule.recurs(5)))`);
		expect(text).toContain("Let policy be a schedule that runs every 1 second.");
		expect(text).toContain("Let backoff be a schedule that runs with exponential backoff starting at 50 milliseconds, growing 2× each time.");
		expect(text).toContain(`Let r be task, then retry up to 3 times and as long as e's tag is "Timeout".`);
		expect(text).toContain("Let rep be task, then repeat up to 5 times.");
	});
});

describe("versions", () => {
	test("v3 fibers and refs are yieldable; v4 forkChild + Fiber.join", () => {
		const v3 = read(
			`const p = Effect.gen(function* () {
  const fiber = yield* Effect.fork(task)
  const value = yield* fiber
  const count = yield* Ref.make(0)
  const now = yield* count
})`,
			3,
		);
		expect(v3).toContain("Start task in the background, and call the result fiber.");
		expect(v3).toContain("Wait for fiber to finish, and call the result value.");
		expect(v3).toContain("Read the current value of count, and call the result now.");
		const v4 = read(
			`const p = Effect.gen(function* () {
  const fiber = yield* Effect.forkChild(task)
  const value = yield* Fiber.join(fiber)
})`,
			4,
		);
		expect(v4).toContain("Start task in the background, and call the result fiber.");
		expect(v4).toContain("Wait for fiber to finish, and call the result value.");
	});
});

describe("phrasebook", () => {
	test("a locale can replace the plugin's English without touching rules", () => {
		const es: EffectPhrases = { ...en, yield: { ...en.yield, bindService: ({ service, name }) => `obtén el servicio ${service} y llámalo ${name}` } };
		const text = narrate(`${IMPORT}const p = Effect.gen(function* () { const db = yield* Database })`, {
			plugins: [effect()],
			locale: { ...english, plugins: { effect: es } },
		});
		expect(text).toContain("Obtén el servicio Database y llámalo DB.");
	});

	test("English is the complete reference phrasebook", () => {
		expect(phrasebookGaps(en, en)).toEqual({ missing: [], extra: [] });
	});
});
