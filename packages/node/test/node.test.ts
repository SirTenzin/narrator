import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderText } from "@usenarrator/core";
import { createNodeNarrator, loadDependencyIndex } from "@usenarrator/node";

const project = () => {
	const dir = mkdtempSync(join(tmpdir(), "narrator-node-"));
	mkdirSync(join(dir, "apps/api"), { recursive: true });
	writeFileSync(join(dir, "package.json"), JSON.stringify({ workspaces: ["apps/*"], devDependencies: { typescript: "^5" } }));
	writeFileSync(join(dir, "apps/api/package.json"), JSON.stringify({ dependencies: { hono: "^4.6.0" } }));
	return dir;
};

test("loadDependencyIndex reads a repo's manifests; paths may be absolute or root-relative", () => {
	const dir = project();
	const index = loadDependencyIndex({ root: dir });
	expect(index.forFile(join(dir, "apps/api/src/app.ts"), "npm")).toEqual({ typescript: "^5", hono: "^4.6.0" });
	expect(index.forFile("scripts/seed.ts", "npm")).toEqual({ typescript: "^5" });
});

test("createNodeNarrator wires the native parser and English", () => {
	const narrator = createNodeNarrator({ dependencies: false });
	expect(renderText(narrator.narrate("const total = items.reduce((a, i) => a + i.price, 0);", "x.ts").lines)).toBe(
		"Let total be the total price across items.",
	);
});
