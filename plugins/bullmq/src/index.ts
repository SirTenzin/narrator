import { D, type Doc } from "@usenarrator/core";
import { type CallRule, definePlugin, type Engine, type MemberRule, type N, type StmtRule, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { en } from "./en";
import { flowCalls } from "./flow";
import type { BullmqPhrases } from "./phrases";
import { queueCalls, queueDetails, queueRef } from "./queue";
import { type Ctx, ctorKind, details, factsReader, framed, type Rule, type Site } from "./shared";
import { attemptsMade, workerCalls, workerParts } from "./worker";

export { en } from "./en";
export type { BullEvent, BullmqPhrases, CronDays, JobState, TimePhrases, TimeUnit } from "./phrases";

/** Rules that share a key (`*.add` is both `queue.add` and `flow.add`) are tried in order. */
function merge(tables: Record<string, Rule>[]): Record<string, Rule> {
	const out: Record<string, Rule> = {};
	for (const t of tables)
		for (const [k, r] of Object.entries(t)) {
			const prev = out[k];
			out[k] = prev ? (c, site) => prev(c, site) ?? r(c, site) : r;
		}
	return out;
}

/** The keys the engine would try for a call, most specific first. */
function keysOf(n: N): { key: string; obj: N | null }[] {
	const c = unwrap(n.callee);
	const pre = n.type === "NewExpression" ? "new " : "";
	if (c.type === "Identifier") return [{ key: pre + c.name, obj: null }];
	if (c.type !== "MemberExpression" || c.computed) return [];
	const obj = unwrap(c.object);
	const m = c.property.name;
	return [
		...(obj.type === "Identifier" ? [{ key: `${pre}${obj.name}.${m}`, obj }] : []),
		...(obj.type === "MemberExpression" && !obj.computed ? [{ key: `*.${obj.property.name}.${m}`, obj }] : []),
		{ key: `*.${m}`, obj: c.object },
	];
}

/** Calls whose result is worth naming after the action: the job or jobs just added. */
const ACTIONS = new Set(["add", "addBulk", "upsertJobScheduler"]);

/** BullMQ (docs.bullmq.io): queues, jobs and their options, job schedulers, workers, events, and flows. */
export const bullmq = (): TsPlugin<BullmqPhrases> => {
	const read = factsReader();
	const ctx = (e: Engine, say: BullmqPhrases): Ctx => ({ e, say, facts: read(e) });
	const rules = merge([queueCalls(), workerCalls(), flowCalls()]);
	const own = (c: Ctx, node: N, stmt: boolean): Doc | null => {
		for (const { key, obj } of keysOf(node)) {
			const r = rules[key]?.(c, { node, args: node.arguments, obj, stmt } satisfies Site);
			if (r) return r;
		}
		return null;
	};

	const calls: Record<string, CallRule<BullmqPhrases>> = {};
	for (const [k, r] of Object.entries(rules)) calls[k] = ({ e, say, node, args, obj, stmt }) => r(ctx(e, say), { node, args, obj, stmt });

	/** `const worker = new Worker(…)`, `const queue = new Queue(…)`: the thing set up, named. */
	const create: StmtRule<BullmqPhrases> = ({ node, e, d, say }) => {
		if (node.type === "ExpressionStatement" && unwrap(node.expression)?.type === "NewExpression") {
			const c = ctx(e, say);
			if (ctorKind(c, node.expression) !== "workers") return false;
			const w = workerParts(c, unwrap(node.expression));
			e.emitDoc(d, D(say.worker.create({ as: null, ...w }), w.lines), node);
			return true;
		}
		if (node.type !== "VariableDeclaration" || node.declarations.length !== 1) return false;
		const v = node.declarations[0];
		const init = unwrap(v.init);
		if (v.id.type !== "Identifier" || init?.type !== "NewExpression") return false;
		const c = ctx(e, say);
		const kind = ctorKind(c, init);
		if (!kind) return false;
		const as = e.ref(v.id.name);
		if (kind === "queues") {
			const items = queueDetails(c, init.arguments[1]);
			e.emitDoc(d, D(say.queue.create({ name: e.text(init.arguments[0]), as, details: details(c, items) })), node);
		} else if (kind === "workers") {
			const w = workerParts(c, init);
			e.emitDoc(d, D(say.worker.create({ as, ...w }), w.lines), node);
		} else if (kind === "events") {
			e.emitDoc(d, D(say.events.listen({ queue: queueRef(c, init.arguments[0]), as })), node);
		} else if (kind === "flows") e.emitDoc(d, D(say.flow.create({ as })), node);
		else return false;
		return true;
	};

	/** `const job = await queue.add(…)`: the action, then the name its result goes by. */
	const resultAs: StmtRule<BullmqPhrases> = ({ node, e, d, say }) => {
		if (node.type !== "VariableDeclaration" || node.declarations.length !== 1) return false;
		const v = node.declarations[0];
		const init = unwrap(v.init);
		if (v.id.type !== "Identifier" || init?.type !== "CallExpression") return false;
		const callee = unwrap(init.callee);
		if (callee.type !== "MemberExpression" || !ACTIONS.has(callee.property?.name)) return false;
		const act = own(ctx(e, say), init, true);
		if (!act) return false;
		e.emitDoc(d, D(e.say.declarations.callAs({ call: act.t.replace(/:$/, ""), name: e.ref(v.id.name) }), act.kids), node);
		return true;
	};

	const members: Record<string, MemberRule<BullmqPhrases>> = {
		"*.attemptsMade": ({ e, say, obj }) => attemptsMade(ctx(e, say), obj),
	};

	return definePlugin<BullmqPhrases>({
		name: "bullmq",
		library: { name: "bullmq", versions: ">=5 <7" },
		phrases: { en },
		errors: ["UnrecoverableError", "DelayedError", "WaitingChildrenError", "WaitingError", "RateLimitError"],
		calls,
		members,
		statements: [framed(create), framed(resultAs)],
	});
};
