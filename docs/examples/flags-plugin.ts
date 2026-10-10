import { D } from "@usenarrator/core";
import { definePlugin, unwrap } from "@usenarrator/lang-ts";
import { narrate } from "@usenarrator/testkit";

type FlagPhrases = {
	enabled: (p: { flag: string; neg: boolean }) => string;
	withRetries: (p: { action: string; times: string }) => string;
};

const flags = definePlugin<FlagPhrases>({
	name: "flags",
	phrases: {
		en: {
			enabled: ({ flag, neg }) => `the ${flag} feature is ${neg ? "off" : "on"}`,
			withRetries: ({ action, times }) => `${action}, retrying up to ${times} times`,
		},
	},
	vocabulary: { glossary: { cfg: "settings" } },
	conditions: {
		"Flags.isEnabled": ({ args, neg, say }) => {
			const flag = unwrap(args[0]);
			if (flag?.type !== "Literal") return null;
			return say.enabled({ flag: String(flag.value), neg });
		},
	},
	calls: {
		withRetry: ({ args, e, say }) => {
			if (args.length !== 2) return null;
			return D(say.withRetries({ action: e.text(args[0]), times: e.text(args[1]) }));
		},
	},
});

const code = `
if (!Flags.isEnabled("new-checkout")) return legacyCheckout(cfg);
await withRetry(chargeCard(order), 3);
`;

console.log("Without the plugin:");
console.log(narrate(code));
console.log("\nWith the plugin:");
console.log(narrate(code, { plugins: [flags] }));
