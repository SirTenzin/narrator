import { describe, expect, test } from "bun:test";
import { type ChangedFile, contentSkipReason, createNarrator, pathSkipReason, renderDiffText, renderText, type SourceLanguage } from "@usenarrator/core";
import { definePlugin, typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en } from "@usenarrator/locale-en";

const narrator = createNarrator({ languages: [typescript({ parser: oxcParser })], locale: en });
const modified = (path: string, oldSrc: string, newSrc: string): ChangedFile => ({ path, oldPath: null, status: "modified", oldSrc, newSrc });

// A language that crashes on any source containing "boom", standing in for a broken plugin or engine bug.
const fragile: SourceLanguage = {
	id: "fragile",
	handles: (path) => path.endsWith(".ts"),
	create: () => ({
		narrate: (src) => {
			if (src.includes("boom")) throw new Error("rule bug");
			return { lines: [{ d: 0, text: src, start: 0, end: src.length, kind: "stmt" }], errors: 0, stats: { nodes: 1, fallbacks: 0, fallbackTypes: {} } };
		},
		units: (src) => {
			if (src.includes("boom")) throw new Error("rule bug");
			return [{ key: "x", title: "x", start: 0, end: src.length, lines: [{ d: 0, text: src, start: 0, end: src.length, kind: "stmt" }] }];
		},
	}),
};

describe("one bad file never takes down the call", () => {
	const crashy = createNarrator({ languages: [fragile], locale: en });

	test("narrate returns a narrator problem instead of throwing", () => {
		expect(crashy.narrate("boom", "a.ts")).toEqual({
			lines: [],
			errors: 0,
			stats: { nodes: 0, fallbacks: 0, fallbackTypes: {} },
			problems: [{ path: "a.ts", message: "rule bug", severity: "error", source: "narrator" }],
		});
		expect(() => crashy.narrate("x", "a.py")).toThrow("No source language handles a.py");
	});

	test("diffFiles and diff report the crashed file and narrate the rest", () => {
		const files = [modified("bad.ts", "ok", "boom"), modified("good.ts", "before", "after")];
		expect(renderDiffText({ files: crashy.diffFiles(files) })).toBe(
			[
				"bad.ts [modified, +0 -0]",
				"  ! Couldn't narrate this file: rule bug",
				"good.ts [modified, +1 -1]",
				"  ~ x [modified]",
				"    - before",
				"    + after",
			].join("\n"),
		);
		const [bad, good] = crashy.diff(files);
		expect(bad).toMatchObject({ path: "bad.ts", units: [], problems: [{ source: "narrator", message: "rule bug" }] });
		expect(good).toMatchObject({ path: "good.ts", problems: [], adds: 1, dels: 1 });
	});

	test("a throwing plugin rule is reported, and other files still narrate", () => {
		const broken = definePlugin({
			name: "broken",
			calls: {
				explode: () => {
					throw new Error("rule bug");
				},
			},
		});
		const withBroken = createNarrator({ languages: [typescript({ parser: oxcParser, plugins: [broken] })], locale: en });
		const result = withBroken.narrate("const a = 1;\nexplode();\n", "a.ts");
		expect(result.problems).toHaveLength(1);
		expect(result.problems[0]!.message).toContain("rule bug");
		const diff = withBroken.diffFiles([modified("a.ts", "", "explode();\n"), modified("b.ts", "const b = 1;\n", "const b = 2;\n")]);
		expect(diff.find((f) => f.path === "b.ts")!.adds).toBe(1);
	});
});

test("a file renamed from a type no language reads counts as added, not as a crash", () => {
	const [file] = narrator.diffFiles([
		{ path: "types.ts", oldPath: "types.d.ts", status: "renamed", oldSrc: "declare const a: number;\n", newSrc: "const a = 1;\n" },
	]);
	expect(file).toMatchObject({ problems: [], adds: 1, units: [{ status: "added" }] });
});

describe("syntax errors", () => {
	test("are reported with their line, and the narration keeps what was read", () => {
		const result = narrator.narrate("const a = 1;\nconst b = ;\n", "a.ts");
		expect(result.errors).toBe(1);
		expect(result.problems).toEqual([{ path: "a.ts", message: "Unexpected token", severity: "error", source: "parser", line: 2 }]);
	});

	test("recoverable ones still narrate", () => {
		const result = narrator.narrate("const a = 1;\nreturn a;\n", "a.ts");
		expect(result.problems[0]).toMatchObject({ source: "parser", line: 2 });
		expect(renderText(result.lines)).toBe("Let a be 1.\nGive back a.");
	});

	test("in a diff they don't turn every later declaration into a removal", () => {
		const [file] = narrator.diffFiles([modified("a.ts", "const a = 1;\nconst b = 2;\n", "const a = 2;\nconst b = ;\n")]);
		expect(file!.problems).toMatchObject([{ source: "parser", line: 2 }]);
		expect(file!.units.map((u) => u.status)).not.toContain("removed");
	});
});

describe("generated files", () => {
	test("paths give away dependencies, build output, vendored code and lockfiles", () => {
		expect(pathSkipReason(".yarn/releases/yarn-3.2.1.cjs")).toBe("vendored");
		expect(pathSkipReason("apps/web/dist/out.js")).toBe("build output");
		expect(pathSkipReason("apps/web/.next/server/page.js")).toBe("build output");
		expect(pathSkipReason("node_modules/zod/index.js")).toBe("dependency");
		expect(pathSkipReason("public/vendor.min.js")).toBe("minified");
		expect(pathSkipReason("pnpm-lock.yaml")).toBe("lockfile");
		expect(pathSkipReason("build/app.js")).toBe("build output");
		expect(pathSkipReason("tools/build/build.ts")).toBeNull();
		expect(pathSkipReason("src/distance.ts")).toBeNull();
	});

	test("content gives away banners and minified code", () => {
		expect(contentSkipReason("// Code generated by Speakeasy. DO NOT EDIT.\nexport const a = 1;\n")).toBe("generated");
		expect(contentSkipReason("/** @generated */\nexport const a = 1;\n")).toBe("generated");
		expect(contentSkipReason("// Tests that we override the auto-generated keys\nconst a = 1;\n")).toBeNull();
		expect(contentSkipReason(`var a=1;${"function f(){return 1};".repeat(200)}`)).toBe("minified");
		expect(contentSkipReason("const a = 1;\n".repeat(500))).toBeNull();
	});

	test("diffs skip them by default, list them, and include them on request", () => {
		const files: ChangedFile[] = [
			{ path: "dist/out.js", oldPath: null, status: "deleted", oldSrc: "const a = 1;\n", newSrc: "" },
			modified("src/a.ts", "const a = 1;\n", "const a = 2;\n"),
		];
		expect(renderDiffText({ files: narrator.diffFiles(files) })).toBe(
			["dist/out.js [deleted, skipped: build output]", "src/a.ts [modified, +1 -1]", "  ~ a [modified]", "    - Let a be 1.", "    + Let a be 2."].join("\n"),
		);
		expect(narrator.diff(files)[0]).toMatchObject({ path: "dist/out.js", skipped: "build output", units: [] });
		expect(narrator.diffFiles(files, { includeGenerated: true })[0]).toMatchObject({ path: "dist/out.js", dels: 1 });
		expect(narrator.diffFiles([{ ...modified("src/gen.ts", "", ""), skipped: "generated" }])[0]!.skipped).toBe("generated");
	});
});
