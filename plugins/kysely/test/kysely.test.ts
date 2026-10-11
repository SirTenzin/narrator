import { describe, expect, test } from "bun:test";
import { narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { en, kysely } from "../src";

const IMPORT = `import { Kysely, sql } from "kysely";\n`;

/** Narrates a snippet (with the Kysely import) and asserts nothing fell back to raw code. */
const say = (code: string) => {
	const { text, fallbacks } = narrateWithStats(IMPORT + code, { plugins: [kysely()] });
	expect(fallbacks).toBe(0);
	return text;
};

describe("select", () => {
	test("executeTakeFirst with a three-argument where", () => {
		expect(say(`const person = await db.selectFrom("person").select(["id", "first_name"]).where("id", "=", id).executeTakeFirst();`)).toBe(
			["Let person be the first row we get when we look up ID and first name from person:", "  • where ID is ID"].join("\n"),
		);
	});

	test("joins, expression builder, ordering and limits", () => {
		expect(
			say(`const rows = await db
  .selectFrom("person")
  .innerJoin("pet", "pet.owner_id", "person.id")
  .select(["person.id", "pet.name as pet_name"])
  .where((eb) => eb.or([eb("first_name", "=", "Jennifer"), eb("last_name", "like", "%ston")]))
  .where("age", ">=", 18)
  .orderBy("created_at", "desc")
  .orderBy("id")
  .limit(10)
  .execute();`),
		).toBe(
			[
				"Let rows be look up person's ID and pet's name, named pet name from person:",
				"  • joined with pet on pet's owner ID is person's ID",
				"  • where any of these is true:",
				`    • first name is "Jennifer"`,
				`    • last name ends with "ston"`,
				"  • where age is at least 18",
				"  • sorted by created at (newest first) and ID",
				"  • at most 10 row(s)",
			].join("\n"),
		);
	});

	test("callback joins, left joins and destructured builders", () => {
		expect(
			say(
				`const rows = await db.selectFrom("person").leftJoin("pet", (join) => join.onRef("pet.owner_id", "=", "person.id").on("pet.name", "=", "Doggo")).selectAll("person").where(({ or, eb }) => or([eb("age", "<", 18), eb("age", ">", 65)])).execute();`,
			),
		).toBe(
			[
				"Let rows be look up every column of person from person:",
				"  • joined with pet where:",
				"    • pet's owner ID is person's ID",
				`    • pet's name is "Doggo"`,
				"  • where any of these is true:",
				"    • age is less than 18",
				"    • age is more than 65",
			].join("\n"),
		);
	});

	test("aggregates, groupBy and having", () => {
		expect(
			say(
				`const counts = await db.selectFrom("pet").select((eb) => ["owner_id", eb.fn.count("id").as("pet_count")]).groupBy("owner_id").having((eb) => eb.fn.count("id"), ">", 2).execute();`,
			),
		).toBe(
			[
				"Let counts be look up owner ID and the number of rows with ID set, named pet count from pet:",
				"  • grouped by owner ID",
				"  • keeping only groups where the number of rows with ID set is more than 2",
			].join("\n"),
		);
	});

	test("exists subqueries, $if and order-by builders", () => {
		expect(
			say(
				`const people = await db.selectFrom("person").selectAll().where((eb) => eb.exists(eb.selectFrom("pet").whereRef("pet.owner_id", "=", "person.id"))).$if(onlyAdults, (qb) => qb.where("age", ">", 18)).orderBy("name", (ob) => ob.asc().nullsLast()).execute();`,
			),
		).toBe(
			[
				"Let people be look up rows from person:",
				"  • where something is found when we look up rows from pet:",
				"    • where pet's owner ID is person's ID",
				"  • only if only adults is set:",
				"    • where age is more than 18",
				"  • sorted by name (lowest first), empty values last",
			].join("\n"),
		);
	});

	test("json helpers, compile and the deprecated orderBy forms", () => {
		const text = say(
			`const withPets = await db.selectFrom("person").select((eb) => ["id", jsonArrayFrom(eb.selectFrom("pet").select(["pet.id", "pet.name"]).whereRef("pet.owner_id", "=", "person.id")).as("pets")]).execute();`,
		);
		expect(text).toContain("a JSON list of the rows we get when we look up pet's ID and pet's name from pet, named pets:");
		expect(say(`const q = db.selectFrom("person").selectAll().orderBy(["first_name", "last_name desc"]).compile();`)).toBe(
			"Let q be the SQL (not run) to look up rows from person:\n  • sorted by first name and last name (highest first)",
		);
	});
});

describe("writes", () => {
	test("insert with returning", () => {
		expect(say(`const res = await db.insertInto("person").values({ first_name: "Jennifer", age: 40 }).returning(["id"]).executeTakeFirstOrThrow();`)).toBe(
			[
				"Let response be the first row we get when we insert into person, failing if there is none:",
				`  • first name: "Jennifer"`,
				"  • age: 40",
				"  • giving back ID",
			].join("\n"),
		);
	});

	test("multi-row insert with an upsert", () => {
		expect(
			say(
				`await db.insertInto("pet").values([{ name: "Catto", species: "cat" }, { name: "Doggo", species: "dog" }]).onConflict((oc) => oc.column("name").doUpdateSet({ species: (eb) => eb.ref("excluded.species") })).execute();`,
			),
		).toBe(
			[
				"Insert into pet:",
				"  • these rows:",
				"    • a row with:",
				`      • name: "Catto"`,
				`      • species: "cat"`,
				"    • a row with:",
				`      • name: "Doggo"`,
				`      • species: "dog"`,
				"  • updating rows that already exist (matched on name):",
				"    • setting species: the new species",
			].join("\n"),
		);
		expect(say(`await db.insertInto("person").values(row).onConflict((oc) => oc.columns(["email"]).doNothing()).execute();`)).toContain(
			"ignoring rows that already exist (matched on email)",
		);
	});

	test("update and delete", () => {
		expect(say(`await db.updateTable("person").set({ first_name: "Jen" }).where("id", "=", id).execute();`)).toBe(
			["Update person:", `  • setting first name: "Jen"`, "  • where ID is ID"].join("\n"),
		);
		expect(say(`await db.deleteFrom("person").where("first_name", "in", names).where("deleted_at", "is not", null).execute();`)).toBe(
			["Delete from person:", "  • where first name is in names", "  • where deleted at is set"].join("\n"),
		);
	});
});

describe("transactions and builders in variables", () => {
	test("transaction().execute with an isolation level", () => {
		expect(
			say(`await db.transaction().setIsolationLevel("serializable").execute(async (trx) => {
  const p = await trx.insertInto("person").values({ first_name: "Jennifer" }).returning("id").executeTakeFirstOrThrow();
  await trx.insertInto("pet").values({ owner_id: p.id, name: "Catto" }).execute();
});`),
		).toBe(
			[
				"Do this all-or-nothing, in one transaction (isolation level serializable):",
				"  Let p be the first row we get when we insert into person, failing if there is none:",
				`    • first name: "Jennifer"`,
				"    • giving back ID",
				"  Insert into pet:",
				"    • owner ID: p's ID",
				`    • name: "Catto"`,
			].join("\n"),
		);
	});

	test("clauses added to a builder held in a variable", () => {
		expect(say(`qb = qb.where("Envelope.folderId", "is", null).orderBy("createdAt", "desc");`)).toBe(
			["Set qb to qb with these clauses added:", "  • where envelope's folder ID is empty", "  • sorted by created at (newest first)"].join("\n"),
		);
	});

	test("an expression builder passed as a typed parameter", () => {
		expect(
			say(`const recent = (eb: ExpressionBuilder<DB, "person">) => eb.exists(eb.selectFrom("pet").whereRef("pet.owner_id", "=", "person.id"));`),
		).toContain("something is found when we look up rows from pet");
	});
});

describe("guards", () => {
	const plain = (code: string) => narrateWithStats(code).text;
	const withPlugin = (code: string) => narrateWithStats(code, { plugins: [kysely()] }).text;

	test("Drizzle and other builders are left alone", () => {
		const code = `import { Kysely } from "kysely";
const rows = await db.select().from(users).where(eq(users.id, 1));
const r = await supabase.from("person").select("*").eq("id", 1);
const x = list.where((p) => p.ok).orderBy("name");`;
		expect(withPlugin(code)).toBe(plain(code));
	});

	test("files that don't use Kysely are untouched", () => {
		const code = `const p = await db.selectFrom("person").selectAll().execute();`;
		expect(withPlugin(code)).toBe(plain(code));
	});
});

test("a partial translation reports what it is missing", () => {
	const gaps = phrasebookGaps(en, { query: { select: () => "" } });
	expect(gaps.missing).toContain("query.where");
	expect(gaps.missing).toContain("run.first");
	expect(gaps.extra).toEqual([]);
});
