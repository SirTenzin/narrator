import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import {
	type Ctx,
	details,
	dur,
	exported,
	exportedName,
	genericOption,
	isHandle,
	keyOf,
	messageRef,
	objectArg,
	propOf,
	type Rule,
	str,
	usesTemporal,
} from "./shared";
import { cronText } from "./time";
import { argsText, startItems, workflowRef } from "./workflow";

/** `require.resolve("./workflows")` and `new URL("./workflows", import.meta.url)` as the path they name. */
function pathOf(c: Ctx, n: N): string {
	const u = unwrap(n);
	const callee = u?.type === "CallExpression" ? unwrap(u.callee) : null;
	if (callee?.type === "MemberExpression" && unwrap(callee.object)?.name === "require" && callee.property.name === "resolve") return c.e.text(u.arguments[0]);
	return c.e.text(n);
}

/** `Worker.create({ taskQueue, workflowsPath, activities, … })`. */
export function workerParts(c: Ctx, node: N): { queue: string; details: string | null } | null {
	const u = unwrap(node);
	const callee = u?.type === "CallExpression" ? unwrap(u.callee) : null;
	if (callee?.type !== "MemberExpression" || exportedName(c, callee.object) !== "Worker" || callee.property.name !== "create") return null;
	const o = objectArg(u.arguments[0]);
	if (!o) return null;
	const { e, say } = c;
	const w = say.worker;
	const items = o.properties.flatMap((p: N): string[] => {
		const k = keyOf(p);
		const v = p.value;
		switch (k) {
			case "taskQueue":
			case "connection":
				return [];
			case "workflowsPath":
				return [w.workflowsFrom({ path: pathOf(c, v) })];
			case "activities":
				return [w.activities({ activities: p.shorthand ? e.ref(k) : e.text(v) })];
			case "namespace":
				return [w.namespace({ namespace: e.text(v) })];
			case "maxConcurrentActivityTaskExecutions":
				return [w.maxActivities({ n: e.text(v) })];
			case "maxConcurrentWorkflowTaskExecutions":
				return [w.maxWorkflows({ n: e.text(v) })];
			default:
				return [genericOption(c, p)];
		}
	});
	return { queue: e.text(propOf(o, "taskQueue")), details: details(c, items) };
}

const connect: Rule = (c, { obj, args }) => {
	const owner = exportedName(c, obj);
	if (owner !== "Connection" && owner !== "NativeConnection") return null;
	const o = objectArg(args[0]);
	const address = o ? propOf(o, "address") : null;
	const rest = o ? o.properties.filter((p: N) => keyOf(p) !== "address").map((p: N) => genericOption(c, p)) : args.map((a) => c.e.text(a));
	return D(c.say.connection({ address: address ? c.e.text(address) : null, details: details(c, rest) }));
};

export function clientDetails(c: Ctx, n: N | undefined): string | null {
	const o = objectArg(n);
	if (!o) return n ? c.e.text(n) : null;
	return details(
		c,
		o.properties.flatMap((p: N) =>
			keyOf(p) === "connection" ? [] : keyOf(p) === "namespace" ? [c.say.worker.namespace({ namespace: c.e.text(p.value) })] : [genericOption(c, p)],
		),
	);
}

const newClient: Rule = (c, { node, args }) =>
	exportedName(c, node.callee) === "Client" || exportedName(c, node.callee) === "WorkflowClient"
		? D(c.say.client({ as: null, details: clientDetails(c, args[0]) }))
		: null;

const workerNoun: Rule = (c, { node, stmt }) => {
	const w = workerParts(c, node);
	return w ? D(c.say.worker.create({ as: null, ...w })) : null;
};

/** `client.workflow.start(wf, { taskQueue, args, workflowId, … })` and friends; the receiver is `*.workflow`. */
const isWorkflowClient = (c: Ctx, obj: N | null) => {
	const u = unwrap(obj);
	return usesTemporal(c.e) && u?.type === "MemberExpression" && !u.computed && u.property.name === "workflow";
};

const startLike =
	(mode: "start" | "execute"): Rule =>
	(c, { obj, args }) => {
		if (!isWorkflowClient(c, obj) || !args[0]) return null;
		const o = objectArg(args[1]);
		const parts = {
			workflow: workflowRef(c, args[0]),
			args: argsText(c, o && propOf(o, "args") ? [propOf(o, "args")] : []),
			details: details(c, startItems(c, o)),
		};
		return D(mode === "start" ? c.say.start.start(parts) : c.say.start.execute(parts));
	};

