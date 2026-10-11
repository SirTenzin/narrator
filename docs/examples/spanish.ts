import { extendLocale } from "@usenarrator/core";
import { en } from "@usenarrator/locale-en";
import { decimal, decimalEn } from "@usenarrator/plugin-decimal";
import { narrate, phrasebookGaps } from "@usenarrator/testkit";

// A partial Spanish locale: every phrase left out falls back to English, key by key.
const es = extendLocale(en, {
	id: "es",
	phrases: {
		declarations: { let: ({ name, value }) => `Sea ${name} igual a ${value}` },
		statements: { ifThen: ({ condition, action }) => `Si ${condition}, ${action}` },
	},
	plugins: {
		decimal: {
			times: ({ a, b }) => `${a} por ${b}`,
			plus: ({ a, b }) => `${a} más ${b}`,
		},
	},
});

const code = `
const total = new Decimal(price).times(quantity).plus(shipping);
if (total.isZero()) stop();
`;

console.log(narrate(code, { plugins: [decimal()], locale: es }));
console.log(phrasebookGaps(decimalEn, es.plugins?.decimal ?? {}));
