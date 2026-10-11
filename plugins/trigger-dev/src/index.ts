import { D, type Doc } from "@usenarrator/core";
import { type CallRule, definePlugin, type Engine, type N, type StmtRule, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { en } from "./en";
import type { TriggerPhrases as __PluginPhrases, TriggerPhrases } from "./phrases";
import { type Ctx, factsReader, framed, importedAs, type Rule, usesTrigger } from "./shared";
import { queueParts, taskCalls, taskParts } from "./tasks";
import { triggerTables } from "./triggers";

export { en } from "./en";
export type { CronDays, Hook, KeyScope, TimePhrases, TimeUnit, TriggerPhrases } from "./phrases";

/** Rules that share a key (`*.list` is both `runs.list` and `schedules.list`) are tried in order. */
function merge(tables: Record<string, Rule>[]): Record<string, Rule> {
	const out: Record<string, Rule> = {};
	for (const t of tables)
		for (const [k, r] of Object.entries(t)) {
			const prev = out[k];
			out[k] = prev ? (c, site) => prev(c, site) ?? r(c, site) : r;
		}
	return out;
}

/** Calls whose result is worth naming after the action: the run handle, output, or token just produced. */
const ACTIONS = new Set([
	"trigger",
	"triggerAndWait",
	"triggerAndPoll",
	"batchTrigger",
	"batchTriggerAndWait",
	"triggerByTask",
	"triggerByTaskAndWait",
	"unwrap",
	"forToken",
	"onThrow",
]);

/** Trigger.dev (trigger.dev, SDK v3 and v4): tasks and scheduled tasks, queues, triggering, waits, run metadata, idempotency keys, runs and schedules. */
export const triggerDev = (): TsPlugin<TriggerPhrases> => {
	const read = factsReader();
	const ctx = (e: Engine, say: TriggerPhrases): Ctx => ({ e, say, facts: read(e) });
	const rules = merge([taskCalls(), ...triggerTables()]);
	const calls: Record<string, CallRule<TriggerPhrases>> = {};
	for (const [k, r] of Object.entries(rules))
		calls[k] = ({ e, say, node, args, obj, stmt }) => (usesTrigger(e) ? r(ctx(e, say), { node, args, obj, stmt }) : null);

	const single = (node: N): { id: N; init: N } | null => {
		if (node.type !== "VariableDeclaration" || node.declarations.length !== 1) return null;
		const v = node.declarations[0];
		return v.id.type === "Identifier" && v.init ? { id: v.id, init: unwrap(v.init) } : null;
	};

	/** `export const sendEmail = task({ … })` and `const emails = queue({ … })`. */
	const define: StmtRule<TriggerPhrases> = ({ node, e, d, say }) => {
		const s = single(node);
		if (!s || !usesTrigger(e)) return false;
		const c = ctx(e, say);
		const as = e.ref(s.id.name);
		const t = taskParts(c, s.init);
		if (t) {
			e.emitDoc(d, D(t.scheduled ? say.task.defineScheduled({ ...t, as }) : say.task.define({ ...t, as }), t.lines), node);
			return true;
		}
		const q = queueParts(c, s.init);
		if (!q) return false;
		e.emitDoc(d, D(say.queue.define({ ...q, as })), node);
		return true;
	};

	/** `const handle = await myTask.trigger(…)` / `return myTask.triggerAndWait(…).unwrap()`. */
	const result: StmtRule<TriggerPhrases> = ({ node, e, d, say }) => {
		const s = single(node);
		const call = s?.init ?? (node.type === "ReturnStatement" ? unwrap(node.argument) : null);
		const callee = call?.type === "CallExpression" ? unwrap(call.callee) : null;
		if (callee?.type !== "MemberExpression" || !usesTrigger(e)) return false;
		const m = callee.property?.name;
		const c = ctx(e, say);
		if (!ACTIONS.has(m) && !(m === "create" && importedAs(c, callee.object) === "schedules")) return false;
		const rule = rules[`*.${m}`];
		const doc: Doc | null | undefined = rule?.(c, { node: call, args: call.arguments, obj: callee.object, stmt: true });
		if (!doc) return false;
		const text = doc.t.replace(/:$/, "");
		const phrase = s ? e.say.declarations.callAs({ call: text, name: e.ref(s.id.name) }) : e.say.statements.returnCall({ call: text });
		e.emitDoc(d, D(phrase, doc.kids), node);
		return true;
	};

	return definePlugin<TriggerPhrases>({
		name: "trigger-dev",
		library: { name: "@trigger.dev/sdk", versions: ">=3 <5" },
		phrases: { en },
		errors: ["AbortTaskRunError"],
		calls,
		statements: [framed(define), framed(result)],
	});
};

declare module "@usenarrator/core" {
	interface PluginPhrases {
		"trigger-dev": __PluginPhrases;
	}
}
