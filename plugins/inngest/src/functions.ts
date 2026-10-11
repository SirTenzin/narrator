import { capFirst, D, type Line } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import {
	type Ctx,
	codeText,
	details,
	dur,
	eventName,
	fnLines,
	genericOption,
	importedAs,
	isFn,
	keyOf,
	objectArg,
	perDur,
	propOf,
	type Rule,
	str,
	usesInngest,
} from "./shared";
import { cronText } from "./time";

const time = (c: Ctx) => ({ e: c.e, time: c.say.time });

/** One trigger: `{ event, if }`, `{ cron }`, an `eventType` constant, or v4's `cron(…)` / `invoke(…)` helpers. */
function triggerText(c: Ctx, n: N): string {
	const { say } = c;
	const u = unwrap(n);
	if (u?.type === "Identifier") return say.triggers.event({ event: eventName(c, u), condition: null });
	if (u?.type === "CallExpression") {
		const helper = importedAs(c, u.callee)?.name;
		if (helper === "cron") return say.triggers.cron({ schedule: cronText(time(c), u.arguments[0]) });
		if (helper === "invoke") return say.triggers.invoked;
		if (helper === "eventType") return say.triggers.event({ event: codeText(c, u.arguments[0]), condition: null });
	}
	const o = objectArg(u);
	if (!o) return say.triggers.other({ value: c.e.text(n) });
	const cron = propOf(o, "cron");
	if (cron) return say.triggers.cron({ schedule: cronText(time(c), cron) });
	const event = propOf(o, "event");
	if (!event) return say.triggers.other({ value: c.e.text(n) });
	const cond = propOf(o, "if") ?? propOf(o, "expression");
	return say.triggers.event({ event: eventName(c, event), condition: cond ? codeText(c, cond) : null });
}

export function triggersText(c: Ctx, n: N | null): string {
	const u = unwrap(n);
	if (!u) return c.say.triggers.none;
	if (u.type !== "ArrayExpression") return triggerText(c, u);
	const items = u.elements.filter(Boolean).map((x: N) => triggerText(c, x));
	return items.length ? c.say.triggers.any({ triggers: items }) : c.say.triggers.none;
}

/** `concurrency: 5`, `{ limit, key, scope }`, or a list of them. */
function concurrencyText(c: Ctx, n: N): string[] {
	const u = unwrap(n);
	if (u?.type === "ArrayExpression") return u.elements.filter(Boolean).flatMap((x: N) => concurrencyText(c, x));
	const o = objectArg(u);
	if (!o) return [c.say.config.concurrency({ n: c.e.text(n), key: null, scope: "fn" })];
	const key = propOf(o, "key");
	const scope = str(propOf(o, "scope"));
	return [
		c.say.config.concurrency({
			n: c.e.text(propOf(o, "limit")),
			key: key ? codeText(c, key) : null,
			scope: scope === "env" || scope === "account" ? scope : "fn",
		}),
	];
}

