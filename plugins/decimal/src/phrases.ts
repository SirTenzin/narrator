type Pair = (p: { a: string; b: string }) => string;
type Is = (p: { value: string; neg: boolean }) => string;

/** Everything the decimal.js plugin says. Arguments are already-rendered markup strings. */
export type DecimalPhrases = {
	plus: Pair;
	minus: Pair;
	times: Pair;
	dividedBy: Pair;
	roundedTo: (p: { value: string; places: string }) => string;
	/** Comparisons; a negated `lte` is phrased as `moreThan`, and so on. */
	compare: Record<"atMost" | "lessThan" | "atLeast" | "moreThan" | "equals" | "notEquals", Pair>;
	isZero: Is;
	isNegative: Is;
	isPositive: Is;
};
