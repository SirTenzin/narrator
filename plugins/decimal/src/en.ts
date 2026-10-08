import type { DecimalPhrases } from "./phrases";

const is =
	(word: string) =>
	({ value, neg }: { value: string; neg: boolean }) =>
		`${value} is ${neg ? "not " : ""}${word}`;

export const en: DecimalPhrases = {
	plus: ({ a, b }) => `${a} plus ${b}`,
	minus: ({ a, b }) => `${a} minus ${b}`,
	times: ({ a, b }) => `${a} times ${b}`,
	dividedBy: ({ a, b }) => `${a} divided by ${b}`,
	roundedTo: ({ value, places }) => `${value} rounded to ${places} decimal places`,
	compare: {
		atMost: ({ a, b }) => `${a} is at most ${b}`,
		lessThan: ({ a, b }) => `${a} is less than ${b}`,
		atLeast: ({ a, b }) => `${a} is at least ${b}`,
		moreThan: ({ a, b }) => `${a} is more than ${b}`,
		equals: ({ a, b }) => `${a} is ${b}`,
		notEquals: ({ a, b }) => `${a} is not ${b}`,
	},
	isZero: is("zero"),
	isNegative: is("negative"),
	isPositive: is("positive"),
};