/** Function options in the order written, minus `id`, `triggers` and `onFailure`, which shape the title and body. */
function configItems(c: Ctx, o: N): string[] {
	const { e, say } = c;
	const cf = say.config;
	const key = (x: N) => {
		const k = propOf(x, "key");
		return k ? codeText(c, k) : null;
	};
	return o.properties.flatMap((p: N): string[] => {
		const k = keyOf(p);
		const v = p.value;
		const vo = objectArg(v);
		switch (k) {
			case "id":
			case "triggers":
			case "onFailure":
			case "middleware":
				return [];
			case "name":
				return [say.fn.displayName({ name: e.text(v) })];
			case "concurrency":
				return concurrencyText(c, v);
			case "throttle":
				if (!vo) break;
				return [
					cf.throttle({
						limit: e.text(propOf(vo, "limit")),
						period: perDur(c, propOf(vo, "period")),
						key: key(vo),
						burst: propOf(vo, "burst") ? e.text(propOf(vo, "burst")) : null,
					}),
				];
			case "rateLimit":
				if (!vo) break;
				return [cf.rateLimit({ limit: e.text(propOf(vo, "limit")), period: perDur(c, propOf(vo, "period")), key: key(vo) })];
			case "debounce":
				if (!vo) break;
				return [cf.debounce({ period: dur(c, propOf(vo, "period")), key: key(vo), timeout: propOf(vo, "timeout") ? dur(c, propOf(vo, "timeout")) : null })];
			case "retries":
				return [cf.retries({ n: e.text(v), count: e.fold(v) })];
			case "cancelOn": {
				const list = unwrap(v)?.type === "ArrayExpression" ? unwrap(v).elements.filter(Boolean) : [v];
				return list.map((x: N) => {
					const xo = objectArg(x);
					if (!xo) return e.text(x);
					const match = propOf(xo, "match");
					const cond = propOf(xo, "if");
					const timeout = propOf(xo, "timeout");
					return cf.cancelOn({
						event: eventName(c, propOf(xo, "event")),
						match: match ? codeText(c, match) : null,
						condition: cond ? codeText(c, cond) : null,
						timeout: timeout ? dur(c, timeout) : null,
					});
				});
			}
			case "priority": {
				const run = vo && propOf(vo, "run");
				return run ? [cf.priority({ expr: codeText(c, run) })] : [genericOption(c, p)];
			}
			case "batchEvents":
				if (!vo) break;
				return [cf.batch({ size: e.text(propOf(vo, "maxSize")), timeout: propOf(vo, "timeout") ? dur(c, propOf(vo, "timeout")) : null, key: key(vo) })];
			case "idempotency":
				return [cf.idempotency({ key: codeText(c, v) })];
			case "singleton":
				if (!vo) break;
				return [cf.singleton({ key: key(vo), mode: str(propOf(vo, "mode")) === "cancel" ? "cancel" : "skip" })];
			case "timeouts": {
				if (!vo) break;
				const start = propOf(vo, "start");
				const finish = propOf(vo, "finish");
				return [...(start ? [cf.startTimeout({ duration: dur(c, start) })] : []), ...(finish ? [cf.finishTimeout({ duration: dur(c, finish) })] : [])];
			}
		}
		return [genericOption(c, p)];
	});
}

export type FunctionParts = { id: string; triggers: string; details: string | null; lines: Line[] };

/** `createFunction(config, trigger, handler)` (v3) or `createFunction({ …, triggers }, handler)` (v4). */
export function functionParts(c: Ctx, args: N[]): FunctionParts | null {
	const config = objectArg(args[0]);
	if (!config || !propOf(config, "id")) return null;
	const v3 = args.length >= 3;
	const trigger = v3 ? args[1] : propOf(config, "triggers");
	const handler = unwrap(v3 ? args[2] : args[1]);
	if (!handler) return null;
	const { e, say } = c;
	const lines = isFn(handler) ? fnLines(e, handler) : e.bullet(D(say.fn.handler({ handler: e.text(handler) })));
	const onFailure = unwrap(propOf(config, "onFailure"));
	const line = (text: string): Line => ({ d: 0, text: capFirst(text), start: onFailure.start, end: onFailure.end, kind: "stmt" });
	const failure: Line[] = !onFailure
		? []
		: isFn(onFailure)
			? [line(`${say.fn.onFailure}:`), ...fnLines(e, onFailure).map((l) => ({ ...l, d: l.d + 1 }))]
			: [line(`${say.fn.onFailureWith({ handler: e.text(onFailure) })}.`)];
	return {
		id: c.e.text(propOf(config, "id")),
		triggers: triggersText(c, trigger),
		details: details(c, configItems(c, config)),
		lines: [...lines, ...failure],
	};
}

const createFunction: Rule = (c, { obj, args }) => {
	if (!usesInngest(c.e) || !obj) return null;
	const f = functionParts(c, args);
	return f ? D(c.say.fn.noun(f), f.lines) : null;
};

export const functionCalls = (): Record<string, Rule> => ({ "*.createFunction": createFunction });
