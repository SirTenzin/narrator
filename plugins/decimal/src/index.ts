import { D } from "@narrate/core";
import { definePlugin, type Engine, type N, type TsPlugin, unwrap } from "@narrate/lang-ts";

const bin =
	(word: string) =>
	({ obj, args, e }: { obj: N; args: N[]; e: Engine }) => {
		const a = e.noun(obj);
		const b = e.noun(args[0]);
		return D(`${a.t} ${word} ${b.t}`, [...a.kids, ...b.kids]);
	};

const decCmp =
	(word: string, negWord: string) =>
	({ obj, args, e, neg }: { obj: N; args: N[]; e: Engine; neg: boolean }) => {
		if (args.length !== 1 || !obj) return null;
		const a = e.noun(obj);
		const b = e.noun(args[0]);
		return D(`${a.t} ${neg ? negWord : word} ${b.t}`, [...a.kids, ...b.kids]);
	};

const decimalUnwrap = ({ obj, e }: { obj: N; e: Engine }) => e.noun(obj);

const isNewDecimal = (n: N) => unwrap(n).type === "NewExpression" && unwrap(n).callee?.name === "Decimal";

/** decimal.js: `new Decimal(x).plus(y).lte(z)` reads as arithmetic and comparisons. */
export const decimal = (): TsPlugin =>
	definePlugin({
		name: "decimal",
		calls: {
			"new Decimal": ({ args, e }) => e.noun(args[0]),
			"*.plus": bin("plus"),
			"*.add": (x) => (isNewDecimal(x.obj) ? bin("plus")(x) : null),
			"*.minus": bin("minus"),
			"*.sub": bin("minus"),
			"*.times": bin("times"),
			"*.mul": bin("times"),
			"*.div": bin("divided by"),
			"*.dividedBy": bin("divided by"),
			"*.toNumber": decimalUnwrap,
			"*.toDecimalPlaces": ({ obj, args, e }) => D(`${e.text(obj)} rounded to ${e.text(args[0])} decimal places`),
		},
		conditions: {
			"*.lte": decCmp("is at most", "is more than"),
			"*.lt": decCmp("is less than", "is at least"),
			"*.gte": decCmp("is at least", "is less than"),
			"*.gt": decCmp("is more than", "is at most"),
			"*.eq": decCmp("is", "is not"),
			"*.equals": decCmp("is", "is not"),
			"*.isZero": ({ obj, e, neg }) => D(`${e.text(obj)} is ${neg ? "not " : ""}zero`),
			"*.isNegative": ({ obj, e, neg }) => D(`${e.text(obj)} is ${neg ? "not " : ""}negative`),
			"*.isPositive": ({ obj, e, neg }) => D(`${e.text(obj)} is ${neg ? "not " : ""}positive`),
		},
	});
