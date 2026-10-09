import { describe, expect, test } from "bun:test";
import { en } from "@usenarrator/locale-en";
import { narrate, narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { stdEn } from "..";

const reads = (code: string, text: string) => {
	const r = narrateWithStats(code);
	expect(r.text).toBe(text);
	expect(r.fallbacks).toBe(0);
};

describe("std", () => {
	test("map plucks a property", () => reads(`const ids = customers.map((c) => c.id);`, "Let IDs be the IDs of customers."));

	test("reduce over a field reads as a total", () =>
		reads(`const total = items.reduce((sum, item) => sum + item.amount, 0);`, "Let total be the total amount across items."));

	test("a destructuring find reads as 'whose'", () =>
		reads(`const first = rows.find(({ id }) => id === target);`, "Let first be the one in rows whose ID is target."));

	test("some, every and has read as conditions", () => {
		reads(`const ok = list.some((x) => x.ok);`, "Let ok mean list has a x where x's ok is true.");
		reads(`if (ids.every((id) => seen.has(id))) done();`, "If every ID in IDs satisfies: ID is in seen, run done.");
		reads(`if (!names.includes(name)) throw new Error("x");`, `If name is not in names, fail with an error: "x".`);
	});

	test("a chain reads as numbered steps", () =>
		reads(
			`const amounts = prices.filter((p) => p.active).map((p) => p.amount);`,
			"Let amounts be prices, after these steps:\n  1. Keep only those where p's active is set\n  2. Take each one's amount",
		));

	test("Promise.all over a map runs each item at the same time", () =>
		reads(`await Promise.all(users.map((u) => notify(u)));`, "For every u in users, all at the same time:\n  notify (u)"));

	test("values, logging and constants", () => {
		reads(`console.log("hello", { userId });`, `Log "hello" (with user ID).`);
		reads(`const s = name.trim().toLowerCase();`, "Let s be name without surrounding spaces in lowercase.");
		reads(`const n = Math.max(a, b, c);`, "Let n be the larger of a, b, and c.");
		reads(`const big = Number.MAX_SAFE_INTEGER;`, "Let big be the largest possible number.");
		reads(`cache.set(key, value);`, "Record value under key in cache.");
	});

	test("rules speak through the phrasebook, so a locale override changes the words", () => {
		const locale = { ...en, plugins: { std: { ...stdEn, math: { ...stdEn.math, max: ({ values }: { values: string }) => `el mayor de ${values}` } } } };
		expect(narrate(`const n = Math.max(a, b);`, { locale })).toBe("Let n be el mayor de a and b.");
	});

	test("a partial translation reports exactly what it is missing", () => {
		const es = { item: "elemento", each: ({ item }: { item: string }) => `cada ${item}`, map: { pluck: () => "" }, nope: "" };
		const gaps = phrasebookGaps(stdEn, es);
		expect(gaps.missing).toContain("whether");
		expect(gaps.missing).toContain("map.passedThrough");
		expect(gaps.missing).toContain("pipe.stage");
		expect(gaps.missing).not.toContain("map.pluck");
		expect(gaps.extra).toEqual(["nope"]);
	});
});
