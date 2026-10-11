import { expect, test } from "bun:test";
import { ancestorDirs, looksLikeSqlSource, majorOf, selectPlugins, versionsFor } from "../src/deps";

test("majors come from the declared range", () => {
	expect(majorOf("^4.0.0-beta.3")).toBe(4);
	expect(majorOf("~3.12.1")).toBe(3);
	expect(majorOf(">=1.2 <2")).toBe(1);
	expect(majorOf("npm:effect@^3.10.0")).toBe(3);
	expect(majorOf("workspace:*")).toBeNull();
	expect(majorOf("latest")).toBeNull();
	expect(majorOf(undefined)).toBeNull();
});

test("versions pin only majors the plugins know", () => {
	expect(versionsFor({ effect: "^4.0.0-beta.1", elysia: "^1.3.0", ai: "^5.0.0" })).toEqual({ effect: 4, elysia: 1, aiSdk: undefined });
});

test("plugins load only for libraries the change's packages use", () => {
	const ids = selectPlugins({ union: { hono: "^4", "drizzle-orm": "^0.40", "@effect/platform": "^0.80" }, paths: ["src/app.ts"], owner: "someone" });
	expect([...ids].sort()).toEqual(["drizzle", "effect", "hono"]);
});

test("testing loads for a test runner or a test file; autumn only for its own repos", () => {
	expect(selectPlugins({ union: { vitest: "^3" }, paths: ["a.ts"], owner: "x" }).has("testing")).toBe(true);
	expect(selectPlugins({ union: {}, paths: ["src/a.test.ts"], owner: "x" }).has("testing")).toBe(true);
	expect(selectPlugins({ union: {}, paths: ["src/a.ts"], owner: "x" }).has("testing")).toBe(false);
	expect(selectPlugins({ union: {}, paths: ["a.ts"], owner: "useautumn" }).has("autumn")).toBe(true);
});

test("no manifest found loads everything", () => {
	expect(selectPlugins({ union: null, paths: ["a.ts"], owner: "x" }).size).toBe(11);
});

test("ancestor directories run from the file's folder to the root", () => {
	expect(ancestorDirs("packages/core/src/a.ts")).toEqual(["packages/core/src", "packages/core", "packages", ""]);
	expect(ancestorDirs("a.ts")).toEqual([""]);
});

test("SQL-looking source is spotted, prose mentioning SQL words isn't", () => {
	expect(looksLikeSqlSource("await sql`SELECT id FROM users WHERE id = ${id}`")).toBe(true);
	expect(looksLikeSqlSource('db.query("insert into t (a) values ($1)", [a])')).toBe(true);
	expect(looksLikeSqlSource("const msg = 'select a plan from the list'")).toBe(true);
	expect(looksLikeSqlSource('const msg = "Please select an option"')).toBe(false);
	expect(looksLikeSqlSource("db.select().from(users)")).toBe(false);
});
