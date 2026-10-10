import type { Locale } from "@usenarrator/core";
import { en } from "@usenarrator/locale-en";
import { type DecimalPhrases, decimal, decimalEn } from "@usenarrator/plugin-decimal";
import { narrate, phrasebookGaps } from "@usenarrator/testkit";

// A partial Spanish locale: unchanged phrases fall back to English.
const decimalEs: DecimalPhrases = {
	...decimalEn,
	times: ({ a, b }) => `${a} por ${b}`,
	plus: ({ a, b }) => `${a} más ${b}`,
};

const es: Locale = {
	id: "es",
	grammar: en.grammar,
	phrases: {
		...en.phrases,
		declarations: { ...en.phrases.declarations, let: ({ name, value }) => `Sea ${name} igual a ${value}` },
		statements: { ...en.phrases.statements, ifThen: ({ condition, action }) => `Si ${condition}, ${action}` },
	},
	plugins: { decimal: decimalEs },
};

const code = `
const total = new Decimal(price).times(quantity).plus(shipping);
if (total.isZero()) stop();
`;

console.log(narrate(code, { plugins: [decimal()], locale: es }));
console.log(phrasebookGaps(decimalEn, { times: () => "", plus: () => "" }));
