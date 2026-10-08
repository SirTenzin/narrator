import { mk } from "../markup";
import { D, type Dialect, type Doc, type Engine, type N, listJoin, unwrap } from "../engine";

const bin = (word: string) => ({ obj, args, e }: { obj: N; args: N[]; e: Engine }) => {
	const a = e.noun(obj);
	const b = e.noun(args[0]);
	return D(`${a.t} ${word} ${b.t}`, [...a.kids, ...b.kids]);
};

const sqlCompare = (word: string, negWord: string) => ({ args, e, neg }: { args: N[]; e: Engine; neg?: boolean }) => {
	const a = e.noun(args[0]);
	const b = e.noun(args[1]);
	return D(`${a.t} ${neg ? negWord : word} ${b.t}`, [...a.kids, ...b.kids]);
};

const sqlLogic = (isAnd: boolean) => ({ args, e, neg }: { args: N[]; e: Engine; neg?: boolean }) => {
	const items: Doc[] = args.filter(Boolean).map((a: N) => e.cond(a, !!neg));
	const and = isAnd !== !!neg;
	if (items.length === 1) return items[0]!;
	return D(and ? "all of these are true:" : "any of these is true:", items.flatMap((i) => e.bullet(i)));
};

/** Treats a drizzle helper call (`eq(col, x)`) as a condition wherever it appears. */
const asCond = (rule: (x: any) => Doc) => ({
	call: ({ args, e }: { args: N[]; e: Engine }) => rule({ args, e, neg: false }),
	cond: ({ args, e, neg }: { args: N[]; e: Engine; neg: boolean }) => rule({ args, e, neg }),
});

const drizzle = {
	eq: asCond(sqlCompare("is", "is not")),
	ne: asCond(sqlCompare("is not", "is")),
	gt: asCond(sqlCompare("is more than", "is at most")),
	gte: asCond(sqlCompare("is at least", "is less than")),
	lt: asCond(sqlCompare("is less than", "is at least")),
	lte: asCond(sqlCompare("is at most", "is more than")),
	inArray: asCond(sqlCompare("is in", "is not in")),
	notInArray: asCond(sqlCompare("is not in", "is in")),
	and: asCond(sqlLogic(true)),
	or: asCond(sqlLogic(false)),
	isNull: asCond(({ args, e, neg }) => D(`${e.text(args[0])} ${neg ? "is set" : "is empty"}`)),
	isNotNull: asCond(({ args, e, neg }) => D(`${e.text(args[0])} ${neg ? "is empty" : "is set"}`)),
};

/** `db.select().from(t).where(c).limit(1)` -> a bulleted query description. */
function drizzleQuery({ node, e }: { node: N; e: Engine }): Doc | null {
	const steps: { m: string; args: N[] }[] = [];
	let cur = unwrap(node);
	while (cur?.type === "CallExpression" && unwrap(cur.callee).type === "MemberExpression") {
		const c = unwrap(cur.callee);
		steps.unshift({ m: c.property.name, args: cur.arguments });
		cur = unwrap(c.object);
	}
	const head = steps[0]?.m;
	if (!head || !["select", "selectDistinct", "insert", "update", "delete"].includes(head)) return null;
	if (!e.isAmbient(cur) && !/db|tx/i.test(e.code(cur))) return null;
	const kids: Doc[] = [];
	let title = "";
	for (const s of steps) {
		const a = s.args.map((x) => e.noun(x));
		switch (s.m) {
			case "select":
			case "selectDistinct":
				title = s.args.length ? `look up ${a[0]!.t.replace(/^an object with:?/, "fields")} in the DB` : "look up rows in the DB";
				break;
			case "from":
				title = `look up ${head === "select" && !steps[0]!.args.length ? "rows" : "fields"} from ${a[0]!.t}`;
				if (steps[0]!.args.length) kids.push(D(`picking ${a.length ? e.text(steps[0]!.args[0]) : "everything"}`, e.noun(steps[0]!.args[0]).kids));
				break;
			case "insert":
				title = `insert into ${a[0]!.t}`;
				break;
			case "update":
				title = `update ${a[0]!.t}`;
				break;
			case "delete":
				title = `delete from ${a[0]!.t}`;
				break;
			case "values":
				kids.push(D(`the values: ${a[0]!.t}`, a[0]!.kids));
				break;
			case "set":
				kids.push(D(`setting ${a[0]!.t}`, a[0]!.kids));
				break;
			case "where": {
				const c = e.cond(s.args[0]);
				kids.push(D(`where ${c.t}`, c.kids));
				break;
			}
			case "innerJoin":
			case "leftJoin":
			case "rightJoin": {
				const c = e.cond(s.args[1]);
				kids.push(D(`joined with ${a[0]!.t} on ${c.t}`, c.kids));
				break;
			}
			case "orderBy":
				kids.push(D(`sorted by ${listJoin(a.map((x) => x.t))}`));
				break;
			case "limit":
				kids.push(D(`at most ${a[0]!.t} row(s)`));
				break;
			case "offset":
				kids.push(D(`skipping the first ${a[0]!.t}`));
				break;
			case "returning":
				kids.push(D("giving back the affected rows"));
				break;
			case "onConflictDoNothing":
				kids.push(D("ignoring rows that already exist"));
				break;
			case "onConflictDoUpdate":
				kids.push(D("updating rows that already exist"));
				break;
			case "groupBy":
				kids.push(D(`grouped by ${listJoin(a.map((x) => x.t))}`));
				break;
			case "for":
				kids.push(D(`locking rows (${a[0]!.t})`));
				break;
			default:
				kids.push(D(`then ${s.m}${a.length ? ` (${listJoin(a.map((x) => x.t))})` : ""}`));
		}
	}
	return D(`${title}:`, kids.flatMap((k) => e.bullet(k)));
}

