import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import {
	type Ctx,
	details,
	dur,
	exported,
	exportedName,
	fnLines,
	genericOption,
	isFn,
	keyOf,
	messageRef,
	objectArg,
	oneLine,
	propOf,
	type Rule,
} from "./shared";
import { cronText } from "./time";

/** `retry: { initialInterval, backoffCoefficient, maximumInterval, maximumAttempts, nonRetryableErrorTypes }`. */
export function retryItems(c: Ctx, n: N): string[] {
	const { e, say } = c;
	const o = objectArg(n);
	if (!o) return [say.option({ name: e.prop("retry"), value: e.text(n) })];
	const items: string[] = [];
	const attempts = propOf(o, "maximumAttempts");
	if (attempts) items.push(e.fold(attempts) === 0 ? say.retry.unlimited : say.retry.attempts({ n: e.text(attempts), count: e.fold(attempts) }));
	const initial = propOf(o, "initialInterval");
	const factor = propOf(o, "backoffCoefficient");
	const max = propOf(o, "maximumInterval");
	if ((initial || factor || max) && e.fold(attempts) !== 1)
		items.push(say.retry.backoff({ initial: initial ? dur(c, initial) : null, factor: factor ? e.text(factor) : null, max: max ? dur(c, max) : null }));
	const types = unwrap(propOf(o, "nonRetryableErrorTypes"));
	if (types)
		items.push(
			say.retry.nonRetryable({
				types:
					types.type === "ArrayExpression"
						? e.g.list(
								types.elements.filter(Boolean).map((x: N) => e.text(x)),
								"or",
							)
						: e.text(types),
			}),
		);
	return items;
}

/** `proxyActivities({ startToCloseTimeout, retry, … })` options. */
export function activityItems(c: Ctx, n: N | undefined): string[] {
	const { e, say } = c;
	const a = say.activities;
	const o = objectArg(n);
	if (!o) return n ? [e.text(n)] : [];
	return o.properties.flatMap((p: N): string[] => {
		const k = keyOf(p);
		const v = p.value;
		switch (k) {
			case "startToCloseTimeout":
				return [a.startToClose({ duration: dur(c, v) })];
			case "scheduleToCloseTimeout":
				return [a.scheduleToClose({ duration: dur(c, v) })];
			case "scheduleToStartTimeout":
				return [a.scheduleToStart({ duration: dur(c, v) })];
			case "heartbeatTimeout":
				return [a.heartbeat({ duration: dur(c, v) })];
			case "taskQueue":
				return [a.taskQueue({ queue: e.text(v) })];
			case "retry":
				return retryItems(c, v);
			default:
				return [genericOption(c, p)];
		}
	});
}

const named = (c: Ctx, node: N, name: string) => exportedName(c, node.callee) === name;

/** A callback that fits on one line reads inline after the title; otherwise its steps go beneath. */
function titled(c: Ctx, title: string, fn: N): Doc {
	if (!isFn(fn)) return D(title);
	const one = oneLine(c.e, fn);
	return one !== null ? D(`${title}: ${one}`) : D(title, fnLines(c.e, fn));
}

function argsText(c: Ctx, args: N[]): string | null {
	if (!args.length) return null;
	const u = unwrap(args[0]);
	if (args.length === 1 && u?.type === "ArrayExpression") return u.elements.length ? c.e.g.list(u.elements.filter(Boolean).map((x: N) => c.e.text(x))) : null;
	return c.e.g.list(args.map((a) => c.e.text(a)));
}

/** Start options shared by child workflows and the client: task queue, workflow ID, timeouts, policies. */
export function startItems(c: Ctx, o: N | null, skip: string[] = []): string[] {
	if (!o) return [];
	const { e, say } = c;
	const s = say.start;
	return o.properties.flatMap((p: N): string[] => {
		const k = keyOf(p);
		const v = p.value;
		if (k && skip.includes(k)) return [];
		switch (k) {
			case "args":
				return [];
			case "taskQueue":
				return [s.taskQueue({ queue: e.text(v) })];
			case "workflowId":
				return [s.workflowId({ id: e.text(v) })];
			case "cronSchedule":
				return [s.cron({ schedule: cronOf(c, v) })];
			case "startDelay":
				return [s.startDelay({ duration: dur(c, v) })];
			case "workflowExecutionTimeout":
				return [s.executionTimeout({ duration: dur(c, v) })];
			case "workflowRunTimeout":
				return [s.runTimeout({ duration: dur(c, v) })];
			case "workflowIdReusePolicy":
				return [s.reusePolicy({ policy: e.text(v) })];
			case "workflowIdConflictPolicy":
				return [s.conflictPolicy({ policy: e.text(v) })];
			case "parentClosePolicy":
				return [say.child.parentClosePolicy({ policy: e.text(v) })];
			case "retry":
				return retryItems(c, v);
			default:
				return [genericOption(c, p)];
		}
	});
}

