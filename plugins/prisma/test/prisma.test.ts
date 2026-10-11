import { describe, expect, test } from "bun:test";
import { narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { en, prisma } from "../src";

const IMPORT = `import { PrismaClient } from "@prisma/client";\n`;

/** Narrates a snippet (with the Prisma import) and asserts nothing fell back to raw code. */
const say = (code: string) => {
	const { text, fallbacks } = narrateWithStats(IMPORT + code, { plugins: [prisma()] });
	expect(fallbacks).toBe(0);
	return text;
};

describe("reads", () => {
	test("findMany with filters, select, ordering and paging", () => {
		expect(
			say(`const users = await prisma.user.findMany({
  where: {
    email: { contains: "prisma.io", mode: "insensitive" },
    posts: { some: { published: true } },
    OR: [{ name: { startsWith: "A" } }, { age: { gte: 18 } }],
    NOT: { role: "ADMIN" },
    deletedAt: null,
  },
  select: { id: true, email: true, _count: { select: { posts: true } } },
  orderBy: [{ createdAt: "desc" }, { name: "asc" }],
  take: 10,
  skip: 20,
});`),
		).toBe(
			[
				"Let users be the rows of users:",
				"  • where all of these are true:",
				`    • email contains "prisma.io" (ignoring case)`,
				"    • has posts where published is true",
				"    • any of these is true:",
				`      • name starts with "A"`,
				"      • age is at least 18",
				`    • role is not "ADMIN"`,
				"    • deleted at is empty",
				"  • picking only ID, email, and the number of posts",
				"  • sorted by created at (newest first) and name (lowest first)",
				"  • at most 10 row(s)",
				"  • skipping the first 20",
			].join("\n"),
		);
	});

	test("findUnique, findFirstOrThrow and nested include", () => {
		expect(
			say(`const user = await prisma.user.findUnique({ where: { id: 1 }, include: { posts: { where: { published: true }, orderBy: { title: "asc" } } } });`),
		).toBe(
			["Let user be the row of users where ID is 1:", "  • including posts:", "    • where published is true", "    • sorted by title (lowest first)"].join(
				"\n",
			),
		);
		expect(say(`const first = await prisma.post.findFirstOrThrow({ where: { author: { email: "a@b.c" } } });`)).toBe(
			`Let first be the first row of posts where author's email is "a@b.c", failing if there is none.`,
		);
		expect(say(`await prisma.user.findMany();`)).toBe("Look up every row of users.");
	});

	test("relation and list filters, cursors and negative take", () => {
		expect(
			say(
				`const posts = await prisma.post.findMany({ where: { tags: { has: "prisma" }, author: { isNot: null }, comments: { none: {} }, title: { not: { contains: "draft" } } }, distinct: ["authorId"], cursor: { id: lastId }, take: -5 });`,
			),
		).toBe(
			[
				"Let posts be the rows of posts:",
				"  • where all of these are true:",
				`    • tags includes "prisma"`,
				"    • has author",
				"    • has no comments",
				`    • title does not contain "draft"`,
				"  • keeping one row per author ID",
				"  • starting from the row where ID is last ID",
				"  • only the last 5 row(s)",
			].join("\n"),
		);
		expect(say(`const users = await prisma.user.findMany({ where: { posts: { every: { published: true } } }, orderBy: { posts: { _count: "desc" } } });`)).toBe(
			["Let users be the rows of users where all of its posts are ones where published is true:", "  • sorted by how many posts each has (most first)"].join(
				"\n",
			),
		);
	});

	test("compound unique keys read as their fields", () => {
		expect(say(`const m = await prisma.membership.findUnique({ where: { userId_teamId: { userId, teamId } } });`)).toBe(
			["Let m be the row of memberships:", "  • where all of these are true:", "    • user ID is user ID", "    • team ID is team ID"].join("\n"),
		);
	});

	test("count, aggregate and groupBy", () => {
		expect(say(`const n = await prisma.user.count({ where: { role: "ADMIN" } });`)).toBe(`Let n be the number of rows in users where role is "ADMIN".`);
		expect(say(`const stats = await prisma.user.aggregate({ _avg: { age: true }, _count: { _all: true }, where: { country: "UK" } });`)).toBe(
			["Let stats be totals over users:", "  • the average of age", "  • the number of rows", `  • where country is "UK"`].join("\n"),
		);
		expect(
			say(
				`const groups = await prisma.user.groupBy({ by: ["country"], _sum: { profileViews: true }, having: { profileViews: { _avg: { gt: 100 } } }, orderBy: { _sum: { profileViews: "desc" } } });`,
			),
		).toBe(
			[
				"Let groups be the rows of users grouped by country:",
				"  • the total of profile views",
				"  • keeping only groups where the average of profile views is more than 100",
				"  • sorted by the total of profile views (highest first)",
			].join("\n"),
		);
	});
});

describe("writes", () => {
	test("create with nested create and connect", () => {
		expect(
			say(
				`await prisma.user.create({ data: { email: "alice@prisma.io", name: "Alice", posts: { create: [{ title: "Hello" }, { title: "World" }] }, profile: { connect: { id: 3 } } } });`,
			),
		).toBe(
			[
				"Insert a row into users:",
				`  • email: "alice@prisma.io"`,
				`  • name: "Alice"`,
				"  • posts: creating these new ones:",
				"    • a row with:",
				`      • title: "Hello"`,
				"    • a row with:",
				`      • title: "World"`,
				"  • profile: linking the existing row where ID is 3",
			].join("\n"),
		);
	});

	test("update with atomic number operations, updateMany and upsert", () => {
		expect(say(`await prisma.post.update({ where: { id: 1 }, data: { views: { increment: 1 }, title } });`)).toBe(
			["Update the row of posts where ID is 1:", "  • views: increased by 1", "  • title"].join("\n"),
		);
		expect(say(`const result = await prisma.user.updateMany({ where: { email: { endsWith: "@old.com" } }, data: { role: "USER" } });`)).toBe(
			[`Let result be the number of rows affected when we update the rows of users where email ends with "@old.com":`, `  • role: "USER"`].join("\n"),
		);
		expect(
			say(
				`await prisma.user.upsert({ where: { email: "viola@prisma.io" }, update: { name: "Viola the Magnificent" }, create: { email: "viola@prisma.io", name: "Viola" } });`,
			),
		).toBe(
			[
				`Update the row of users where email is "viola@prisma.io", or insert it if it doesn't exist:`,
				"  • if it exists, setting:",
				`    • name: "Viola the Magnificent"`,
				"  • if not, inserting:",
				`    • email: "viola@prisma.io"`,
				`    • name: "Viola"`,
			].join("\n"),
		);
	});

	test("deletes and createMany", () => {
		expect(say(`await prisma.user.delete({ where: { id: 7 } });`)).toBe("Delete the row of users where ID is 7.");
		expect(say(`await prisma.user.deleteMany({});`)).toBe("Delete every row of users.");
		expect(say(`const r = await prisma.user.createMany({ data: rows, skipDuplicates: true });`)).toBe(
			["Let r be the number of rows affected when we insert rows into users:", "  • with the values in rows", "  • skipping rows that already exist"].join(
				"\n",
			),
		);
	});
});

describe("transactions, client and extensions", () => {
	test("the array form", () => {
		expect(say(`await prisma.$transaction([prisma.post.deleteMany({ where: { authorId: 7 } }), prisma.user.delete({ where: { id: 7 } })]);`)).toBe(
			["Run these together, all-or-nothing:", "  • delete the rows of posts where author ID is 7", "  • delete the row of users where ID is 7"].join("\n"),
		);
	});

	test("the interactive form with options", () => {
		const text = say(`await prisma.$transaction(async (tx) => {
  const sender = await tx.account.update({ data: { balance: { decrement: amount } }, where: { email: from } });
  await tx.account.update({ data: { balance: { increment: amount } }, where: { email: to } });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10000 });`);
		expect(text).toBe(
			[
				"Do this all-or-nothing, in one transaction (isolation level Serializable, giving up after 10,000 ms):",
				"  Let sender be the row of accounts where email is from, after updating it:",
				"    • balance: decreased by amount",
				"  Update the row of accounts where email is to:",
				"    • balance: increased by amount",
			].join("\n"),
		);
	});

	test("v7 client with a driver adapter, and $extends", () => {
		const text = say(`export const prisma = new PrismaClient({ adapter, log: ["query", "error"] });
const xprisma = prisma.$extends({
  result: { user: { fullName: { needs: { firstName: true, lastName: true }, compute: (user) => user.firstName } } },
  model: { user: { signUp } },
});`);
		expect(text).toContain("Let prisma be a Prisma client:\n  • connecting through the driver adapter adapter\n  • logging query and error");
		expect(text).toContain("Let xprisma be prisma, extended with:\n  • a computed field full name on user:\n    • using first name and last name");
		expect(text).toContain("  • new methods on user: sign up");
	});
});

describe("guards", () => {
	const plain = (code: string) => narrateWithStats(code).text;
	const withPlugin = (code: string) => narrateWithStats(code, { plugins: [prisma()] }).text;

	test("Drizzle's relational queries, other SDKs and plain objects are left alone", () => {
		const code = `import { PrismaClient } from "@prisma/client";
const users = await db.query.users.findMany({ where: { id: 1 } });
await intercom.contacts.create({ email });
await stripeClient.subscriptions.update(id, { a: 1 });
const x = cache.items.findMany();
await mongo.collection.find({ a: 1 });`;
		expect(withPlugin(code)).toBe(plain(code));
	});

	test("files that don't use Prisma are untouched", () => {
		const code = `const u = await prisma.user.findMany({ where: { id: 1 } });`;
		expect(withPlugin(code)).toBe(plain(code));
	});

	test("raw queries stay with the sql plugin", () => {
		const code = `import { PrismaClient } from "@prisma/client";\nconst rows = await prisma.$queryRaw\`SELECT 1\`;`;
		expect(withPlugin(code)).toBe(plain(code));
	});
});

test("a partial translation reports what it is missing", () => {
	const gaps = phrasebookGaps(en, { rows: { every: () => "" } });
	expect(gaps.missing).toContain("rows.some");
	expect(gaps.missing).toContain("relation.has");
	expect(gaps.extra).toEqual([]);
});
