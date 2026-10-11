import { D, type Doc, type Line, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, codeText, dur, eventName, fnLines, importedAs, isClient, isFn, objectArg, oneLine, propOf, type Rule, str, usesInngest } from "./shared";

/** Event data; a small object literal reads as its fields. */
function dataText(c: Ctx, n: N | null): { t: string | null; kids: Line[] } {
	if (!n) return { t: null, kids: [] };
	const u = unwrap(n);
	if (u?.type === "ObjectExpression" && !u.properties.length) return { t: null, kids: [] };
	if (u?.type === "ObjectExpression" && u.properties.length <= 4) {
		const fields = u.properties.map((p: N) => c.e.objectProp(p));
		if (fields.every((f: Doc) => !f.kids.length)) return { t: c.say.events.data({ data: c.e.g.list(fields.map((f: Doc) => f.t)), bare: false }), kids: [] };
	}
	const d = c.e.noun(n);
	return { t: c.say.events.data({ data: d.t, bare: u?.type === "Identifier" && /^data$/i.test(u.name) }), kids: d.kids };
}

/** One event payload: `{ name, data }` or `userCreated.create(data)`. */
function eventDoc(c: Ctx, n: N): Doc | null {
	const u = unwrap(n);
	if (u?.type === "CallExpression") {
		const callee = unwrap(u.callee);
		const owner = callee?.type === "MemberExpression" ? unwrap(callee.object) : null;
		if (callee?.property?.name !== "create" || owner?.type !== "Identifier" || !c.facts.eventTypes.has(owner.name)) return null;
		const data = dataText(c, u.arguments[0]);
		return D(c.say.events.one({ name: eventName(c, owner), data: data.t }), data.kids);
	}
	const o = objectArg(u);
	const name = o && propOf(o, "name");
	if (!name) return null;
	const data = dataText(c, propOf(o, "data"));
	return D(c.say.events.one({ name: eventName(c, name), data: data.t }), data.kids);
}

/** One event, or a list of them beneath "these events". */
function eventsDoc(c: Ctx, n: N): Doc {
	const u = unwrap(n);
	if (u?.type === "ArrayExpression") {
		const docs = u.elements.filter(Boolean).map((x: N) => eventDoc(c, x) ?? c.e.noun(x));
		if (docs.length === 1) return docs[0]!;
		return D(
			c.say.events.several,
			docs.flatMap((d: Doc) => c.e.bullet(d)),
		);
	}
	return eventDoc(c, u) ?? c.e.noun(n);
}

type StepRule = (c: Ctx, args: N[], as: string | null) => Doc | null;

/** A step ID: a string, or `{ id, name }` where `name` is only a display label. */
const id = (c: Ctx, n: N) => {
	const o = objectArg(n);
	const inner = o && propOf(o, "id");
	return c.e.text(inner ?? n);
};

const run: StepRule = (c, [name, fn]) => {
	if (!name || !fn) return null;
	if (!isFn(fn)) return D(c.say.steps.run({ id: id(c, name), action: c.say.fn.handler({ handler: c.e.text(fn) }) }));
	const action = oneLine(c.e, fn);
	if (action !== null) return D(c.say.steps.run({ id: id(c, name), action }));
	return D(c.say.steps.run({ id: id(c, name), action: null }), fnLines(c.e, fn));
};

const waitForEvent: StepRule = (c, [name, opts], as) => {
	const o = objectArg(opts);
	if (!name || !o) return null;
	const match = propOf(o, "match");
	const cond = propOf(o, "if");
	const timeout = propOf(o, "timeout");
	return D(
		c.say.steps.waitForEvent({
			event: eventName(c, propOf(o, "event")),
			match: match ? codeText(c, match) : null,
			condition: cond ? codeText(c, cond) : null,
			timeout: timeout ? dur(c, timeout) : null,
			id: id(c, name),
			as,
		}),
	);
};

