/** Everything the Autumn preset says. Arguments are already-rendered markup strings. */
export type AutumnPhrases = {
	/** How abbreviations in identifiers read: `cus` -> "customer". */
	glossary: Record<
		| "cus"
		| "cust"
		| "cli"
		| "cp"
		| "cps"
		| "atmn"
		| "prod"
		| "prods"
		| "stripe"
		| "autumn"
		| "redis"
		| "sub"
		| "subs"
		| "sched"
		| "inv"
		| "ent"
		| "ents"
		| "cus_ent"
		| "svix"
		| "posthog"
		| "clickhouse"
		| "tinybird"
		| "upstash"
		| "trigger"
		| "drizzle"
		| "rp"
		| "intvl"
		| "ttl",
		string
	>;
	/** How a thrown error class is named. */
	errorLabels: Record<"RecaseError" | "AutumnError", string>;
	/** `ms.minutes(5)`; `unit` is the helper's name as written (e.g. "minutes"). */
	inMilliseconds: (p: { amount: string; unit: string }) => string;
	withoutDuplicates: (p: { value: string }) => string;
	whether: (p: { cond: string }) => string;
};
