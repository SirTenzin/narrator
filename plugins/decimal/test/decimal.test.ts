import { expect, test } from "bun:test";
import { en } from "@usenarrator/locale-en";
import { narrate, narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { decimal, decimalEn } from "../src";

const reads = (code: string, text: string) => {
	const r = narrateWithStats(code, { plugins: [decimal()] });
	expect(r.text).toBe(text);
	expect(r.fallbacks).toBe(0);
};

test("arithmetic chains read left to right", () =>
	reads(`const total = new Decimal(price).times(quantity).plus(fee);`, "Let total be price times quantity plus fee."));

test("comparisons and their negations", () => {
	reads(`if (new Decimal(balance).lte(0)) stop();`, "If balance is at most 0, stop.");
	reads(`if (!new Decimal(balance).lte(0)) go();`, "If balance is more than 0, run go.");
	reads(`if (!amount.isZero()) charge();`, "If amount is not zero, charge.");
});

test("a locale override replaces the plugin's words", () => {
	const locale = { ...en, plugins: { decimal: { ...decimalEn, plus: ({ a, b }: { a: string; b: string }) => `${a} más ${b}` } } };
	expect(narrate(`const t = new Decimal(a).plus(b);`, { plugins: [decimal()], locale })).toBe("Let t be a más b.");
});

test("a partial translation reports what it is missing", () => {
	const gaps = phrasebookGaps(decimalEn, { plus: () => "", compare: { atMost: () => "" } });
	expect(gaps.missing).toContain("compare.moreThan");
	expect(gaps.missing).toContain("isZero");
	expect(gaps.extra).toEqual([]);
});