const STEPS: Record<string, StepRule> = {
	run,
	sleep: (c, [name, d]) => (name && d ? D(c.say.steps.sleep({ duration: dur(c, d), id: id(c, name) })) : null),
	sleepUntil: (c, [name, t]) => (name && t ? D(c.say.steps.sleepUntil({ time: c.e.text(t), id: id(c, name) })) : null),
	waitForEvent,
	waitForSignal: (c, [name, opts], as) => {
		const o = objectArg(opts);
		if (!name || !o) return null;
		const timeout = propOf(o, "timeout");
		return D(c.say.steps.waitForSignal({ signal: codeText(c, propOf(o, "signal")), timeout: timeout ? dur(c, timeout) : null, id: id(c, name), as }));
	},
	sendEvent: (c, [name, payload]) => {
		if (!name || !payload) return null;
		const ev = eventsDoc(c, payload);
		return D(c.say.steps.sendEvent({ events: ev.t, id: id(c, name) }), ev.kids);
	},
	invoke: (c, [name, opts]) => {
		const o = objectArg(opts);
		if (!name || !o) return null;
		const data = dataText(c, propOf(o, "data") ?? propOf(o, "payload"));
		const timeout = propOf(o, "timeout");
		const fn = propOf(o, "function");
		return D(
			c.say.steps.invoke({
				fn: fn ? (str(fn) !== null ? codeText(c, fn) : c.e.text(fn)) : c.e.text(o),
				data: data.t,
				timeout: timeout ? dur(c, timeout) : null,
				id: id(c, name),
			}),
			data.kids,
		);
	},
	fetch: (c, [url]) => (url ? D(c.say.steps.fetch({ url: c.e.text(url) })) : null),
};

const AI: Record<string, StepRule> = {
	infer: (c, [name, opts]) => {
		const model = propOf(objectArg(opts), "model");
		return name && model ? D(c.say.steps.aiInfer({ model: c.e.text(model), id: id(c, name) })) : null;
	},
	wrap: (c, [name, fn, ...rest]) => {
		if (!name || !fn) return null;
		const args = rest.length ? c.e.g.list(rest.map((a) => c.e.text(a))) : null;
		return D(c.say.steps.aiWrap({ fn: c.e.text(fn), args, id: id(c, name) }));
	},
};

/** Whether a call is one of the durable step tools, so its result can be named after it. */
export const isStepCall = (n: N): string | null => {
	const u = unwrap(n);
	const callee = u?.type === "CallExpression" ? unwrap(u.callee) : null;
	if (callee?.type !== "MemberExpression" || callee.computed) return null;
	const owner = unwrap(callee.object);
	const isStep = (x: N) => (x?.type === "Identifier" && x.name === "step") || (x?.type === "MemberExpression" && !x.computed && x.property.name === "step");
	if (isStep(owner) && STEPS[callee.property.name]) return callee.property.name;
	if (owner?.type === "MemberExpression" && owner.property?.name === "ai" && isStep(unwrap(owner.object)) && AI[callee.property.name])
		return `ai.${callee.property.name}`;
	return null;
};

/** A step call rendered with `as` naming its result (only `waitForEvent` / `waitForSignal` say it themselves). */
export function stepDoc(c: Ctx, n: N, as: string | null): Doc | null {
	const which = isStepCall(n);
	if (!which || !usesInngest(c.e)) return null;
	const args = unwrap(n).arguments;
	return which.startsWith("ai.") ? AI[which.slice(3)]!(c, args, as) : STEPS[which]!(c, args, as);
}

const stepRule: Rule = (c, { node }) => stepDoc(c, node, null);

const send: Rule = (c, { obj, args }) => {
	if (!isClient(c, obj) || !args[0]) return null;
	const ev = eventsDoc(c, args[0]);
	return D(c.say.events.send({ events: ev.t }), ev.kids);
};

/** `serve({ client, functions })` from `inngest/<framework>`; `handlers` names destructured exports like `GET`. */
export function serveDoc(c: Ctx, node: N, handlers: string | null): Doc | null {
	const imp = importedAs(c, node.callee);
	if (imp?.name !== "serve") return null;
	const o = objectArg(node.arguments[0]);
	const fns = unwrap(propOf(o, "functions"));
	const client = propOf(o, "client");
	const listed = fns?.type === "ArrayExpression";
	const functions = listed ? c.e.g.list(fns.elements.filter(Boolean).map((x: N) => c.e.text(x))) : fns ? c.e.text(fns) : "";
	return D(
		c.say.serve({ functions, listed, client: client ? c.e.text(client) : null, framework: imp.from === "inngest" ? null : mk("c", imp.from), handlers }),
	);
}

const serve: Rule = (c, { node }) => serveDoc(c, node, null);

const eventType: Rule = (c, { node, args }) => {
	if (importedAs(c, node.callee)?.name !== "eventType" || !args[0]) return null;
	const schema = propOf(objectArg(args[1]), "schema");
	return D(c.say.events.type({ name: codeText(c, args[0]), schema: schema ? c.e.text(schema) : null }));
};

const createEvent: Rule = (c, { node }) => eventDoc(c, node);

export function stepCalls(): Record<string, Rule> {
	const out: Record<string, Rule> = {};
	for (const m of Object.keys(STEPS)) {
		out[`step.${m}`] = stepRule;
		out[`*.step.${m}`] = stepRule;
	}
	for (const m of Object.keys(AI)) out[`*.ai.${m}`] = stepRule;
	return { ...out, "*.send": send, serve, eventType, "*.create": createEvent };
}
