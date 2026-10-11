import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderText } from "@usenarrator/core";
import { changedFilesFromGit, createNodeNarrator, loadDependencyIndex } from "@usenarrator/node";

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

const repo = (files: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), "narrator-git-"));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
	const commit = (next: Record<string, string>) => {
		for (const [path, text] of Object.entries(next)) {
			mkdirSync(join(dir, path, ".."), { recursive: true });
			writeFileSync(join(dir, path), text);
		}
		git("add", "-A");
		git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "c");
		return git("rev-parse", "HEAD");
	};
	git("init", "-q");
	return { dir, base: commit(files), commit };
};

test("changedFilesFromGit reads both sides and skips generated files without reading them", () => {
	const { dir, base, commit } = repo({ ".gitattributes": "src/gen.ts linguist-generated\n", "src/a.ts": "const a = 1;\n", "src/gen.ts": "x;\n" });
	const head = commit({ "src/a.ts": "const a = 2;\n", "src/gen.ts": "y;\n", "dist/out.js": "z();\n", "README.md": "hi\n" });
	const files = changedFilesFromGit({ root: dir, range: `${base}..${head}`, accepts: (p) => /\.[jt]s$/.test(p) });
	expect(files).toEqual([
		{ path: "dist/out.js", oldPath: null, status: "added", oldSrc: "", newSrc: "", skipped: "build output" },
		{ path: "src/a.ts", oldPath: null, status: "modified", oldSrc: "const a = 1;\n", newSrc: "const a = 2;\n" },
		{ path: "src/gen.ts", oldPath: null, status: "modified", oldSrc: "", newSrc: "", skipped: "generated" },
	]);
	expect(changedFilesFromGit({ root: dir, range: `${base}..${head}`, includeGenerated: true }).find((f) => f.path === "src/gen.ts")).toMatchObject({
		oldSrc: "x;\n",
		newSrc: "y;\n",
	});
});
