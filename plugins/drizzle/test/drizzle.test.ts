import { describe, expect, test } from "bun:test";
import { en as english } from "@usenarrator/locale-en";
import { narrate, narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { type DrizzlePhrases, drizzle, en } from "../src";

/** Narrates with the Drizzle plugin and asserts nothing fell back to raw code. */
const say = (code: string) => {
	const { text, fallbacks } = narrateWithStats(code, { plugins: [drizzle()] });
	expect(fallbacks).toBe(0);
	return text;
};

describe("operators", () => {
	test("comparisons keep their established phrasing", () => {
		const text = say(
			`const rows = await db.select().from(users).where(and(eq(users.id, id), ne(users.role, "admin"), gt(users.age, 18), lte(users.score, max), inArray(users.status, statuses), isNull(users.deletedAt)));`,
		);
		expect(text).toBe(
			[
				"Let rows be look up rows from users:",
				"  • where all of these are true:",
				"    • users' ID is ID",
				`    • users' role is not "admin"`,
				"    • users' age is more than 18",
				"    • users' score is at most max",
				"    • users' status is in statuses",
				"    • users' deleted at is empty",
			].join("\n"),
		);
	});

	test("negation flips every operator", () => {
		const text = say(`if (!or(gte(t.a, 1), notInArray(t.b, xs), isNotNull(t.c))) stop();`);
		expect(text).toContain("all of these are true:");
		expect(text).toContain("t's a is less than 1");
		expect(text).toContain("t's b is in xs");
		expect(text).toContain("t's c is empty");
	});

	test("like patterns read as contains / starts with / ends with", () => {
		const text = say(
			`const q = db.select().from(users).where(or(like(users.name, "%ann%"), ilike(users.email, \`\${prefix}%\`), notLike(users.slug, "%-old"), ilike(users.city, pattern)));`,
		);
		expect(text).toContain(`users' name contains "ann"`);
		expect(text).toContain("users' email starts with prefix (ignoring case)");
		expect(text).toContain(`users' slug does not end with "-old"`);
		expect(text).toContain("users' city matches the pattern pattern (ignoring case)");
	});

	test("between, not, and array operators", () => {
		const text = say(
			`const q = db.select().from(posts).where(and(between(posts.views, 10, 100), notBetween(posts.likes, lo, hi), not(eq(posts.draft, true)), arrayContains(posts.tags, ["a", "b"]), arrayContained(posts.tags, allowed), arrayOverlaps(posts.tags, wanted)));`,
		);
		expect(text).toContain("posts' views is between 10 and 100");
		expect(text).toContain("posts' likes is not between lo and hi");
		expect(text).toContain("posts' draft is not true");
		expect(text).toContain(`posts' tags contains all of a list of "a" and "b"`);
		expect(text).toContain("every item of posts' tags is in allowed");
		expect(text).toContain("posts' tags shares at least one item with wanted");
	});

	test("exists / notExists describe the subquery", () => {
		const text = say(`const q = db.select().from(users).where(notExists(db.select().from(posts).where(eq(posts.authorId, users.id))));`);
		expect(text).toContain("• where nothing is found when we look up rows from posts:");
		expect(text).toContain("• where posts' author ID is users' ID");
	});

	test("a spread of conditions", () => {
		expect(say(`const q = db.select().from(t).where(and(eq(t.a, 1), ...filters));`)).toContain("every condition in filters holds");
	});
});

describe("ordering and aggregates", () => {
	test("asc/desc say which end comes first", () => {
		const text = say(`const q = db.select().from(posts).orderBy(desc(posts.createdAt), asc(posts.title));`);
		expect(text).toContain("sorted by posts' created at (newest first) and posts' title (lowest first)");
	});

	test("count, sum and friends", () => {
		const text = say(
			`const q = db.select({ n: count(), total: sum(orders.amount), top: max(orders.amount), people: countDistinct(orders.userId) }).from(orders);`,
		);
		expect(text).toContain("n: the number of rows");
		expect(text).toContain("total: the total of orders' amount");
		expect(text).toContain("top: the largest orders' amount");
		expect(text).toContain("people: the number of different orders' user ID values");
	});

	test("db.$count with and without a filter", () => {
		expect(say(`const n = await db.$count(users);`)).toBe("Let n be the number of rows in users.");
		expect(say(`const n = await db.$count(users, eq(users.active, true));`)).toBe("Let n be the number of rows in users where users' active is true.");
	});
});

describe("sql fragments", () => {
	test("show the full SQL text, interpolations included", () => {
		const text = say(
			`await db.update(accounts).set({ balance: sql\`\${accounts.balance} - \${amount}\`, updatedAt: now }).where(sql\`\${accounts.id} = \${id} and \${accounts.balance} >= \${amount}\`);`,
		);
		expect(text).toContain("balance: the raw SQL ${accounts.balance} - ${amount}");
		expect(text).toContain("where the SQL condition ${accounts.id} = ${id} and ${accounts.balance} >= ${amount} holds");
	});

	test("long SQL is never truncated", () => {
		const cols = Array.from({ length: 40 }, (_, i) => `column_number_${i}`).join(", ");
		const text = say(`const q = db.select().from(t).where(sql\`(${cols}) is not null\`);`);
		expect(text).toContain(`(${cols}) is not null`);
	});

	test("sql helpers", () => {
		const text = say(
			`const a = sql.raw("now()"); const b = sql.join(parts, sql\`, \`); const c = sql.placeholder("id"); const d = sql.identifier(name); const e = sql\`count(*)\`.as("n"); const f = sql\`sum(x)\`.mapWith(Number);`,
		);
		expect(text).toContain("Let a be the raw SQL now().");
		expect(text).toContain(`Let b be parts, joined into one SQL fragment with ", " between them.`);
		expect(text).toContain(`Let c be the query parameter "id".`);
		expect(text).toContain("Let d be the SQL name name.");
		expect(text).toContain(`Let e be the raw SQL count(*), named "n".`);
		expect(text).toContain("Let f be the raw SQL sum(x), converted with number.");
	});

	test("table helpers", () => {
		expect(say(`const cols = getTableColumns(users);`)).toBe("Let cols be every column of users.");
	});
});

describe("query builder", () => {
	test("insert with onConflictDoUpdate lists target and changes", () => {
		const text = say(
			`await db.insert(users).values({ id, email }).onConflictDoUpdate({ target: users.email, set: { name, updatedAt: sql\`now()\` }, targetWhere: isNull(users.deletedAt) });`,
		);
		expect(text).toBe(
			[
				"Insert into users:",
				"  • the values: an object with ID and email",
				"  • updating rows that already exist (matched on users' email):",
				"    • setting an object with name and updated at: the raw SQL now()",
				"    • only for conflicting rows where users' deleted at is empty",
			].join("\n"),
		);
	});

	test("onConflictDoUpdate with a composite target", () => {
		expect(say(`await db.insert(t).values(v).onConflictDoUpdate({ target: [t.a, t.b], set: { c } });`)).toContain(
			"updating rows that already exist (matched on t's a and t's b):",
		);
	});

	test("subqueries with .as(), $dynamic and offset", () => {
		const text = say(`const sq = db.select().from(users).where(eq(users.active, true)).as("active_users");`);
		expect(text).toContain(`• named "active_users", to be used as a subquery`);
		const dyn = say(`const qb = db.select().from(users).$dynamic();`);
		expect(dyn).toContain("• left open so more clauses can be added later");
		expect(say(`const page = db.select().from(users).limit(10).offset(20);`)).toContain("• skipping the first 20");
	});

	test("CTEs with $with and with", () => {
		const text = say(`const recent = db.$with("recent").as(db.select().from(orders).where(gt(orders.total, 100)));
const rows = await db.with(recent).select().from(recent);`);
		expect(text).toContain(`Let recent be the named subquery "recent", defined as:`);
		expect(text).toContain("• look up rows from orders:");
		expect(text).toContain("• using recent, defined above");
	});

	test("a bare delete", () => {
		expect(say(`await db.delete(sessions);`)).toBe("Delete from sessions.");
	});

	test("having, joins and grouping", () => {
		const text = say(
			`const rows = await db.select({ userId: orders.userId, n: count() }).from(orders).leftJoin(users, eq(users.id, orders.userId)).groupBy(orders.userId).having(gt(count(), 5));`,
		);
		expect(text).toContain("• joined with users on users' ID is orders' user ID");
		expect(text).toContain("• grouped by orders' user ID");
		expect(text).toContain("• keeping only groups where the number of rows is more than 5");
	});

	test("selectDistinctOn", () => {
		expect(say(`const rows = await db.selectDistinctOn([t.userId]).from(t);`)).toContain("• keeping only the first row for each t's user ID");
	});
});

describe("relational queries", () => {
	test("findFirst with a callback where reads inline", () => {
		expect(say(`const user = await db.query.users.findFirst({ where: (users, { eq }) => eq(users.id, id) });`)).toBe(
			"Let user be the first row of users where users' ID is ID.",
		);
	});

	test("findMany with columns, with, orderBy, limit, offset", () => {
		const text = say(`const posts = await db.query.posts.findMany({
	columns: { id: true, title: true },
	where: eq(posts.published, true),
	with: { author: true, comments: { columns: { body: false }, orderBy: [desc(comments.createdAt)], limit: 5 } },
	orderBy: (posts, { asc }) => [asc(posts.title)],
	limit: 10,
	offset: 20,
	extras: { lower: sql\`lower(\${posts.title})\` },
});`);
		expect(text).toBe(
			[
				"Let posts be the rows of posts:",
				"  • picking only ID and title",
				"  • where posts' published is true",
				"  • including author",
				"  • including comments:",
				"    • leaving out body",
				"    • sorted by comments' created at (newest first)",
				"    • at most 5 row(s)",
				"  • sorted by posts' title (lowest first)",
				"  • at most 10 row(s)",
				"  • skipping the first 20",
				"  • adding lower: the raw SQL lower(${posts.title})",
			].join("\n"),
		);
	});

	test("object-style where (RQB v2)", () => {
		const text = say(`const users = await db.query.users.findMany({
	where: { age: { gte: 18, lt: 65 }, name: { ilike: "%ann%" }, OR: [{ role: "admin" }, { role: "owner" }], NOT: { banned: true }, posts: { title: { like: "Hello%" } } },
	orderBy: { createdAt: "desc" },
});`);
		expect(text).toContain("• age is at least 18");
		expect(text).toContain("• age is less than 65");
		expect(text).toContain(`• name contains "ann" (ignoring case)`);
		expect(text).toContain("• any of these is true:");
		expect(text).toContain(`• role is "admin"`);
		expect(text).toContain("• banned is not true");
		expect(text).toContain(`• has posts where title starts with "Hello"`);
		expect(text).toContain("• sorted by created at (newest first)");
	});

	test("findMany with no options", () => {
		expect(say(`const all = await db.query.users.findMany();`)).toBe("Let all be every row of users.");
	});

	test("columns: {} picks nothing of its own", () => {
		expect(say(`const r = await db.query.users.findMany({ columns: {}, with: { posts: true } });`)).toContain("• picking none of its own columns");
	});
});

describe("transactions and batches", () => {
	test("a transaction with a rollback", () => {
		const text = say(`await db.transaction(async (tx) => {
	await tx.update(accounts).set({ balance: 0 }).where(eq(accounts.id, from));
	if (failed) tx.rollback();
}, { isolationLevel: "serializable", accessMode: "read only" });`);
		expect(text).toBe(
			[
				`Do this all-or-nothing, in one transaction (isolation level serializable, read-only):`,
				"  Update accounts:",
				"    • setting an object with balance: 0",
				"    • where accounts' ID is from",
				"  If failed is set, cancel the transaction, undoing everything it changed.",
			].join("\n"),
		);
	});

	test("a transaction's result and a nested savepoint", () => {
		const text = say(`const id = await db.transaction(async (tx) => {
	await tx.transaction(async (tx2) => { await tx2.delete(logs); });
	return 1;
});`);
		expect(text).toContain("Let ID be the result of an all-or-nothing transaction that does:");
		expect(text).toContain("Do this in a nested transaction that can be undone on its own:");
	});

	test("batch", () => {
		const text = say(`await db.batch([db.insert(users).values(u), db.select().from(users)]);`);
		expect(text).toContain("Run these queries together in one batch:");
		expect(text).toContain("• insert into users:");
	});
});

describe("schema", () => {
	test("a Postgres table with columns, indexes and constraints", () => {
		const text = say(`export const posts = pgTable("posts", {
	id: serial().primaryKey(),
	authorId: integer("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	title: varchar({ length: 256 }).notNull().unique(),
	tags: text().array().default([]),
	status: statusEnum().default("draft"),
	meta: jsonb().$type<PostMeta>(),
	price: numeric({ precision: 10, scale: 2 }),
	createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp().$onUpdate(() => new Date()),
	slug: text().$defaultFn(() => nanoid()),
}, (t) => [
	index("posts_author_idx").on(t.authorId, t.createdAt.desc()),
	uniqueIndex("posts_slug_idx").on(t.slug).where(sql\`\${t.slug} is not null\`),
	primaryKey({ columns: [t.id, t.authorId] }),
	foreignKey({ columns: [t.authorId], foreignColumns: [users.id], name: "fk" }).onDelete("set null"),
	check("price_positive", sql\`\${t.price} > 0\`),
]);`);
		expect(text).toBe(
			[
				`Let posts be a Postgres table "posts":`,
				"  • ID: auto-numbered integer, primary key",
				"  • author ID: integer, required, points to users' ID, deleted along with it",
				"  • title: text, up to 256 characters, required, unique",
				"  • tags: list of text, defaults to an empty list",
				`  • status: status enum, defaults to "draft"`,
				"  • meta: JSON, typed as (PostMeta)",
				"  • price: decimal number, 10 digits, 2 after the point",
				"  • created at: timestamp, with time zone, defaults to the current time, required",
				"  • updated at: timestamp, set to the current time on every update",
				"  • slug: text, defaults to the result of nanoid (worked out in code)",
				`  • an index "posts_author_idx" on t's author ID and t's created at (newest first)`,
				`  • a unique index "posts_slug_idx" on t's slug (only for rows where the SQL condition \${t.slug} is not null holds)`,
				"  • the primary key is t's ID and t's author ID together",
				"  • t's author ID points to users' ID, cleared when it's deleted",
				`  • every row must satisfy the SQL condition \${t.price} > 0 holds (check "price_positive")`,
			].join("\n"),
		);
	});

	test("MySQL and SQLite tables, with row-level security", () => {
		expect(say(`const a = mysqlTable("a", { id: int().autoincrement().primaryKey(), at: datetime() });`)).toContain(
			"• ID: integer, auto-incrementing, primary key",
		);
		expect(say(`const b = sqliteTable("b", { id: integer().primaryKey(), blob: blob() });`)).toContain(`Let b be a SQLite table "b":`);
		expect(say(`const c = pgTable("c", { id: uuid().defaultRandom() }).enableRLS();`)).toContain("• row-level security is on");
	});

	test("enums are listed in full", () => {
		expect(say(`export const mood = pgEnum("mood", ["sad", "ok", "happy", "ecstatic"]);`)).toBe(
			`Let mood be a Postgres enum "mood": one of "sad", "ok", "happy", or "ecstatic".`,
		);
	});

	test("relations: one and many", () => {
		const text = say(`export const postsRelations = relations(posts, ({ one, many }) => ({
	author: one(users, { fields: [posts.authorId], references: [users.id], relationName: "author" }),
	comments: many(comments),
}));`);
		expect(text).toBe(
			[
				"Let posts relations be how posts links to other tables:",
				"  • author: one row of users, matching posts' author ID to users' ID:",
				`    • relation name: "author"`,
				"  • comments: many rows of comments",
			].join("\n"),
		);
	});

	test("defineRelations (v2)", () => {
		const text = say(`export const rels = defineRelations(schema, (r) => ({
	users: { posts: r.many.posts() },
	posts: { author: r.one.users({ from: r.posts.authorId, to: r.users.id }) },
}));`);
		expect(text).toContain("Let rels be how the tables link to each other:");
		expect(text).toContain("• how users links to other tables:");
		expect(text).toContain("• posts: many rows of posts");
		expect(text).toContain("• author: one row of users, matching r's posts' author ID to r's users' ID");
	});

	test("a column builder outside a table", () => {
		expect(say(`const createdAt = timestamp("created_at").defaultNow().notNull();`)).toBe(
			`Let created at be a column holding timestamp, stored as "created_at", defaults to the current time, required.`,
		);
	});
});

describe("not Drizzle", () => {
	test("lookalike calls are left to the engine", () => {
		const text = narrateWithStats(`cache.delete(key); map.set(a, b); const s = z.boolean().default(false); check("x", ok);`, { plugins: [drizzle()] }).text;
		expect(text).not.toContain("Delete from");
		expect(text).not.toContain("column");
		expect(text).not.toContain("every row must satisfy");
	});
});

test("a locale can replace the phrasebook without touching rules", () => {
	const es: DrizzlePhrases = {
		...en,
		compare: { ...en.compare, equal: ({ left, right, neg }) => `${left} ${neg ? "no es" : "es"} ${right}` },
		relational: { ...en.relational, firstRow: ({ table }) => `la primera fila de ${table}`, filtered: ({ rows, condition }) => `${rows} donde ${condition}` },
	};
	const locale = { ...english, id: "es", plugins: { drizzle: es } };
	expect(narrate(`const u = await db.query.users.findFirst({ where: eq(users.id, id) });`, { plugins: [drizzle()], locale })).toContain(
		"la primera fila de users donde users' ID es ID",
	);
	expect(phrasebookGaps(en, es)).toEqual({ missing: [], extra: [] });
});