const signalWithStart: Rule = (c, { obj, args }) => {
	if (!isWorkflowClient(c, obj) || !args[0]) return null;
	const o = objectArg(args[1]);
	const signal = propOf(o, "signal");
	if (!o || !signal) return null;
	const signalArgs = propOf(o, "signalArgs");
	return D(
		c.say.start.signalWithStart({
			workflow: workflowRef(c, args[0]),
			signal: messageRef(c, signal).text,
			args: argsText(c, signalArgs ? [signalArgs] : []),
			details: details(c, startItems(c, o, ["signal", "signalArgs"])),
		}),
	);
};

const onWorkflowClient =
	(f: (c: Ctx, args: N[]) => Doc | null): Rule =>
	(c, { obj, args }) =>
		isWorkflowClient(c, obj) ? f(c, args) : null;

/** Handle methods: signal, query, update, result, cancel, terminate, describe. */
const onHandle =
	(f: (c: Ctx, workflow: string, args: N[]) => Doc | null): Rule =>
	(c, { obj, args }) =>
		obj && (isHandle(c, obj) || isExternal(c, obj)) ? f(c, c.e.text(obj), args) : null;

/** A handle made inline: `getExternalWorkflowHandle(id)` or `client.workflow.getHandle(id)`. */
const isExternal = (c: Ctx, n: N) => {
	const u = unwrap(n);
	if (u?.type !== "CallExpression") return false;
	const callee = unwrap(u.callee);
	if (callee?.type === "MemberExpression" && callee.property.name === "getHandle") return isWorkflowClient(c, callee.object);
	return exportedName(c, u.callee) === "getExternalWorkflowHandle";
};

const message =
	(phrase: "signal" | "query" | "executeUpdate" | "startUpdate"): Rule =>
	(c, site) => {
		const [m, ...rest] = site.args;
		if (!m) return null;
		const ref = messageRef(c, m);
		const known = ref.kind !== null || str(m) !== null;
		if (!known && !isHandle(c, site.obj) && !isExternal(c, site.obj)) return null;
		return onHandle((c2, workflow) => {
			const updateArgs = phrase === "executeUpdate" || phrase === "startUpdate" ? propOf(objectArg(rest[0]), "args") : null;
			const args = argsText(c2, updateArgs ? [updateArgs] : phrase === "executeUpdate" || phrase === "startUpdate" ? [] : rest);
			return D(c2.say.handle[phrase]({ message: ref.text, workflow, args }));
		})(c, site);
	};

/** `client.schedule.create({ scheduleId, spec, action, policies })`. */
const scheduleCreate: Rule = (c, { obj, args }) => {
	const u = unwrap(obj);
	if (!usesTemporal(c.e) || u?.type !== "MemberExpression" || u.property.name !== "schedule") return null;
	const o = objectArg(args[0]);
	const spec = objectArg(propOf(o, "spec"));
	const action = objectArg(propOf(o, "action"));
	if (!o || !spec || !action) return null;
	const { e, say } = c;
	const tz = str(propOf(spec, "timezone")) ?? "UTC";
	const crons = unwrap(propOf(spec, "cronExpressions"));
	const intervals = unwrap(propOf(spec, "intervals"));
	const when = [
		...(crons?.type === "ArrayExpression" ? crons.elements.filter(Boolean).map((x: N) => cronText({ e, time: say.time }, x, tz)) : []),
		...(intervals?.type === "ArrayExpression"
			? intervals.elements.filter(Boolean).map((x: N) => {
					const every = propOf(objectArg(x), "every");
					return every ? say.schedule.every({ duration: dur(c, every) }) : e.text(x);
				})
			: []),
	];
	const wfArgs = propOf(action, "args");
	const queue = propOf(action, "taskQueue");
	const act = say.schedule.startWorkflow({
		workflow: workflowRef(c, propOf(action, "workflowType") ?? action),
		args: argsText(c, wfArgs ? [wfArgs] : []),
		queue: queue ? e.text(queue) : null,
	});
	const policies = objectArg(propOf(o, "policies"));
	const overlap = policies && propOf(policies, "overlap");
	const state = objectArg(propOf(o, "state"));
	const extra = [
		...(overlap ? [say.schedule.overlap({ policy: e.text(overlap) })] : []),
		...(state && unwrap(propOf(state, "paused"))?.value === true ? [say.schedule.paused] : []),
	];
	return D(say.schedule.create({ id: e.text(propOf(o, "scheduleId")), action: act, when: e.g.list(when, "or"), details: details(c, extra) }));
};

