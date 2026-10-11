import { describe, expect, test } from "bun:test";
import { drizzle } from "@usenarrator/plugin-drizzle";
import { narrate, narrateWithStats } from "@usenarrator/testkit";
import { type SqlParser, sql } from "../src";
import { pgsqlParser } from "../src/pgsql";

const plugins = [sql({ parser: pgsqlParser })];

/** Narrates with the SQL plugin and asserts nothing fell back to raw code. */
const say = (code: string) => {
	const { text, fallbacks } = narrateWithStats(code, { plugins });
	expect(fallbacks).toBe(0);
	return text;
};
const lines = (...xs: string[]) => xs.join("\n");

describe("tagged templates (postgres.js, Bun.sql, Neon, Vercel, kysely, Prisma)", () => {
	test("a select reads clause by clause, interpolations as their JS values", () => {
		expect(say("const users = await sql`select id, name from users where org_id = ${orgId} order by created_at desc limit 10`;")).toBe(
			lines(
				"Let users be the id and name from users:",
				"  • where org_id is org ID",
				"  • sorted by created_at (newest first)",
				"  • at most 10 rows",
				"  • SQL: select id, name from users where org_id = ${orgId} order by created_at desc limit 10",
			),
		);
	});

	test("a bare awaited statement reads as an action", () => {
		expect(say("await sql`delete from sessions where expires_at < now()`;")).toBe(
			lines("Delete rows from sessions:", "  • where expires_at is less than the current time", "  • SQL: delete from sessions where expires_at < now()"),
		);
	});

	test("Bun.sql, sql.unsafe and kysely's .execute(db)", () => {
		const text = say(
			'import { sql } from "bun"; await Bun.sql`truncate logs restart identity`; await sql.unsafe("drop table if exists tmp cascade"); const { rows } = await sql`select count(*) as n from users`.execute(db);',
		);
		expect(text).toContain(lines("Remove every row from logs:", "  • and restart their automatic numbering", "  • SQL: truncate logs restart identity"));
		expect(text).toContain(
			lines("Delete the table tmp (if it exists):", "  • along with everything that depends on it", "  • SQL: drop table if exists tmp cascade"),
		);
		expect(text).toContain("n: the number of rows");
	});

	test("Prisma $executeRaw: increments read as increases and decreases", () => {
		expect(say("const n = await prisma.$executeRaw`UPDATE accounts SET balance = balance - ${amount} WHERE id = ${id}`;")).toBe(
			lines(
				"Let n be the result of running SQL to change rows in accounts:",
				"  • decreasing balance by amount",
				"  • where id is ID",
				"  • SQL: UPDATE accounts SET balance = balance - ${amount} WHERE id = ${id}",
			),
		);
	});

	test("an update with no WHERE says it touches every row", () => {
		expect(say("await this.prisma.$executeRaw`update users set active = false`;")).toContain("• in every row (there's no condition)");
	});

	test("nested sql fragments and postgres.js identifier helpers are inlined", () => {
		const text = say("const rows = await sql`select * from ${sql(table)} where ${sql`deleted_at is null`} and id = ${id}`;");
		expect(text).toContain("Let rows be the rows of table:");
		expect(text).toContain("• where deleted_at is empty and id is ID");
	});

	test("an expression fragment reads as a value", () => {
		expect(say("const s = sql`now()`;")).toBe(lines("Let s be the SQL expression the current time:", "  • SQL: now()"));
	});
});

