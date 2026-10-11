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

	test("reduce adding the items themselves reads as a sum; a non-zero start is kept", () => {
		reads(`const t = xs.reduce((a, b) => a + b, 0);`, "Let t be the sum of xs.");
		reads(`const t = items.reduce((s, i) => s + i.amount, start);`, "Let t be start plus the total amount across items.");
	});

	test("timers, pauses and races", () => {
		reads(`await new Promise((r) => setTimeout(r, 2000));`, "Wait 2 seconds.");
		reads(`await Bun.sleep(pollMs);`, "Wait poll ms.");
		reads(`setTimeout(() => go(), 50);`, "After 50ms, do the following:\n  Run go.");
		reads(`const t = setInterval(() => sweep(), 1000);`, "Let t be a timer that, every 1 second, does the following:\n  Run sweep.");
		reads(`clearTimeout(timer);`, "Cancel timer.");
		reads(
			`const w = await Promise.race([work(), new Promise((r) => setTimeout(r, 5))]);`,
			"Let w be whichever of these finishes first:\n  • run work\n  • a pause of 5ms",
		);
		reads(`const s = AbortSignal.timeout(5000);`, "Let s be a signal that times out after 5 seconds.");
	});

	test("dates, big integers, matches and events", () => {
		reads(`const t = Date.UTC(2026, 7, 22);`, "Let t be the UTC timestamp for 2026, 7, and 22.");
		reads(`const b = BigInt(x);`, "Let b be x as a big integer.");
		reads(`const m = s.match(/a/g);`, "Let m be every match of /a/g in s.");
		reads(`e.preventDefault();`, "Stop the browser's default handling of e.");
		reads(`const n = Number.NaN;`, "Let n be not-a-number.");
	});

	test("sized lists and promise finally", () => {
		reads(`const xs = Array.from({ length: 6 }, () => seed);`, "Let xs be a list of 6 items, each seed.");
		reads(`const xs = Array.from({ length: n }, (_, i) => i);`, "Let xs be the numbers from 0 up to (but not including) n.");
		reads(`p.finally(() => cleanup());`, "P, then either way cleanup.");
	});

	test("push with no arguments is left to the method reading", () => reads(`scenario.push();`, "Push scenario."));

	test("a destructuring find reads as 'whose'", () =>
		reads(`const first = rows.find(({ id }) => id === target);`, "Let first be the one in rows whose ID is target."));

	test("some, every and has read as conditions", () => {
		reads(`const ok = list.some((x) => x.ok);`, "Let ok mean list has an x whose ok is true.");
		reads(`if (ids.every((id) => seen.has(id))) done();`, "If every ID in IDs is in seen, run done.");
		reads(`if (!names.includes(name)) throw new Error("x");`, `If name is not in names, fail with an error: "x".`);
	});

	test("a chain reads as numbered steps", () =>
		reads(
			`const amounts = prices.filter((p) => p.active).map((p) => p.amount);`,
			"Let amounts be prices, after these steps:\n  1. Keep only those where p's active is set\n  2. Take each one's amount",
		));

	test("Promise.all over a map runs each item at the same time", () =>
		reads(`await Promise.all(users.map((u) => notify(u)));`, "For every u in users, all at the same time:\n  Notify (u)."));

	test("values, logging and constants", () => {
		reads(`console.log("hello", { userId });`, `Log "hello" (with user ID).`);
		reads(`const s = name.trim().toLowerCase();`, "Let s be name without surrounding spaces in lowercase.");
		reads(`const n = Math.max(a, b, c);`, "Let n be the largest of a, b, and c.");
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
