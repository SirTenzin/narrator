import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { dataText, jobOptionItems, jobRef, queueRef } from "./queue";
import { type Ctx, details, isFlow, objectArg, propOf, type Rule } from "./shared";

/** One flow node `{ name, queueName, data, opts, children }`, its children nested beneath. */
function nodeDoc(c: Ctx, n: N): Doc | null {
	const o = objectArg(n);
	const name = o && propOf(o, "name");
	const queue = o && propOf(o, "queueName");
	if (!name || !queue) return null;
	const { e, say } = c;
	const d = dataText(c, propOf(o, "data"));
	const items = [...(d.t ? [d.t] : []), ...jobOptionItems(c, propOf(o, "opts"))];
	const list = unwrap(propOf(o, "children"));
	const kids = list?.type === "ArrayExpression" ? list.elements.filter(Boolean).flatMap((x: N) => e.bullet(nodeDoc(c, x) ?? e.noun(x))) : [];
	const children = list ? (list.type === "ArrayExpression" ? kids.length > 0 : true) : false;
	const childRef = list && list.type !== "ArrayExpression" ? e.noun(list) : null;
	const title = say.flow.node({ job: jobRef(c, name), queue: queueRef(c, queue), details: details(c, items), children });
	return D(title, [...d.kids, ...(childRef ? e.bullet(childRef) : kids)]);
}

const add: Rule = (c, { obj, args }) => {
	if (!isFlow(c, obj)) return null;
	const root = nodeDoc(c, args[0]);
	if (!root) return null;
	return D(c.say.flow.add({ flow: root.t, children: root.kids.length > 0 }), root.kids);
};

const addBulk: Rule = (c, { obj, args }) => {
	const list = unwrap(args[0]);
	if (!isFlow(c, obj) || list?.type !== "ArrayExpression") return null;
	return D(
		c.say.flow.addBulk,
		list.elements.filter(Boolean).flatMap((x: N) => c.e.bullet(nodeDoc(c, x) ?? c.e.noun(x))),
	);
};

export const flowCalls = (): Record<string, Rule> => ({ "*.add": add, "*.addBulk": addBulk });
