import { expect, test } from "bun:test";
import { narrate, phrasebookGaps } from "@usenarrator/testkit";
import { en } from "../src";

test("phrasebookGaps reports the keys a partial translation is missing", () => {
	const partial = {
		expressions: { nothing: "nada", member: { firstOf: ({ value }: { value: string }) => `el primero de ${value}` }, bogus: "x" },
		statements: { stop: "Detente aquí" },
	};
	const { missing, extra } = phrasebookGaps(en.phrases, partial);
	expect(missing).toContain("expressions.ops.+");
	expect(missing).toContain("expressions.member.lastOf");
	expect(missing).toContain("conditions.compare.<");
	expect(missing).toContain("types.explain.member");
	expect(missing).not.toContain("expressions.nothing");
	expect(missing).not.toContain("expressions.member.firstOf");
	expect(missing).not.toContain("statements.stop");
	expect(extra).toEqual(["expressions.bogus"]);
});

test("the English phrasebook has no gaps against itself", () => {
	expect(phrasebookGaps(en.phrases, en.phrases)).toEqual({ missing: [], extra: [] });
});

test("word order comes from the phrasebook, not the walker", () => {
	const ops = { ...en.phrases.expressions.ops, "+": ({ left, right }: { left: string; right: string }) => `la suma de ${left} y ${right}` };
	const locale = { ...en, phrases: { ...en.phrases, expressions: { ...en.phrases.expressions, ops } } };
	expect(narrate("const n = a + b;", { locale })).toBe("Let n be la suma de a y b.");
});