describe("driver calls (pg, mysql2, better-sqlite3, bun:sqlite, Prisma unsafe, Neon, slonik)", () => {
	test("pg: $1 placeholders map to the values array", () => {
		expect(say("const res = await pool.query('SELECT * FROM users WHERE id = $1 AND org_id = $2', [userId, org.id]);")).toBe(
			lines(
				"Let response be the rows of users:",
				"  • where id is user ID and org_id is org's ID",
				"  • SQL: SELECT * FROM users WHERE id = $1 AND org_id = $2",
			),
		);
	});

	test("pg: a values array that isn't a literal is read by position", () => {
		expect(say("const res = await client.query('select * from users where id = $1', params);")).toContain("where id is item #1 of params");
	});

	test("pg: { text, values } query config", () => {
		expect(say('const r = await pool.query({ text: "select * from users where id = $1", values: [id] });')).toContain("• where id is ID");
	});

	test("mysql2: ? placeholders and backtick names", () => {
		expect(say('const [rows] = await conn.execute("SELECT * FROM `users` WHERE `id` = ? LIMIT 1", [id]);')).toContain(
			lines("  • where id is ID", "  • at most 1 row", "  • SQL: SELECT * FROM `users` WHERE `id` = ? LIMIT 1"),
		);
	});

	test("better-sqlite3: prepare().get() binds ? in order", () => {
		expect(say("const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = ?').get(email, 1);")).toBe(
			lines("Let user be the rows of users:", "  • where email is email and active is 1", "  • SQL: SELECT * FROM users WHERE email = ? AND active = ?"),
		);
	});

	test("better-sqlite3: a prepared statement, run later with named values", () => {
		const text = say('const insert = db.prepare("INSERT INTO cats (name, age) VALUES (@name, @age)");\ninsert.run({ name: cat.name, age: cat.age });');
		expect(text).toBe(
			lines(
				"Let insert be a prepared SQL statement to add a row to cats:",
				"  • setting name to the value for @name and age to the value for @age",
				"  • SQL: INSERT INTO cats (name, age) VALUES (@name, @age)",
				"",
				"Add a row to cats:",
				"  • setting name to cat's name and age to cat's age",
				"  • SQL: INSERT INTO cats (name, age) VALUES (@name, @age)",
			),
		);
	});

	test("bun:sqlite: db.query prepares; $name binds from the object", () => {
		const text = say('import { Database } from "bun:sqlite";\nconst q = db.query("SELECT * FROM users WHERE id = $id");\nconst u = q.get({ $id: id });');
		expect(text).toContain("Let q be a prepared SQL statement to look up the rows of users:");
		expect(text).toContain(lines("Let u be the rows of users:", "  • where id is ID"));
	});

	test("bun:sqlite / better-sqlite3: db.run and db.exec", () => {
		const text = say('db.run("INSERT INTO kv (k, v) VALUES (?1, ?2)", [key, value]); db.exec("CREATE INDEX IF NOT EXISTS kv_k ON kv (k)");');
		expect(text).toContain("• setting k to key and v to value");
		expect(text).toContain("Create an index kv_k on kv by k if it doesn't exist yet:");
	});

	test("Prisma $queryRawUnsafe binds the rest arguments", () => {
		expect(say('const rows = await prisma.$queryRawUnsafe("SELECT * FROM \\"User\\" WHERE email = $1 AND age > $2", email, minAge);')).toContain(
			"• where email is email and age is more than min age",
		);
	});

	test("Neon's sql.query and slonik's sql.unsafe inside pool.query", () => {
		expect(say('const rows = await sql.query("SELECT * FROM posts WHERE author = $1 LIMIT $2", [author, 10]);')).toContain("• at most 10 rows");
		expect(say("const r = await pool.query(sql.unsafe`select id from users where email = ${email}`);")).toContain(
			lines("Let r be the id from users:", "  • where email is email"),
		);
	});
});

describe("SQL constants", () => {
	test("a SQL constant is narrated where it's declared and where it runs", () => {
		const text = say("const FIND_USER = `select * from users where email = $1`;\nconst r = await pool.query(FIND_USER, [email]);");
		expect(text).toBe(
			lines(
				"Let find user be the SQL to look up the rows of users:",
				"  • where email is the value for $1",
				"  • SQL: select * from users where email = $1",
				"",
				"Let r be the rows of users:",
				"  • where email is email",
				"  • SQL: select * from users where email = $1",
			),
		);
	});

	test("an ordinary string constant stays untouched", () => {
		expect(say('const GREETING = "select a plan to continue";')).toBe(narrate('const GREETING = "select a plan to continue";'));
	});
});

