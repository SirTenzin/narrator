export const ACRONYMS = new Set([
	"id", "ids", "api", "url", "urls", "http", "https", "json", "sql", "html", "css", "jwt", "uuid",
	"ui", "ip", "sdk", "csv", "pdf", "cli", "db", "s3", "otp", "oauth", "ttl", "utc", "iso", "mrr", "arr",
]);

const ACRONYM_DISPLAY: Record<string, string> = { ids: "IDs", urls: "URLs", oauth: "OAuth", db: "DB" };

export const GLOSSARY: Record<string, string> = {
	cus: "customer",
	cust: "customer",
	ent: "entitlement",
	ents: "entitlements",
	ctx: "context",
	prev: "previous",
	curr: "current",
	cur: "current",
	msg: "message",
	err: "error",
	req: "request",
	res: "response",
	opts: "options",
	idx: "index",
	num: "number",
	fn: "function",
	cb: "callback",
	tmp: "temporary",
	str: "string",
	obj: "object",
	arr: "array",
	len: "length",
	qty: "quantity",
	amt: "amount",
	cfg: "config",
	cli: "client",
	attrs: "attributes",
	desc: "description",
	sub: "subscription",
	subs: "subscriptions",
	val: "value",
	del: "delete",
	vals: "values",
	acc: "total so far",
	evt: "event",
	pkg: "package",
	org: "org",
	env: "env",
};

