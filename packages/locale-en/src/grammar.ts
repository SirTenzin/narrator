import { type Grammar, plain } from "@usenarrator/core";

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

/** Initialisms are read letter by letter, so "an HTTP", "an SQL", "a URL"; words go by their first sound. */
const article = (s: string) => {
	const first = plain(s).trim().split(/[\s-]/)[0] ?? "";
	if (/^[A-Z][A-Z0-9]*[A-Z0-9](s|es)?$/.test(first) || /^[A-Z][A-Z]+[a-z]/.test(first)) return /^[AEFHILMNORSX]/.test(first) ? "an" : "a";
	if (/^[a-z]$/i.test(first)) return /^[aefhilmnorsx]$/i.test(first) ? "an" : "a";
	if (/^(hour|honest|honou?r|heir)/i.test(first)) return "an";
	return /^[aeiou]/i.test(first) && !/^(one|once|uni|use|usu|uti|eu|ure|ura)/i.test(first) ? "an" : "a";
};

export const grammar: Grammar = {
	list: (xs, conj = "and") =>
		xs.length <= 1 ? (xs[0] ?? "") : xs.length === 2 ? `${xs[0]} ${conj} ${xs[1]}` : `${xs.slice(0, -1).join(", ")}, ${conj} ${xs.at(-1)}`,
	formatNumber: (n) => n.toLocaleString("en-US"),
	article,
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
	isPluralSubject: (s) => pluralSubject(s),
	isTimeLike: (s) => TIME_WORDS.test(s) || /\b(now|date)\b/i.test(s),
};

const SINGULAR_S = new Set([
	"ms",
	"this",
	"its",
	"has",
	"was",
	"yes",
	"always",
	"plus",
	"news",
	"series",
	"species",
	"canvas",
	"alias",
	"atlas",
	"bias",
	"gas",
	"lens",
	"chaos",
	"perhaps",
	"whereas",
	"unless",
	"sometimes",
	"analytics",
]);

/** Whether a rendered subject's head noun is plural: "customer's items" yes, "the number of items" and "status" no. */
export const pluralSubject = (subject: string) => {
	const text = plain(subject);
	const [front = "", ...after] = text.split(/ (?:of|in|across) /);
	// "the unique values of codes' size": a possessive after "of" makes the last word the head.
	const owned = after.length > 0 && /['’]s? \S+$/.test(after.join(" ").split(/[,(]/)[0]!);
	const phrase = owned
		? text.split(/[,(]/)[0]!
		: front.split(/ (?:for|from|with|where|whose|keeping|that|which|without|minus|plus|times|divided|joined|if|or|and|as)\b|[,(:]/)[0]!;
	const head = phrase.trim().split(/\s+/).at(-1) ?? "";
	// "check messages (…)": a call's name isn't a plural noun.
	if (!owned && /^\s*\(/.test(front.slice(phrase.length))) return false;
	if (/^[A-Z]+s$/.test(head)) return true;
	const w = head.toLowerCase();
	if (SINGULAR_S.has(w) || /(ss|us|is|'s)$/.test(w)) return false;
	return /[a-z]s$/.test(w) || w === "people" || w === "children";
};

/** "is"/"are" (and friends) agreeing with a rendered subject. */
export const verbFor = (subject: string) => {
	const many = pluralSubject(subject);
	return { is: many ? "are" : "is", isNot: many ? "are not" : "is not", has: many ? "have" : "has", does: many ? "do" : "does" };
};

/** Owner-first possessive chain: ["customer", "plan", "name"] -> "customer's plan's name". */
export const possessiveChain = (path: string[]) => path.map((w, i) => (i < path.length - 1 ? possessive(w) : w)).join(" ");

/** " x" when present, "" otherwise. */
export const sp = (x: string | null | undefined) => (x ? ` ${x}` : "");
