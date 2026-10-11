import { D } from "@usenarrator/core";
import type { Engine, N } from "../engine";
import { type CallRule, definePlugin } from "../plugin";
import { arrayRules } from "./arrayRules";
import { conditionRules } from "./conditionRules";
import { en } from "./en";
import { nodeConditions, nodeRules } from "./nodeRules";
import type { StdPhrases } from "./phrases";
import { withPipelines } from "./pipeline";
import { valueRules } from "./valueRules";

export type { StdPhrases } from "./phrases";
export { en as stdEn };

/** Merges rule tables; where both claim a key, the first table's rule gets the first try. */
const firstOf = (a: Record<string, CallRule<StdPhrases>>, b: Record<string, CallRule<StdPhrases>>) => {
	const out = { ...b, ...a };
	for (const k of Object.keys(a)) {
		const later = b[k];
		const first = a[k]!;
		if (later) out[k] = (ctx) => first(ctx) ?? later(ctx);
	}
	return out;
};

const styleOnly = ({ args, e }: { args: N[]; e: Engine }) => (args.length === 1 ? e.noun(args[0]) : null);

/** JS built-ins: arrays, strings, numbers, Math, JSON, Promise, Map/Set, console, timers. */
export const std = definePlugin<StdPhrases>({
	name: "std",
	phrases: { en },
	ambient: ["ctx"],
	vocabulary: {
		acronyms: [
			"mcp",
			"xml",
			"rpc",
			"llm",
			"ai",
			"ssl",
			"tls",
			"dns",
			"smtp",
			"ssh",
			"cdn",
			"aws",
			"gcp",
			"sku",
			"usd",
			"eur",
			"gbp",
			"utm",
			"crm",
			"kv",
			"ssr",
			"dom",
			"cpu",
			"gpu",
			"jsx",
			"tsx",
			"pii",
			"sso",
			"saml",
			"oidc",
			"hmac",
			"rsa",
			"sha",
			"md5",
			"cors",
			"csrf",
			"xss",
			"ascii",
			"utf8",
			"uri",
		],
	},
	errors: /Error$/,
	calls: {
		...firstOf(nodeRules, { ...withPipelines(arrayRules), ...valueRules }),
		"chalk.*": styleOnly,
		chalk: styleOnly,
		cn: ({ args, say }) => (args.length ? D(say.someCssClasses) : null),
		clsx: ({ say }) => D(say.someCssClasses),
	},
	conditions: { ...conditionRules, ...nodeConditions, ...Object.fromEntries(Object.entries(nodeConditions).map(([k, r]) => [`*.${k}`, r])) },
});
