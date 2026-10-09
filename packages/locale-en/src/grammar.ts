import type { Grammar } from "@usenarrator/core";

const NEGATED_PREFIX: Record<string, string> = {
	is: "is not",
	are: "are not",
	was: "was not",
	were: "were not",
	has: "has no",
	have: "have no",
	had: "had no",
	can: "cannot",
	should: "should not",
	did: "did not",
	does: "does not",
	do: "do not",
	will: "will not",
	needs: "does not need",
	need: "does not need",
	must: "must not",
	allows: "does not allow",
	allow: "does not allow",
	wants: "does not want",
	supports: "does not support",
	requires: "does not require",
	contains: "does not contain",
	matches: "does not match",
	exists: "does not exist",
	uses: "does not use",
	includes: "does not include",
	skip: "do not skip",
	skips: "does not skip",
};

const TIME_WORDS = /(^|\s)(at|date|time|timestamp|until|since|deadline|expiry|expires|ends|starts|now|period end|period start|anchor)$/i;

const isPlural = (s: string) => /[^s]s$/.test(s) || /ies$/.test(s);

const possessive = (s: string) => {
	const bare = s.replace(/\uE002$/, "");
	return /s$/.test(bare) && !/(ss|us|is)$/.test(bare) ? `${s}'` : `${s}'s`;
};

export const grammar: Grammar = {
	list: (xs, conj = "and") =>
		xs.length <= 1 ? (xs[0] ?? "") : xs.length === 2 ? `${xs[0]} ${conj} ${xs[1]}` : `${xs.slice(0, -1).join(", ")}, ${conj} ${xs.at(-1)}`,
	formatNumber: (n) => n.toLocaleString("en-US"),
	article: (s) => (/^[aeiou]/i.test(s) && !/^(one|uni|use)/i.test(s) ? "an" : "a"),
	possessive,
	plural: (w) => {
		if (isPlural(w)) return w;
		if (/IDs?$/.test(w) || w.endsWith("ID")) return `${w}s`;
		if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
		if (/(s|x|ch|sh)$/.test(w)) return `${w}es`;
		return `${w}s`;
	},
	singular: (s) => {
		if (/ies$/.test(s)) return s.replace(/ies$/, "y");
		if (/(ss|us|is)$/.test(s)) return s;
		if (/(ches|shes|xes|sses)$/.test(s)) return s.replace(/es$/, "");
		if (/s$/.test(s)) return s.slice(0, -1);
		return s;
	},
	isPlural,
	negatePredicateHead: (w) => NEGATED_PREFIX[w] ?? `does not ${w.replace(/(ch|sh|x|ss)es$/, "$1").replace(/s$/, "")}`,
	bareNoun: (s) => s.replace(/^an? /, ""),
	isTimeLike: (s) => TIME_WORDS.test(s) || /\b(now|date)\b/i.test(s),
};

/** Owner-first possessive chain: ["customer", "plan", "name"] -> "customer's plan's name". */
export const possessiveChain = (path: string[]) => path.map((w, i) => (i < path.length - 1 ? possessive(w) : w)).join(" ");

/** " x" when present, "" otherwise. */
export const sp = (x: string | null | undefined) => (x ? ` ${x}` : "");
