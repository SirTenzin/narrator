import { D } from "@usenarrator/core";
import type { Engine, N } from "../engine";
import { definePlugin } from "../plugin";
import { arrayRules } from "./arrayRules";
import { conditionRules } from "./conditionRules";
import { en } from "./en";
import type { StdPhrases } from "./phrases";
import { withPipelines } from "./pipeline";
import { valueRules } from "./valueRules";

export type { StdPhrases } from "./phrases";
export { en, en as stdEn };

const styleOnly = ({ args, e }: { args: N[]; e: Engine }) => (args.length === 1 ? e.noun(args[0]) : null);

/** JS built-ins: arrays, strings, numbers, Math, JSON, Promise, Map/Set, console, timers. */
export const std = definePlugin<StdPhrases>({
	name: "std",
	phrases: { en },
	ambient: ["ctx"],
	errors: /Error$/,
	calls: {
		...withPipelines(arrayRules),
		...valueRules,
		"chalk.*": styleOnly,
		chalk: styleOnly,
		cn: ({ args, say }) => (args.length ? D(say.someCssClasses) : null),
		clsx: ({ say }) => D(say.someCssClasses),
	},
	conditions: conditionRules,
});

declare module "@usenarrator/core" {
	interface PluginPhrases {
		std: StdPhrases;
	}
}
