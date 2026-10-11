import { expect, test } from "bun:test";
import { createNarrator, type Locale, plain, renderDiffText } from "@usenarrator/core";
import { typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en } from "@usenarrator/locale-en";
import { decimal, en as decimalEn } from "@usenarrator/plugin-decimal";

const narrator = createNarrator({ languages: [typescript({ parser: oxcParser })], locale: en });

const before = `export function isAdult(user: User) {
  return user.age >= 18;
}

export function greet(name: string) {
  console.log("hi", name);
}
`;
const after = `export function isAdult(user: User) {
  return user.age >= 21;
}

export function greet(name: string) {
  console.log("hi", name);
}

export const LIMIT = 5;
`;
const files = [{ path: "user.ts", oldPath: null, status: "modified" as const, oldSrc: before, newSrc: after }];

test("diffFiles gives structured units with their lines", () => {
	const [file] = narrator.diffFiles(files);
	expect(file?.path).toBe("user.ts");
	expect(file?.units.map((u) => [plain(u.title), u.status])).toEqual([
		["Is adult?", "modified"],
		["To greet", "unchanged"],
		["LIMIT", "added"],
	]);
	const mod = file?.units[0]?.rows.find((r) => r.kind === "mod");
	expect(plain(mod?.left?.line.text ?? "")).toBe("Give back whether user's age is at least 18.");
	expect(plain(mod?.right?.line.text ?? "")).toBe("Give back whether user's age is at least 21.");
});

test("renderDiffText shows removed and added English lines, skipping unchanged units", () => {
	expect(renderDiffText({ files: narrator.diffFiles(files) })).toBe(
		[
			"user.ts [modified, +2 -1]",
			"  ~ Is adult? [modified]",
			"      Is adult?, given user (User):",
			"    -   Give back whether user's age is at least 18.",
			"    +   Give back whether user's age is at least 21.",
			"  + LIMIT [added]",
			"    + Let limit be 5.",
		].join("\n"),
	);
});

test("files no language handles are left out of both diff forms", () => {
	const md = { path: "README.md", oldPath: null, status: "modified" as const, oldSrc: "a", newSrc: "b" };
	expect(narrator.diffFiles([md])).toEqual([]);
	expect(narrator.diff([md])).toEqual([]);
});

test("Locale.plugins overrides are typed by each plugin's phrasebook", () => {
	const ok: Locale = { ...en, plugins: { decimal: decimalEn } };
	// @ts-expect-error a decimal override must match DecimalPhrases
	const bad: Locale = { ...en, plugins: { decimal: { nope: 1 } } };
	expect([ok, bad].length).toBe(2);
	expect(decimal().name).toBe("decimal");
});
