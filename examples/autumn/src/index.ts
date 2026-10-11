import { D } from "@usenarrator/core";
import { definePlugin, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { decimal } from "@usenarrator/plugin-decimal";
import { drizzle } from "@usenarrator/plugin-drizzle";
import { en } from "./en";
import type { AutumnPhrases } from "./phrases";

export type { AutumnPhrases } from "./phrases";
export { en, en as autumnEn };

/** Autumn's codebase conventions: vocabulary, plumbing names, error classes and in-house helpers. */
export const autumn = (): TsPlugin[] => [
	drizzle(),
	decimal(),
	definePlugin({
		name: "autumn",
		phrases: { en },
		vocabulary: {
			acronyms: ["mrr"],
			verbs: [
				"arbitrate",
				"route",
				"charge",
				"bump",
				"split",
				"carry",
				"settle",
				"allocate",
				"rebalance",
				"reserve",
				"claim",
				"release",
				"attach",
				"detach",
				"upgrade",
				"downgrade",
				"renew",
				"expire",
				"consume",
				"deduct",
				"provision",
				"backfill",
				"hydrate",
			],
		},
		ambient: ["db", "logger", "tx"],
		errors: /Error$/,
		calls: {
			"ms.*": ({ node, args, e, say }) =>
				args.length === 1 ? D(say.inMilliseconds({ amount: e.text(args[0]), unit: unwrap(node.callee).property.name })) : null,
			deduplicateArray: ({ args, e, say }) => {
				const a = e.noun(args[0]);
				return D(say.withoutDuplicates({ value: a.t }), a.kids);
			},
			notNullish: ({ args, e, say }) => {
				const c = e.cond(args[0]);
				return D(say.whether({ cond: c.t }), c.kids);
			},
			nullish: ({ args, e, say }) => {
				const c = e.cond(args[0], true);
				return D(say.whether({ cond: c.t }), c.kids);
			},
		},
		conditions: {
			notNullish: ({ args, e, neg }) => e.cond(args[0], neg),
			nullish: ({ args, e, neg }) => e.cond(args[0], !neg),
		},
	}),
];

declare module "@usenarrator/core" {
	interface PluginPhrases {
		autumn: AutumnPhrases;
	}
}
