import { expect, test } from "bun:test";
import { narrate } from "../src/engine";

const wasmUrl = Bun.pathToFileURL(Bun.resolveSync("@oxc-parser/binding-wasm32-wasip1/wasm", import.meta.dir)).href;
const text = (files: Awaited<ReturnType<typeof narrate>>["files"]) =>
	files.flatMap((f) => f.units.flatMap((u) => u.rows.map((r) => (r.right?.html ?? "").replace(/<[^>]+>/g, "")))).join("\n");

test("narrates with the plugins the nearest package.json declares, merged over the root's", async () => {
	const { files, plugins } = await narrate({
		owner: "someone",
		wasmUrl,
		manifests: [
			["package.json", JSON.stringify({ devDependencies: { vitest: "^3" } })],
			["apps/api/package.json", JSON.stringify({ dependencies: { hono: "^4.6.0" } })],
		],
		files: [
			{
				path: "apps/api/src/app.ts",
				oldPath: null,
				status: "added",
				oldSrc: "",
				newSrc: 'import { Hono } from "hono";\nconst app = new Hono();\napp.get("/health", (c) => c.json({ ok: true }));\n',
			},
		],
	});
	expect(plugins).toEqual(["testing", "hono", "sql"]);
	expect(text(files)).toContain("Answer GET /health");
});

test("SQL in a changed file loads the SQL parser and reads its clauses", async () => {
	const { files, plugins } = await narrate({
		owner: "someone",
		wasmUrl,
		manifests: [["package.json", JSON.stringify({ dependencies: { postgres: "^3" } })]],
		files: [
			{
				path: "db.ts",
				oldPath: null,
				status: "added",
				oldSrc: "",
				newSrc: "export async function load(id: string) {\n\treturn sql`SELECT name FROM users WHERE id = ${id}`;\n}\n",
			},
		],
	});
	expect(plugins).toContain("sql (pgsql parser)");
	expect(text(files)).toMatch(/users/);
});