const cronOf = (c: Ctx, n: N) => cronText({ e: c.e, time: c.say.time }, n, "UTC");

/** The workflow being started: a function reference, or its type name as a string. */
export const workflowRef = (c: Ctx, n: N) => c.e.text(n);

/** `executeChild(wf, opts)` / `startChild(wf, opts)`. */
const child =
	(wait: boolean): Rule =>
	(c, { node, args }) => {
		if (!named(c, node, wait ? "executeChild" : "startChild") || !args[0]) return null;
		const o = objectArg(args[1]);
		const parts = { workflow: workflowRef(c, args[0]), args: argsText(c, o ? [propOf(o, "args")].filter(Boolean) : []), details: details(c, startItems(c, o)) };
		return D(wait ? c.say.child.execute(parts) : c.say.child.start(parts));
	};

const failure: Rule = (c, { node, obj, args }) => {
	const callee = unwrap(node.callee);
	if (!obj || exportedName(c, obj) !== "ApplicationFailure") return null;
	const m = callee.property.name;
	const f = c.say.failure;
	if (m === "nonRetryable" || m === "retryable") {
		const parts = { message: args[0] ? c.e.text(args[0]) : null, type: args[1] ? c.e.text(args[1]) : null };
		return D(m === "nonRetryable" ? f.nonRetryable(parts) : f.retryable(parts));
	}
	if (m !== "create" && m !== "fromError") return null;
	const o = objectArg(args[m === "fromError" ? 1 : 0]);
	const msg = propOf(o, "message");
	const type = propOf(o, "type");
	return D(
		f.create({ message: msg ? c.e.text(msg) : null, type: type ? c.e.text(type) : null, nonRetryable: unwrap(propOf(o, "nonRetryable"))?.value === true }),
	);
};

const scope: Rule = (c, { obj, node, args }) => {
	if (!obj || exportedName(c, obj) !== "CancellationScope") return null;
	const m = unwrap(node.callee).property.name;
	const w = c.say.workflow;
	if (m === "cancellable" && args[0]) return titled(c, w.cancellable, args[0]);
	if (m === "nonCancellable" && args[0]) return titled(c, w.nonCancellable, args[0]);
	if (m === "withTimeout" && args[1]) return titled(c, w.withTimeout({ duration: dur(c, args[0]) }), args[1]);
	return null;
};

/** `condition(() => approved, "1 day")`: the lambda's test, read as a condition. */
const conditionOf = (c: Ctx, fn: N) => {
	const f = unwrap(fn);
	if (!isFn(f)) return c.e.text(fn);
	const body =
		f.body.type === "BlockStatement" ? (f.body.body.length === 1 && f.body.body[0].type === "ReturnStatement" ? f.body.body[0].argument : null) : f.body;
	return body ? c.e.cond(body).t : c.e.text(fn);
};

const condition: Rule = (c, { node, args }) => {
	if (!named(c, node, "condition") || !args[0]) return null;
	return D(c.say.workflow.waitUntil({ condition: conditionOf(c, args[0]), timeout: args[1] ? dur(c, args[1]) : null }));
};

/** A query handler's single returned value. */
function queryAnswer(fn: N): N | null {
	const f = unwrap(fn);
	if (f.body.type !== "BlockStatement") return f.body;
	const only = f.body.body.length === 1 ? f.body.body[0] : null;
	return only?.type === "ReturnStatement" ? only.argument : null;
}

const setHandler: Rule = (c, { node, args }) => {
	if (!named(c, node, "setHandler") || !args[0]) return null;
	const m = messageRef(c, args[0]);
	const h = unwrap(args[1]);
	const say = c.say.messages;
	if (!h || (h.type === "Identifier" && h.name === "undefined")) return D(say.unset({ message: m.text }));
	if (!isFn(h)) return D(say.handleWith({ kind: m.kind, message: m.text, handler: c.e.text(h) }));
	const answer = m.kind === "query" ? queryAnswer(h) : null;
	if (answer) {
		const v = c.e.noun(answer);
		return D(say.answer({ message: m.text, value: v.t }), v.kids);
	}
	const one = oneLine(c.e, h);
	if (one !== null) return D(say.handle({ kind: m.kind, message: m.text, action: one }));
	return D(say.handle({ kind: m.kind, message: m.text, action: null }), fnLines(c.e, h));
};

