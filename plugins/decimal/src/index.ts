import { D } from "@narrate/core";
import { type CallRule, type CondRule, definePlugin, type N, type TsPlugin, unwrap } from "@narrate/lang-ts";
import { en } from "./en";
import type { DecimalPhrases } from "./phrases";

export type { DecimalPhrases } from "./phrases";
export { en as decimalEn };

type Op = "plus" | "minus" | "times" | "dividedBy";
type Comparison = keyof DecimalPhrases["compare"];

const arithmetic =
	(op: Op): CallRule<DecimalPhrases> =>
	({ obj, args, e, say }) => {
		const a = e.noun(obj);
		const b = e.noun(args[0]);
		return D(say[op]({ a: a.t, b: b.t }), [...a.kids, ...b.kids]);
	};

/** `negated` is the comparison that holds when this one doesn't, e.g. at most -> more than. */
const comparison =
	(holds: Comparison, negated: Comparison): CondRule<DecimalPhrases> =>
	({ obj, args, e, neg, say }) => {
		if (args.length !== 1 || !obj) return null;
		const a = e.noun(obj);
		const b = e.noun(args[0]);
		return D(say.compare[neg ? negated : holds]({ a: a.t, b: b.t }), [...a.kids, ...b.kids]);
	};

const sign =
	(key: "isZero" | "isNegative" | "isPositive"): CondRule<DecimalPhrases> =>
	({ obj, e, neg, say }) =>
		D(say[key]({ value: e.text(obj), neg }));

const isNewDecimal = (n: N) => unwrap(n).type === "NewExpression" && unwrap(n).callee?.name === "Decimal";

/** decimal.js: `new Decimal(x).plus(y).lte(z)` reads as arithmetic and comparisons. */
export const decimal = (): TsPlugin<DecimalPhrases> =>
	definePlugin({
		name: "decimal",
		phrases: { en },
		calls: {
			"new Decimal": ({ args, e }) => e.noun(args[0]),
			"*.plus": arithmetic("plus"),
			"*.add": (x) => (isNewDecimal(x.obj) ? arithmetic("plus")(x) : null),
			"*.minus": arithmetic("minus"),
			"*.sub": arithmetic("minus"),
			"*.times": arithmetic("times"),
			"*.mul": arithmetic("times"),
			"*.div": arithmetic("dividedBy"),
			"*.dividedBy": arithmetic("dividedBy"),
			"*.toNumber": ({ obj, e }) => e.noun(obj),
			"*.toDecimalPlaces": ({ obj, args, e, say }) => D(say.roundedTo({ value: e.text(obj), places: e.text(args[0]) })),
		},
		conditions: {
			"*.lte": comparison("atMost", "moreThan"),
			"*.lt": comparison("lessThan", "atLeast"),
			"*.gte": comparison("atLeast", "lessThan"),
			"*.gt": comparison("moreThan", "atMost"),
			"*.eq": comparison("equals", "notEquals"),
			"*.equals": comparison("equals", "notEquals"),
			"*.isZero": sign("isZero"),
			"*.isNegative": sign("isNegative"),
			"*.isPositive": sign("isPositive"),
		},
	});