export function splitWords(id: string): string[] {
	return id
		.replace(/^[_$#]+/, "")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.replace(/([a-zA-Z])(\d)/g, "$1$2")
		.split(/[\s_\-$]+/)
		.filter(Boolean)
		.map((w) => w.toLowerCase());
}

const displayWord = (w: string) => {
	if (GLOSSARY[w]) return GLOSSARY[w];
	if (ACRONYMS.has(w)) return ACRONYM_DISPLAY[w] ?? w.toUpperCase();
	return w;
};

export const humanizeWords = (words: string[]) => words.map(displayWord).join(" ");
export const humanize = (id: string) => (id.length === 1 ? id : humanizeWords(splitWords(id)));

export const PREDICATE_PREFIXES = new Set([
	"is", "has", "have", "can", "should", "was", "were", "did", "does", "do", "will", "needs", "need",
	"are", "allows", "allow", "must", "had", "wants", "supports", "requires", "contains", "matches",
	"exists", "uses", "includes", "skip", "skips",
]);

export const isPredicateName = (id: string) => {
	const w = splitWords(id);
	if (w.length < 2) return false;
	if (PREDICATE_PREFIXES.has(w[0]!)) return true;
	const first = w[0]!;
	return /[^s]s$/.test(first) && !VERBS.has(first) && (VERBS.has(first.slice(0, -1)) || VERBS.has(first.replace(/es$/, "")));
};

const NEGATED_PREFIX: Record<string, string> = {
	is: "is not", are: "are not", was: "was not", were: "were not", has: "has no", have: "have no",
	had: "had no", can: "cannot", should: "should not", did: "did not", does: "does not", do: "do not",
	will: "will not", needs: "does not need", need: "does not need", must: "must not", allows: "does not allow",
	allow: "does not allow", wants: "does not want", supports: "does not support", requires: "does not require",
	contains: "does not contain", matches: "does not match", exists: "does not exist", uses: "does not use",
	includes: "does not include", skip: "do not skip", skips: "does not skip",
};

/** `isUpgrade` -> "is upgrade" / "is not upgrade". */
export function predicatePhrase(id: string, negated: boolean): string {
	const w = splitWords(id);
	const head = negated ? (NEGATED_PREFIX[w[0]!] ?? `does not ${w[0]!.replace(/(ch|sh|x|ss)es$/, "$1").replace(/s$/, "")}`) : w[0]!;
	return `${head} ${humanizeWords(w.slice(1))}`.trim();
}

/** `isOneOffPrice` with subject "price" -> "price is a one off price". */
export function predicateWithSubject(id: string, subject: string, negated: boolean) {
	return `${subject} ${predicatePhrase(id, negated)}`;
}

export const VERBS = new Set(
	`get set find load create update delete build run handle fetch insert remove add filter map parse
validate check compute sync attach cancel invalidate throw ensure apply make resolve process send emit
log init clear reset use format convert generate calculate calc merge sort group split write read save
store publish subscribe track record notify list search query select upsert migrate transform normalize
render prepare setup initialize register unregister start stop wait retry schedule enqueue dequeue
execute call invoke trigger dispatch push pop assert verify extract collect count sum deduplicate dedupe
strip trim replace serialize deserialize encode decode hash sign mark copy clone fill expire refresh
determine derive assemble upload download open close connect disconnect commit rollback preview
reconcile charge refund bill pay invoice construct init insert patch post put import export wrap
unwrap enable disable toggle lock unlock acquire release cache evict sanitize pick omit lookup match
increment decrement deduct apply accumulate aggregate append archive assign await batch begin bind block
broadcast bump capture chunk claim cleanup clamp coerce collapse combine compare compile compose compress
configure confirm consume continue create crawl debounce decide declare decorate defer delay describe
destroy detect diff disable discard dispatch drain drop dump edit emit encrypt end enrich enter estimate
evaluate expand expect explain expose extend fail fan finalize finish fire flag flatten flush fold force
forward freeze gather give grant guard hide hold hydrate identify ignore include index infer inject inspect
install instantiate intercept issue iterate join keep kill launch limit link listen load lower map
materialize measure mint mock modify monitor mount move mutate name navigate nest note observe obtain
offset order override own pack page paginate pass pause persist place plan poll populate post predict
prefetch preload present preserve print prioritize probe produce project promote prompt propagate protect
provide prune purge queue quote raise rank rate reach rebuild recalculate receive recompute recover redact
redirect reduce reject relay reload remember rename reorder repair repeat replay report request require
reschedule resend reserve resize respond restore resume retain retrieve return reuse revert review revoke
rewrite roll rotate round route sample scan scale scope score scrub seed seek segment sell separate serve
shift show shuffle shutdown signal simulate skip slice snapshot solve spawn specify spend spread stage stamp
stash step stream submit subtract suggest summarize supply suppress suspend swap switch tag take tally
teardown terminate test throttle tick touch trace translate traverse truncate try tune unfurl unpack
unset unsubscribe unwind update upgrade validate verify view visit void walk warm watch withdraw yield
write overlap cover exceed fit belong conflict differ qualify fork unref ref ping del exec spy`.split(/\s+/),
);

export const startsWithVerb = (id: string) => VERBS.has(splitWords(id)[0] ?? "");

/** `billingContextToQuantityProrationConfig` -> ["billing context", "quantity proration config"]. */
export function converterParts(id: string): [string[], string[]] | null {
	const w = splitWords(id);
	const i = w.indexOf("to");
	if (i <= 0 || i === w.length - 1) return null;
	if (VERBS.has(w[0]!)) return null;
	return [w.slice(0, i), w.slice(i + 1)];
}

export const possessive = (s: string) => {
	const bare = s.replace(/\uE002$/, "");
	return /s$/.test(bare) && !/(ss|us|is)$/.test(bare) ? `${s}'` : `${s}'s`;
};

export function singular(s: string): string {
	if (/ies$/.test(s)) return s.replace(/ies$/, "y");
	if (/(ss|us|is)$/.test(s)) return s;
	if (/(ches|shes|xes|sses)$/.test(s)) return s.replace(/es$/, "");
	if (/s$/.test(s)) return s.slice(0, -1);
	return s;
}

export const isPluralWord = (s: string) => /[^s]s$/.test(s) || /ies$/.test(s);

export const article = (s: string) => (/^[aeiou]/i.test(s) && !/^(one|uni|use)/i.test(s) ? "an" : "a");

const TIME_WORDS = /(^|\s)(at|date|time|timestamp|until|since|deadline|expiry|expires|ends|starts|now|period end|period start|anchor)$/i;
export const looksLikeTime = (s: string) => TIME_WORDS.test(s) || /\b(now|date)\b/i.test(s);

export type Vocabulary = {
	glossary?: Record<string, string>;
	acronyms?: string[];
	verbs?: string[];
	predicatePrefixes?: string[];
};

export function extendVocabulary(v: Vocabulary) {
	Object.assign(GLOSSARY, v.glossary ?? {});
	for (const a of v.acronyms ?? []) ACRONYMS.add(a);
	for (const a of v.verbs ?? []) VERBS.add(a);
	for (const a of v.predicatePrefixes ?? []) PREDICATE_PREFIXES.add(a);
}