const decCmp = (word: string, negWord: string) => ({ obj, args, e, neg }: { obj: N; args: N[]; e: Engine; neg: boolean }) => {
	if (args.length !== 1 || !obj) return null;
	const a = e.noun(obj);
	const b = e.noun(args[0]);
	return D(`${a.t} ${neg ? negWord : word} ${b.t}`, [...a.kids, ...b.kids]);
};

const decimalUnwrap = ({ obj, e }: { obj: N; e: Engine }) => e.noun(obj);

export const autumn: Dialect = {
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
		...Object.fromEntries(Object.entries(drizzle).map(([k, v]) => [k, v.call])),
		"*.select": drizzleQuery,
		"*.from": drizzleQuery,
		"*.where": drizzleQuery,
		"*.limit": drizzleQuery,
		"*.orderBy": drizzleQuery,
		"*.returning": drizzleQuery,
		"*.values": (x) => drizzleQuery(x) ?? (unwrap(x.obj).name === "Object" ? D(`the values in ${x.e.text(x.args[0])}`) : null),
		"*.onConflictDoNothing": drizzleQuery,
		"*.onConflictDoUpdate": drizzleQuery,
		"*.innerJoin": drizzleQuery,
		"*.leftJoin": drizzleQuery,
		"*.groupBy": drizzleQuery,
		"*.for": drizzleQuery,
		"new Decimal": ({ args, e }) => e.noun(args[0]),
		"*.plus": bin("plus"),
		"*.add": (x) => (unwrap(x.obj).type === "NewExpression" && unwrap(x.obj).callee?.name === "Decimal" ? bin("plus")(x) : null),
		"*.minus": bin("minus"),
		"*.sub": bin("minus"),
		"*.times": bin("times"),
		"*.mul": bin("times"),
		"*.div": bin("divided by"),
		"*.dividedBy": bin("divided by"),
		"*.toNumber": decimalUnwrap,
		"*.toDecimalPlaces": ({ obj, args, e }) => D(`${e.text(obj)} rounded to ${e.text(args[0])} decimal places`),
	},
	conditions: {
		"*.lte": decCmp("is at most", "is more than"),
		"*.lt": decCmp("is less than", "is at least"),
		"*.gte": decCmp("is at least", "is less than"),
		"*.gt": decCmp("is more than", "is at most"),
		"*.eq": decCmp("is", "is not"),
		"*.equals": decCmp("is", "is not"),
		"*.isZero": ({ obj, e, neg }) => D(`${e.text(obj)} is ${neg ? "not " : ""}zero`),
		"*.isNegative": ({ obj, e, neg }) => D(`${e.text(obj)} is ${neg ? "not " : ""}negative`),
		"*.isPositive": ({ obj, e, neg }) => D(`${e.text(obj)} is ${neg ? "not " : ""}positive`),
		notNullish: ({ args, e, neg }) => e.cond(args[0], neg),
		nullish: ({ args, e, neg }) => e.cond(args[0], !neg),
		...Object.fromEntries(Object.entries(drizzle).map(([k, v]) => [k, v.cond])),
	},
};

void mk;
