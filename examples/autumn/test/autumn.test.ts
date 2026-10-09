import { expect, test } from "bun:test";
import { narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { autumn, autumnEn } from "../src";

const reads = (code: string, text: string) => {
	const r = narrateWithStats(code, { plugins: autumn() });
	expect(r.text).toBe(text);
	expect(r.fallbacks).toBe(0);
};

test("in-house helpers", () => {
	reads(`const ttl = ms.minutes(5);`, "Let TTL be 5 minutes, in milliseconds.");
	reads(`const ids = deduplicateArray(cusIds);`, "Let IDs be customer IDs without duplicates.");
	reads(`if (notNullish(cusEnt)) go();`, "If customer entitlement is set, run go.");
});

test("error labels come from the phrasebook", () => reads(`throw new RecaseError({ message: "no customer" });`, `Fail with an error: "no customer".`));

test("a partial translation reports what it is missing", () => {
	const gaps = phrasebookGaps(autumnEn, { glossary: { cus: "cliente" }, whether: () => "" });
	expect(gaps.missing).toContain("glossary.sub");
	expect(gaps.missing).toContain("errorLabels.RecaseError");
	expect(gaps.extra).toEqual([]);
});
