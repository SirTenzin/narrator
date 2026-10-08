import type { CorePhrases, Grammar, Locale } from "@narrate/core";

const grammar: Grammar = {
	list: (xs, conj = "and") =>
		xs.length <= 1 ? (xs[0] ?? "") : xs.length === 2 ? `${xs[0]} ${conj} ${xs[1]}` : `${xs.slice(0, -1).join(", ")}, ${conj} ${xs.at(-1)}`,
	formatNumber: (n) => n.toLocaleString("en-US"),
};

const phrases: CorePhrases = {
	ops: { "+": "plus", "-": "minus", "*": "times", "/": "divided by", "%": "modulo", "**": "to the power of", "<<": "shifted left by", ">>": "shifted right by", "&": "bitwise-and", "|": "bitwise-or" },
	fallback: ({ value, fallback }) => `${value}, or ${fallback} if that's missing`,
	fallbackBlock: ({ value, fallback }) => `${value}, or if that's missing, ${fallback}`,
	fallbackInline: ({ value, fallback }) => `${value} (or ${fallback} if that's missing)`,
};

export const en: Locale = { id: "en", grammar, phrases };