/** Activity-side helpers from `@temporalio/activity`. */
const heartbeat: Rule = (c, { node, obj, args }) => {
	const fromContext = obj && unwrap(obj)?.type === "CallExpression" && exportedName(c, unwrap(unwrap(obj).callee)?.object) === "Context";
	if (!fromContext && exported(c, node.callee)?.from !== "@temporalio/activity") return null;
	return D(c.say.activities.heartbeatNow({ details: args[0] ? c.e.text(args[0]) : null }));
};

const activitySleep: Rule = (c, { node, obj, args }) => {
	const fromContext = obj && unwrap(obj)?.type === "CallExpression" && exportedName(c, unwrap(unwrap(obj).callee)?.object) === "Context";
	if ((!fromContext && exported(c, node.callee)?.from !== "@temporalio/activity") || !args[0]) return null;
	return D(c.say.activities.sleep({ duration: dur(c, args[0]) }));
};

export function clientCalls(): Record<string, Rule> {
	const h = (c: Ctx) => c.say.handle;
	return {
		"*.connect": connect,
		"new Client": newClient,
		"new WorkflowClient": newClient,
		"*.create": workerNoun,
		"*.workflow.start": startLike("start"),
		"*.workflow.execute": startLike("execute"),
		"*.workflow.signalWithStart": signalWithStart,
		"*.workflow.getHandle": onWorkflowClient((c, [id]) => (id ? D(c.say.start.getHandle({ id: c.e.text(id) })) : null)),
		"*.workflow.list": onWorkflowClient((c, [o]) =>
			D(c.say.start.list({ query: propOf(objectArg(o), "query") ? c.e.text(propOf(objectArg(o), "query")) : null })),
		),
		"*.schedule.create": scheduleCreate,
		"*.schedule.getHandle": (c, { obj, args }) =>
			usesTemporal(c.e) && unwrap(obj)?.property?.name === "schedule" && args[0] ? D(c.say.schedule.getHandle({ id: c.e.text(args[0]) })) : null,
		"*.signal": message("signal"),
		"*.query": message("query"),
		"*.executeUpdate": message("executeUpdate"),
		"*.startUpdate": message("startUpdate"),
		"*.result": onHandle((c, workflow, args) => (args.length ? null : D(h(c).result({ workflow })))),
		"*.cancel": onHandle((c, workflow) => D(h(c).cancel({ workflow }))),
		"*.terminate": onHandle((c, workflow, [reason]) => D(h(c).terminate({ workflow, reason: reason ? c.e.text(reason) : null }))),
		"*.describe": onHandle((c, workflow) => D(h(c).describe({ workflow }))),
		heartbeat,
		"*.heartbeat": heartbeat,
		sleep: activitySleep,
		"*.sleep": activitySleep,
		activityInfo: (c, { node }) => (exportedName(c, node.callee) === "activityInfo" ? D(c.say.activities.info) : null),
		cancelled: (c, { node }) => (exportedName(c, node.callee) === "cancelled" ? D(c.say.activities.cancelled) : null),
	};
}

/** `await worker.run()` and friends; the receiver is a worker made by `Worker.create`. */
export function workerCalls(isWorker: (c: Ctx, n: N | null) => boolean): Record<string, Rule> {
	const w = (c: Ctx) => c.say.worker;
	return {
		"*.run": (c, { obj, args }) => (isWorker(c, obj) && !args.length ? D(w(c).run({ worker: c.e.text(obj) })) : null),
		"*.runUntil": (c, { obj, args }) => (isWorker(c, obj) && args[0] ? D(w(c).runUntil({ worker: c.e.text(obj), until: c.e.text(args[0]) })) : null),
		"*.shutdown": (c, { obj }) => (isWorker(c, obj) ? D(w(c).shutdown({ worker: c.e.text(obj) })) : null),
	};
}