describe("SELECT", () => {
	test("joins, aliases resolved to tables, grouping, having, ordering by position", () => {
		expect(
			say(
				"const top = await sql`select u.id, u.email from users u left join orders o on o.user_id = u.id where u.active and o.total > ${min} and o.created_at > now() - interval '30 days' group by u.id having count(o.id) > 5 order by 2 desc offset ${page * 20}`;",
			),
		).toBe(
			lines(
				"Let top be users' id and users' email from users:",
				"  • with any matching orders where orders' user_id is users' id (keeping rows that have none)",
				"  • where all of these are true:",
				"    • users' active is true",
				"    • orders' total is more than min",
				"    • orders' created_at is more than the current time minus 30 days",
				"  • grouped by users' id",
				"  • keeping only groups where the number of orders' id values is more than 5",
				"  • sorted by column 2 (highest first)",
				"  • skipping the first page times 20 rows",
				"  • SQL: select u.id, u.email from users u left join orders o on o.user_id = u.id where u.active and o.total > ${min} and o.created_at > now() - interval '30 days' group by u.id having count(o.id) > 5 order by 2 desc offset ${page * 20}",
			),
		);
	});

	test("a self-join keeps its aliases", () => {
		expect(say("const r = await sql`select a.id from users a join users b on a.manager_id = b.id`;")).toContain(
			"• joined with users (as b) where a's manager_id is b's id",
		);
	});

	test("aggregates, aliases, window functions, CASE and JSON operators", () => {
		const text = say(
			"const r = await sql`select data->>'email' as email, data->'tags'->0 as first_tag, row_number() over (partition by org_id order by created_at desc) as rn, count(*) filter (where status = 'paid') as paid, case when amount > 100 then 'big' when amount > 10 then 'medium' else 'small' end as size, coalesce(nickname, name) as label from profiles group by org_id`;",
		);
		expect(text).toContain("Let r be the rows of profiles:");
		expect(text).toContain("  • with these columns:");
		expect(text).toContain("    • email: the email field of data (as text)");
		expect(text).toContain("    • first_tag: item 1 of the tags field of data");
		expect(text).toContain("    • rn: the row number within each org_id, ordered by created_at (newest first)");
		expect(text).toContain(`    • paid: the number of rows where status is "paid"`);
		expect(text).toContain(`    • size: "big" if amount is more than 100, "medium" if amount is more than 10, otherwise "small"`);
		expect(text).toContain("    • label: nickname, or name if that's empty");
	});

	test("subqueries: EXISTS, IN (select), ANY, DISTINCT ON", () => {
		expect(
			say(
				"const rows = await sql`select distinct on (customer_id) * from orders where not exists (select 1 from refunds r where r.order_id = orders.id) and id in (select order_id from items where sku = any(${skus})) order by customer_id, created_at desc`;",
			),
		).toBe(
			lines(
				"Let rows be the rows of orders:",
				"  • keeping only the first row for each customer_id",
				"  • where all of these are true:",
				"    • there are no rows in refunds where refunds' order_id is orders' id",
				"    • id is among the order_id from items, where sku is one of skus",
				"  • sorted by customer_id and created_at (newest first)",
				"  • SQL: select distinct on (customer_id) * from orders where not exists (select 1 from refunds r where r.order_id = orders.id) and id in (select order_id from items where sku = any(${skus})) order by customer_id, created_at desc",
			),
		);
	});

	test("LIKE patterns read as contains / starts with; IN lists; BETWEEN; IS NULL", () => {
		const text = say(
			"const r = await sql`select * from users where name ilike '%' || ${q} || '%' and email like 'admin@%' and role in ('owner', 'admin') and age between 18 and 65 and deleted_at is null and not banned`;",
		);
		expect(text).toContain("    • name contains q (ignoring case)");
		expect(text).toContain(`    • email starts with "admin@"`);
		expect(text).toContain(`    • role is one of "owner" or "admin"`);
		expect(text).toContain("    • age is between 18 and 65");
		expect(text).toContain("    • deleted_at is empty");
		expect(text).toContain("    • banned is not true");
	});

	test("JSONB containment, key checks, paths, and array overlap", () => {
		const text = say("const r = await sql`select data #>> ${path} as v from events where data ? ${key} and data @> ${filter}::jsonb and tags && ${tags}`;");
		expect(text).toContain("v: the value at path in data (as text)");
		expect(text).toContain("data has the key key");
		expect(text).toContain("data contains filter");
		expect(text).toContain("tags shares at least one item with tags");
	});

	test("row locking for job queues", () => {
		expect(say("const jobs = await sql`select * from jobs where status = 'queued' order by id limit ${n} for update skip locked`;")).toBe(
			lines(
				"Let jobs be the rows of jobs:",
				`  • where status is "queued"`,
				"  • sorted by id",
				"  • at most n rows",
				"  • locking the rows so other transactions can't change them until this one ends",
				"  • skipping rows another transaction has already locked",
				"  • SQL: select * from jobs where status = 'queued' order by id limit ${n} for update skip locked",
			),
		);
	});

	test("CTEs, recursive CTEs, and UNION", () => {
		expect(say("const t = await sql`with recursive t(n) as (select 1 union all select n + 1 from t where n < 10) select sum(n) from t`;")).toBe(
			lines(
				"Let t be the total of n from t:",
				"  • where t is built step by step:",
				"    • starting from 1",
				"    • then repeatedly adding the n plus 1 from t:",
				"      • where n is less than 10",
				"  • SQL: with recursive t(n) as (select 1 union all select n + 1 from t where n < 10) select sum(n) from t",
			),
		);
		const cte = say(
			"const r = await sql`with recent as (select * from orders where created_at > ${since}) select customer_id, sum(total) from recent group by customer_id`;",
		);
		expect(cte).toContain(
			lines(
				"Let r be the customer_id and the total of total from recent:",
				"  • where recent is the rows of orders:",
				"    • where created_at is more than since",
			),
		);
		expect(say("const ids = await sql`select id from a union select id from b`;")).toContain(
			lines("Let IDs be the rows of all of these, without duplicates:", "  • the id from a", "  • the id from b"),
		);
	});
});

