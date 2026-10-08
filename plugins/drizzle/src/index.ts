import { D, type Doc } from "@narrate/core";
import { definePlugin, type Engine, listJoin, type N, type TsPlugin, unwrap } from "@narrate/lang-ts";

const sqlCompare =
	(word: string, negWord: string) =>
	({ args, e, neg }: { args: N[]; e: Engine; neg?: boolean }) => {
		const a = e.noun(args[0]);
		const b = e.noun(args[1]);
		return D(`${a.t} ${neg ? negWord : word} ${b.t}`, [...a.kids, ...b.kids]);
	};

const sqlLogic =
	(isAnd: boolean) =>
	({ args, e, neg }: { args: N[]; e: Engine; neg?: boolean }) => {
		const items: Doc[] = args.filter(Boolean).map((a: N) => e.cond(a, !!neg));
		const and = isAnd !== !!neg;
		if (items.length === 1) return items[0]!;
		return D(
			and ? "all of these are true:" : "any of these is true:",
			items.flatMap((i) => e.bullet(i)),
		);
	};

/** Treats a drizzle helper call (`eq(col, x)`) as a condition wherever it appears. */
const asCond = (rule: (x: any) => Doc) => ({
	call: ({ args, e }: { args: N[]; e: Engine }) => rule({ args, e, neg: false }),
	cond: ({ args, e, neg }: { args: N[]; e: Engine; neg: boolean }) => rule({ args, e, neg }),
});

const sqlOperators = {
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
	return D(
		`${title}:`,
		kids.flatMap((k) => e.bullet(k)),
	);
}

const queryMethods = [
	"select",
	"from",
	"where",
	"limit",
	"orderBy",
	"returning",
	"values",
	"onConflictDoNothing",
	"onConflictDoUpdate",
	"innerJoin",
	"leftJoin",
	"groupBy",
	"for",
];

/** Drizzle ORM: query builders (`db.select()...`) and SQL operators (`eq`, `and`, `inArray`, ...). */
export const drizzle = (): TsPlugin =>
	definePlugin({
		name: "drizzle",
		calls: {
			...Object.fromEntries(Object.entries(sqlOperators).map(([k, v]) => [k, v.call])),
			...Object.fromEntries(queryMethods.map((m) => [`*.${m}`, drizzleQuery])),
		},
		conditions: Object.fromEntries(Object.entries(sqlOperators).map(([k, v]) => [k, v.cond])),
	});
