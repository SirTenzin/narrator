import { D, type Doc } from "@usenarrator/core";
import { type CallRule, type CondRule, definePlugin, type Engine, type N, type StmtRule, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { clientCalls, clientDetails, workerCalls, workerParts } from "./client";
import { en } from "./en";
import type { TemporalPhrases } from "./phrases";
import { type Ctx, details, exportedName, factsReader, isWorker, type Rule, usesTemporal } from "./shared";
import { activityItems, argsText, messageTypes, workflowCalls, workflowConditions } from "./workflow";

export { en } from "./en";
export type { CronDays, MessageKind, TemporalPhrases, TimePhrases, TimeUnit } from "./phrases";

/** Rules that share a key (`*.sleep` is both workflow and activity `sleep`) are tried in order. */
function merge(tables: Record<string, Rule>[]): Record<string, Rule> {
	const out: Record<string, Rule> = {};
	for (const t of tables)
		for (const [k, r] of Object.entries(t)) {
			const prev = out[k];
			out[k] = prev ? (c, site) => prev(c, site) ?? r(c, site) : r;
		}
	return out;
}

/** Calls whose result is worth naming after the action: a started workflow, a child's result, an update's answer. */
const ACTIONS = new Set(["start", "execute", "signalWithStart", "executeChild", "startChild", "executeUpdate", "startUpdate"]);

/** Temporal TypeScript SDK (docs.temporal.io): workflows, activities, signals, queries and updates, child workflows, workers, the client, and schedules. */
export const temporal = (): TsPlugin<TemporalPhrases> => {
	const read = factsReader();
	const ctx = (e: Engine, say: TemporalPhrases): Ctx => ({ e, say, facts: read(e) });
	const rules = merge([workflowCalls(), clientCalls(), workerCalls(isWorker)]);
	const calls: Record<string, CallRule<TemporalPhrases>> = {};
	for (const [k, r] of Object.entries(rules))
		calls[k] = ({ e, say, node, args, obj, stmt }) => (usesTemporal(e) ? r(ctx(e, say), { node, args, obj, stmt }) : null);
	const conditions: Record<string, CondRule<TemporalPhrases>> = {};
	for (const [k, r] of Object.entries(workflowConditions()))
		conditions[k] = ({ e, say, node, args, neg }) => (usesTemporal(e) ? r(ctx(e, say), node, args, neg) : null);

	const single = (node: N): { id: N; init: N } | null => {
		if (node.type !== "VariableDeclaration" || node.declarations.length !== 1) return null;
		const v = node.declarations[0];
		return v.init ? { id: v.id, init: unwrap(v.init) } : null;
	};

	/** `const { greet } = proxyActivities(…)`, `defineSignal(…)`, `Worker.create(…)` and `new Client(…)`, named. */
	const define: StmtRule<TemporalPhrases> = ({ node, e, d, say }) => {
		const s = single(node);
		if (!s || !usesTemporal(e) || !["CallExpression", "NewExpression"].includes(s.init.type)) return false;
		const c = ctx(e, say);
		const fn = exportedName(c, s.init.callee);
		if (fn === "proxyActivities" || fn === "proxyLocalActivities") {
			const names =
				s.id.type === "ObjectPattern"
					? e.g.list(s.id.properties.filter((p: N) => p.type === "Property" && p.value?.type === "Identifier").map((p: N) => e.ref(p.value.name)))
					: null;
			const as = s.id.type === "Identifier" ? e.ref(s.id.name) : null;
			e.emitDoc(
				d,
				D(say.activities.proxy({ names, as, local: fn === "proxyLocalActivities", details: details(c, activityItems(c, s.init.arguments[0])) })),
				node,
			);
			return true;
		}
		if (s.id.type !== "Identifier") return false;
		const as = e.ref(s.id.name);
		const kind = fn === "defineSignal" ? "signal" : fn === "defineQuery" ? "query" : fn === "defineUpdate" ? "update" : null;
		if (kind && s.init.arguments[0]) {
			e.emitDoc(d, D(say.messages.define({ kind, name: e.text(s.init.arguments[0]), as, types: messageTypes(c, s.init) })), node);
			return true;
		}
		if (s.init.type === "NewExpression" && (fn === "Client" || fn === "WorkflowClient")) {
			e.emitDoc(d, D(say.client({ as, details: clientDetails(c, s.init.arguments[0]) })), node);
			return true;
		}
		const w = workerParts(c, s.init);
		if (!w) return false;
		e.emitDoc(d, D(say.worker.create({ as, ...w })), node);
		return true;
	};

	/** A call to a proxied activity: `await greet(name)` or `await acts.greet(name)`. */
	const activityCall = (c: Ctx, call: N): Doc | null => {
		const callee = unwrap(call?.callee);
		const own =
			(callee?.type === "Identifier" && c.facts.activities.has(callee.name)) ||
			(callee?.type === "MemberExpression" &&
				!callee.computed &&
				unwrap(callee.object)?.type === "Identifier" &&
				c.facts.activityObjects.has(unwrap(callee.object).name));
		if (call?.type !== "CallExpression" || !own) return null;
		const name = callee.type === "Identifier" ? callee.name : callee.property.name;
		return D(c.say.activities.call({ activity: c.e.fnRef(name, c.e.lex.humanize(name)), args: argsText(c, call.arguments) }));
	};

	/** Activity calls and started workflows as steps, with their result named or given back. */
	const steps: StmtRule<TemporalPhrases> = ({ node, e, d, say }) => {
		if (!usesTemporal(e)) return false;
		const s = single(node);
		const call =
			s && s.id.type === "Identifier"
				? s.init
				: node.type === "ReturnStatement"
					? unwrap(node.argument)
					: node.type === "ExpressionStatement"
						? unwrap(node.expression)
						: null;
		if (call?.type !== "CallExpression") return false;
		const c = ctx(e, say);
		let doc = activityCall(c, call);
		if (!doc) {
			if (node.type === "ExpressionStatement") return false;
			const callee = unwrap(call.callee);
			const m = callee?.type === "MemberExpression" ? callee.property.name : exportedName(c, callee);
			if (!m || !(ACTIONS.has(m) || (m === "create" && unwrap(callee.object)?.property?.name === "schedule"))) return false;
			const owner = callee.type === "MemberExpression" ? unwrap(callee.object)?.property?.name : null;
			const key = callee.type !== "MemberExpression" ? m : owner === "workflow" || owner === "schedule" ? `*.${owner}.${m}` : `*.${m}`;
			doc = rules[key]?.(c, { node: call, args: call.arguments, obj: callee.type === "MemberExpression" ? callee.object : null, stmt: true }) ?? null;
			if (!doc) return false;
		}
		const text = doc.t.replace(/:$/, "");
		if (node.type === "ExpressionStatement") e.emitDoc(d, doc, node);
		else if (s) e.emitDoc(d, D(e.say.declarations.callAs({ call: text, name: e.ref(s.id.name) }), doc.kids), node);
		else e.emitDoc(d, D(e.say.statements.returnCall({ call: text }), doc.kids), node);
		return true;
	};

	return definePlugin<TemporalPhrases>({
		name: "temporal",
		library: { name: "@temporalio/workflow", versions: ">=1 <2" },
		phrases: { en },
		errors: ["ApplicationFailure", "CancelledFailure"],
		calls,
		conditions,
		statements: [define, steps],
	});
};