const define: Rule = (c, { node, args }) => {
	const name = exportedName(c, node.callee);
	const kind = name === "defineSignal" ? "signal" : name === "defineQuery" ? "query" : name === "defineUpdate" ? "update" : null;
	if (!kind || !args[0]) return null;
	return D(c.say.messages.noun({ kind, name: c.e.text(args[0]) }));
};

/** `defineSignal<[string]>("approve")`: the payload (or, for queries and updates, the answer) type. */
export function messageTypes(c: Ctx, node: N): string | null {
	const params = unwrap(node).typeArguments?.params ?? [];
	if (!params.length) return null;
	return c.e.g.list(params.map((t: N) => c.e.typeText(t.type === "TSTupleType" && t.elementTypes?.length === 1 ? t.elementTypes[0] : t)));
}

const simple =
	(name: string, f: (c: Ctx, args: N[]) => Doc | null): Rule =>
	(c, { node, args }) =>
		named(c, node, name) ? f(c, args) : null;

export function workflowCalls(): Record<string, Rule> {
	const both = (name: string, r: Rule) => ({ [name]: r, [`*.${name}`]: r });
	const w = (c: Ctx) => c.say.workflow;
	return {
		...both("sleep", (c, { node, args: [d] }) => {
			if (!d || exported(c, node.callee)?.from !== "@temporalio/workflow") return null;
			return D(w(c).sleep({ duration: dur(c, d) }));
		}),
		...both("condition", condition),
		...both("setHandler", setHandler),
		...both("defineSignal", define),
		...both("defineQuery", define),
		...both("defineUpdate", define),
		...both("executeChild", child(true)),
		...both("startChild", child(false)),
		...both(
			"continueAsNew",
			simple("continueAsNew", (c, args) => D(w(c).continueAsNew({ args: argsText(c, args) }))),
		),
		...both(
			"workflowInfo",
			simple("workflowInfo", (c) => D(w(c).info)),
		),
		...both(
			"uuid4",
			simple("uuid4", (c) => D(w(c).uuid)),
		),
		...both(
			"deprecatePatch",
			simple("deprecatePatch", (c, [id]) => (id ? D(w(c).deprecatePatch({ id: c.e.text(id) })) : null)),
		),
		...both(
			"getExternalWorkflowHandle",
			simple("getExternalWorkflowHandle", (c, [id]) => (id ? D(w(c).external({ id: c.e.text(id) })) : null)),
		),
		"*.nonRetryable": failure,
		"*.retryable": failure,
		"*.create": failure,
		"*.fromError": failure,
		"*.cancellable": scope,
		"*.nonCancellable": scope,
		"*.withTimeout": scope,
	};
}

/** `patched("id")` and `isCancellation(err)` as yes/no conditions. */
export function workflowConditions(): Record<string, (c: Ctx, node: N, args: N[], neg: boolean) => Doc | null> {
	const patched = (c: Ctx, node: N, [id]: N[], neg: boolean) => (named(c, node, "patched") && id ? D(c.say.workflow.patched({ id: c.e.text(id), neg })) : null);
	const cancellation = (c: Ctx, node: N, [err]: N[], neg: boolean) =>
		named(c, node, "isCancellation") && err ? D(c.say.workflow.isCancellation({ error: c.e.text(err), neg })) : null;
	const came = (c: Ctx, node: N, [fn, t]: N[], neg: boolean) =>
		named(c, node, "condition") && fn && t ? D(c.say.workflow.cameTrue({ condition: conditionOf(c, fn), timeout: dur(c, t), neg })) : null;
	return {
		patched,
		"*.patched": patched,
		isCancellation: cancellation,
		"*.isCancellation": cancellation,
		condition: came,
		"*.condition": came,
	};
}

export const isTemporalCall = (c: Ctx, node: N, names: string[]) => {
	const x = exported(c, unwrap(node)?.callee);
	return !!x && names.includes(x.name);
};

export { argsText };
