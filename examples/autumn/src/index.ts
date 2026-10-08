import { D } from "@narrate/core";
import { decimal } from "@narrate/plugin-decimal";
import { drizzle } from "@narrate/plugin-drizzle";
import { definePlugin, type TsPlugin, unwrap } from "@narrate/lang-ts";

/** Autumn's codebase conventions: vocabulary, plumbing names, error classes and in-house helpers. */
export const autumn = (): TsPlugin[] => [
	drizzle(),
	decimal(),
	definePlugin({
		name: "autumn",
	vocabulary: {
		glossary: {
			cus: "customer",
			cp: "customer product",
			cps: "customer products",
			atmn: "Autumn",
			prod: "product",
			prods: "products",
			stripe: "Stripe",
			autumn: "Autumn",
			redis: "Redis",
			sub: "subscription",
			subs: "subscriptions",
			sched: "schedule",
			inv: "invoice",
			ent: "entitlement",
			ents: "entitlements",
			cus_ent: "customer entitlement",
			svix: "Svix",
			posthog: "PostHog",
			clickhouse: "ClickHouse",
			tinybird: "Tinybird",
			upstash: "Upstash",
			trigger: "Trigger",
			drizzle: "Drizzle",
			rp: "replay",
			intvl: "interval",
			ttl: "TTL",
		},
		verbs: ["arbitrate", "route", "charge", "bump", "split", "carry", "settle", "allocate", "rebalance", "reserve", "claim", "release", "attach", "detach", "upgrade", "downgrade", "renew", "expire", "consume", "deduct", "provision", "backfill", "hydrate"],
	},
	ambient: ["db", "logger", "tx"],
	errors: /Error$/,
	errorLabels: { RecaseError: "an error", AutumnError: "an error" },
	calls: {
		"ms.*": ({ node, args, e }) => (args.length === 1 ? D(`${e.text(args[0])} ${unwrap(node.callee).property.name}, in milliseconds`) : null),
		deduplicateArray: ({ args, e }) => {
			const a = e.noun(args[0]);
			return D(`${a.t} without duplicates`, a.kids);
		},
		notNullish: ({ args, e }) => {
			const c = e.cond(args[0]);
			return D(`whether ${c.t}`, c.kids);
		},
		nullish: ({ args, e }) => {
			const c = e.cond(args[0], true);
			return D(`whether ${c.t}`, c.kids);
		},
	},
	conditions: {
		notNullish: ({ args, e, neg }) => e.cond(args[0], neg),
		nullish: ({ args, e, neg }) => e.cond(args[0], !neg),
	},
	}),
];