describe("writes", () => {
	test("INSERT ... ON CONFLICT DO UPDATE ... RETURNING", () => {
		expect(
			say(
				"const [user] = await sql`insert into users (id, email) values (${id}, ${email}) on conflict (id) do update set email = excluded.email returning *`;",
			),
		).toBe(
			lines(
				"Let user be the first of the result of running SQL to add a row to users:",
				"  • setting id to ID and email to email",
				"  • if a row with the same id already exists, updating that row instead:",
				"    • setting email to the new email",
				"  • giving back every column",
				"  • SQL: insert into users (id, email) values (${id}, ${email}) on conflict (id) do update set email = excluded.email returning *",
			),
		);
	});

	test("ON CONFLICT DO NOTHING, several rows, INSERT ... SELECT", () => {
		expect(say("await sql`insert into tags (name) values ('a'), ('b') on conflict do nothing`;")).toBe(
			lines(
				"Add 2 rows to tags:",
				"  • with values for name:",
				`    • (name to "a")`,
				`    • (name to "b")`,
				"  • skipping rows that clash with existing ones",
				"  • SQL: insert into tags (name) values ('a'), ('b') on conflict do nothing",
			),
		);
		expect(say("await sql`insert into archive select * from logs where ts < ${cutoff}`;")).toContain(
			lines("Add rows to archive:", "  • copying the rows of logs:", "    • where ts is less than cutoff"),
		);
	});

	test("UPDATE ... FROM and DELETE ... RETURNING", () => {
		expect(say("await sql`update orders o set status = ${status}, paid_at = now() from payments p where p.order_id = o.id and p.state = 'paid'`;")).toContain(
			lines(
				"Change rows in orders:",
				"  • setting status to status and paid_at to the current time",
				"  • using matching rows from payments",
				`  • where payments' order_id is orders' id and payments' state is "paid"`,
			),
		);
		expect(say("const gone = await sql`delete from sessions where user_id = ${userId} returning id`;")).toContain("• giving back id");
	});
});

describe("schema and transactions", () => {
	test("CREATE TABLE lists every column with its rules", () => {
		expect(
			say(
				"await sql`create table if not exists users (id serial primary key, email varchar(255) not null unique, org_id int references orgs(id) on delete cascade, created_at timestamptz default now(), constraint email_lower check (email = lower(email)))`;",
			),
		).toBe(
			lines(
				"Create the table users if it doesn't exist yet:",
				"  • id: serial, the primary key",
				"  • email: varchar(255), required, unique",
				"  • org_id: int, points to orgs' id, deleted along with it",
				"  • created_at: timestamptz, defaults to the current time",
				"  • must satisfy: email is email in lowercase (rule email_lower)",
				"  • SQL: create table if not exists users (id serial primary key, email varchar(255) not null unique, org_id int references orgs(id) on delete cascade, created_at timestamptz default now(), constraint email_lower check (email = lower(email)))",
			),
		);
	});

	test("CREATE INDEX and ALTER TABLE", () => {
		expect(say("await sql`create unique index concurrently idx_users_email on users (lower(email)) where deleted_at is null`;")).toContain(
			lines(
				"Create a unique index idx_users_email on users by email in lowercase:",
				"  • without blocking writes while it builds",
				"  • only for rows where deleted_at is empty",
			),
		);
		expect(
			say(
				"await sql`alter table users add column if not exists age int not null default 0, drop column legacy, alter column name set not null, rename column nick to nickname`;",
			),
		).toContain(
			lines(
				"Change the table users:",
				"  • add the column age: int, required, defaults to 0 (if it isn't there yet)",
				"  • remove the column legacy",
				"  • make name required",
				"  • rename the column nick to nickname",
			),
		);
	});

	test("several statements in one transaction", () => {
		expect(
			say(
				"await sql`begin; update accounts set balance = balance - ${amt} where id = ${from}; update accounts set balance = balance + ${amt} where id = ${to}; commit`;",
			),
		).toBe(
			lines(
				"Run 4 SQL statements:",
				"  • start a transaction",
				"  • change rows in accounts:",
				"    • decreasing balance by amount",
				"    • where id is from",
				"  • change rows in accounts:",
				"    • increasing balance by amount",
				"    • where id is to",
				"  • commit the transaction (save its changes)",
				"  • SQL: begin; update accounts set balance = balance - ${amt} where id = ${from}; update accounts set balance = balance + ${amt} where id = ${to}; commit",
			),
		);
		expect(say("await sql`begin isolation level serializable`;")).toContain("• isolation level: serializable");
	});
});

describe("graceful degradation", () => {
	test("SQL the parser can't read is shown whole, never truncated", () => {
		const cols = Array.from({ length: 60 }, (_, i) => `column_number_${i}`).join(", ");
		const code = `await sql\`insert into t (${cols}) values (?) on duplicate key update a = values(a)\`;`;
		const text = say(code);
		expect(text).toBe(`Run the SQL insert into t (${cols}) values (?) on duplicate key update a = values(a).`);
	});

	test("without a parser every SQL site still shows its full SQL", () => {
		const text = narrate("const users = await sql`select * from users where id = ${id}`;", { plugins: [sql()] });
		expect(text).toBe("Let users be the result of the SQL select * from users where id = ${id}.");
	});

	test("a lazily loaded parser is picked up once it's ready", () => {
		let loaded: SqlParser | null = null;
		const lazy = [sql({ parser: () => loaded })];
		const code = "await sql`delete from t where id = ${id}`;";
		expect(narrate(code, { plugins: lazy })).toBe("Run the SQL delete from t where id = ${id}.");
		loaded = pgsqlParser;
		expect(narrate(code, { plugins: lazy })).toContain("Delete rows from t:");
	});
});

describe("guards", () => {
	test("non-SQL calls with SQL-ish method names are left alone", () => {
		const code =
			'const data = await api.query("select the best option"); const x = cache.get(1); const y = cache.prepare("select"); const z = await graphql.query(`query { users { id } }`); const w = await db.query("users"); const v = el.exec("SELECT");';
		expect(narrate(code, { plugins })).toBe(narrate(code));
	});

	test("other tagged templates are not claimed", () => {
		const code = "const q = gql`query { users { id } }`; const s = css`color: red`; const h = html`<b>${x}</b>`;";
		expect(narrate(code, { plugins })).toBe(narrate(code));
	});

	test("with the Drizzle plugin loaded, Drizzle's sql template stays Drizzle's and borrows this plugin's SQL reading", () => {
		const code =
			'import { sql, eq } from "drizzle-orm";\nconst q = await db.select().from(users).where(sql`${users.id} = ${id}`);\nawait db.execute(sql`delete from x`);';
		expect(narrate(code, { plugins: [drizzle(), ...plugins] })).toBe(
			lines(
				"Let q be the rows of users:",
				"  • where the SQL condition ${users.id} = ${id} holds",
				"",
				"Delete rows from x:",
				"  • in every row (there's no condition)",
				"  • SQL: delete from x",
			),
		);
	});

	test("a postgres.js sql template is not Drizzle's, even with the Drizzle plugin loaded", () => {
		const code = 'import postgres from "postgres";\nconst sql = postgres(url);\nawait sql`delete from x where id = ${id}`;';
		expect(narrate(code, { plugins: [drizzle(), ...plugins] })).toBe(narrate(code, { plugins }));
		expect(narrate(code, { plugins: [...plugins, drizzle()] })).toBe(narrate(code, { plugins }));
	});
});
