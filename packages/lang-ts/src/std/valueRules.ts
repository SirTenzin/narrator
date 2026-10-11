import { D, type Doc, mk } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "../engine";
import type { CallRule } from "../plugin";
import { block, isFn, itemName, lambdaBlock, lambdaNoun } from "./lambdas";
import type { StdPhrases } from "./phrases";

type Calls = Record<string, CallRule<StdPhrases>>;

const DATE_PARTS = ["FullYear", "Month", "Date", "Day", "Hours", "Minutes", "Seconds", "Milliseconds"] as const;

export const valueRules: Calls = {
	"*.toString": ({ obj, e, say }) => D(say.text.asText({ value: e.text(obj) })),
	"*.toLowerCase": ({ obj, e, say }) => D(say.text.lowercase({ value: e.text(obj) })),
	"*.toUpperCase": ({ obj, e, say }) => D(say.text.uppercase({ value: e.text(obj) })),
	"*.trim": ({ obj, e, say }) => D(say.text.trimmed({ value: e.text(obj) })),
	"*.split": ({ obj, args, e, say }) => D(say.text.split({ value: e.text(obj), sep: e.text(args[0]) })),
	"*.replace": ({ obj, args, e, say }) => D(say.text.replace({ value: e.text(obj), search: e.text(args[0]), replacement: e.text(args[1]) })),
	"*.replaceAll": ({ obj, args, e, say }) => D(say.text.replaceAll({ value: e.text(obj), search: e.text(args[0]), replacement: e.text(args[1]) })),
	"*.toFixed": ({ obj, args, e, say }) => D(say.number.toFixed({ value: e.text(obj), places: e.text(args[0]) })),
	"*.padStart": ({ obj, args, e, say }) => D(say.text.padStart({ value: e.text(obj), length: e.text(args[0]) })),
	"*.getTime": ({ obj, e, say }) => D(say.date.timestamp({ value: e.text(obj) })),
	"*.valueOf": ({ obj, e }) => e.noun(obj),
	"*.toISOString": ({ obj, e, say }) => D(say.date.isoString({ value: e.text(obj) })),
	"*.charAt": ({ obj, args, e, say }) => D(say.text.charAt({ value: e.text(obj), index: e.text(args[0]) })),
	"*.localeCompare": ({ obj, args, e, say }) => D(say.text.compare({ value: e.text(obj), other: e.text(args[0]) })),
	"*.then": ({ obj, args, e, say }) => {
		const o = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		if (!fn || !isFn(fn)) return null;
		const body = lambdaNoun({ e, fn, say, eachAlias: false });
		if (!body) return null;
		return D(say.promise.then({ value: o.t, item: itemName({ e, fn, say }), result: body.t }), [...o.kids, ...body.kids]);
	},
	"*.catch": ({ obj, args, e, say, stmt }) => {
		const fn = args[0] && unwrap(args[0]);
		if (!fn || !isFn(fn)) return null;
		const u = unwrap(obj);
		const o = stmt && u.type === "CallExpression" ? e.call(u, true) : e.noun(obj);
		if (fn.body.type === "BlockStatement" && !fn.body.body.length) return D(say.promise.ignoreFailure({ value: o.t, stmt }), o.kids);
		const body = stmt ? null : lambdaNoun({ e, fn, say, eachAlias: false });
		if (body) return D(say.promise.catch({ value: o.t, fallback: body.t }), [...o.kids, ...body.kids]);
		return block(say.promise.catchBlock({ value: o.t }), [...o.kids, ...lambdaBlock(e, fn).kids]);
	},
	"*.finally": ({ obj, args, e, say }) => {
		const o = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		if (!fn || !isFn(fn)) return null;
		const ex = e.lambdaExpr(fn);
		if (ex && unwrap(ex).type === "CallExpression") {
			const act = e.call(unwrap(ex), true);
			return D(say.promise.finally({ value: o.t, action: act.t }), [...o.kids, ...act.kids]);
		}
		return block(say.promise.finallyBlock({ value: o.t }), [...o.kids, ...lambdaBlock(e, fn).kids]);
	},
	"*.match": ({ obj, args, e, say }) => {
		const re = unwrap(args[0]);
		if (args.length !== 1 || !re) return null;
		return D(say.text.match({ value: e.text(obj), pattern: e.text(re), all: !!re.regex?.flags?.includes("g") }));
	},
	"*.matchAll": ({ obj, args, e, say }) => (args.length === 1 ? D(say.text.matchAll({ value: e.text(obj), pattern: e.text(args[0]) })) : null),
	"*.preventDefault": ({ obj, args, e, say }) => (args.length ? null : D(say.event.preventDefault({ event: e.text(obj) }))),
	"*.stopPropagation": ({ obj, args, e, say }) => (args.length ? null : D(say.event.stopPropagation({ event: e.text(obj) }))),
	"Date.UTC": ({ args, e, say }) => D(say.date.utc({ parts: e.g.list(args.map((a: N) => e.text(a))) })),
	BigInt: ({ args, e, say }) => (args.length === 1 ? D(say.bigint({ value: e.text(args[0]) })) : null),
	"AbortSignal.timeout": ({ args, e, say }) => D(say.timeoutSignal({ ms: e.text(args[0]) })),
	"Bun.sleep": ({ args, e, say, stmt }) => D((stmt ? say.wait : say.pause)({ ms: e.text(args[0]) })),
	clearTimeout: ({ args, e, say }) => (args.length === 1 ? D(say.clearTimer({ timer: e.text(args[0]) })) : null),
	clearInterval: ({ args, e, say }) => (args.length === 1 ? D(say.clearTimer({ timer: e.text(args[0]) })) : null),
	setInterval: ({ args, e, say, stmt }) => {
		const fn = args[0] && unwrap(args[0]);
		if (!fn || !isFn(fn) || !args[1]) return null;
		return block(say.setInterval({ ms: e.text(args[1]), stmt }), lambdaBlock(e, fn).kids);
	},
	"Promise.race": ({ args, e, say, stmt }) => {
		const a = unwrap(args[0]);
		if (a?.type !== "ArrayExpression") return null;
		const items = a.elements.map((el: N) => (unwrap(el).type === "CallExpression" ? e.call(unwrap(el), true) : e.noun(el)));
		return block(
			say.promise.race({ stmt }),
			items.flatMap((i: Doc) => e.bullet(i)),
		);
	},
	"new Promise": ({ args, e, say, stmt }) => {
		const ms = sleepMs(e, args[0]);
		return ms ? D((stmt ? say.wait : say.pause)({ ms: e.text(ms) })) : D(say.collection.promise);
	},
	"JSON.stringify": ({ args, e, say }) => D(say.json.stringify({ value: e.text(args[0]) })),
	"JSON.parse": ({ args, e, say }) => D(say.json.parse({ value: e.text(args[0]) })),
	"Math.max": ({ args, e, say }) => D(say.math.max(extremes(e, args))),
	"Math.min": ({ args, e, say }) => D(say.math.min(extremes(e, args))),
	"*.write": ({ obj, args, e, say }) => {
		const o = unwrap(obj);
		const stream = o.type === "MemberExpression" && !o.computed && unwrap(o.object).name === "process" ? o.property.name : null;
		if ((stream !== "stdout" && stream !== "stderr") || args.length !== 1) return null;
		return D(say.print({ value: e.text(args[0]), errors: stream === "stderr" }));
	},
	...Object.fromEntries(
		DATE_PARTS.flatMap((part) =>
			[false, true].map((utc) => [
				`*.get${utc ? "UTC" : ""}${part}`,
				(({ obj, args, e, say }) => (args.length ? null : D(say.date.part({ value: e.text(obj), part, utc })))) as CallRule<StdPhrases>,
			]),
		),
	),
	"Math.round": ({ args, e, say }) => D(say.math.round({ value: e.text(args[0]) })),
	"Math.floor": ({ args, e, say }) => D(say.math.floor({ value: e.text(args[0]) })),
	"Math.ceil": ({ args, e, say }) => D(say.math.ceil({ value: e.text(args[0]) })),
	"Math.abs": ({ args, e, say }) => D(say.math.abs({ value: e.text(args[0]) })),
	"Math.random": ({ say }) => D(say.math.random),
	"Date.now": ({ say }) => D(say.date.now),
	"process.exit": ({ args, e, say }) => D(say.exit({ code: args[0] ? e.text(args[0]) : null })),
	Number: ({ args, e, say }) => D(say.number.asNumber({ value: e.text(args[0]) })),
	parseInt: ({ args, e, say }) => D(say.number.asWholeNumber({ value: e.text(args[0]) })),
	parseFloat: ({ args, e, say }) => D(say.number.asNumber({ value: e.text(args[0]) })),
	String: ({ args, e, say }) => D(say.text.asText({ value: e.text(args[0]) })),
	Boolean: ({ args, e, say }) => {
		const c = e.cond(args[0]);
		return D(say.whether({ cond: c.t }), c.kids);
	},
	structuredClone: ({ args, e, say }) => D(say.deepCopy({ value: e.text(args[0]) })),
	"Promise.resolve": ({ args, e, say }) => (args[0] ? e.noun(args[0]) : D(say.nothing)),
	"Promise.all": ({ args, e, stmt, say }) => parallel({ e, say, arg: args[0], stmt, settled: false }),
	"Promise.allSettled": ({ args, e, stmt, say }) => parallel({ e, say, arg: args[0], stmt, settled: true }),
	setTimeout: ({ args, e, say, stmt }) => {
		const fn = args[0] && unwrap(args[0]);
		if (!fn || !isFn(fn)) return null;
		return block(say.setTimeout({ ms: args[1] ? e.text(args[1]) : "0", stmt }), lambdaBlock(e, fn).kids);
	},
	"*.throwIfAborted": ({ obj, args, e, say }) => (args.length ? null : D(say.throwIfAborted({ signal: e.text(obj) }))),
	"*.log": ({ obj, args, e, say }) => logRule({ e, obj, args, phrase: say.log.log, plainLog: true }),
	"*.info": ({ obj, args, e, say }) => logRule({ e, obj, args, phrase: say.log.log, plainLog: true }),
	"*.debug": ({ obj, args, e, say }) => logRule({ e, obj, args, phrase: say.log.debug }),
	"*.warn": ({ obj, args, e, say }) => logRule({ e, obj, args, phrase: say.log.warn }),
	"*.error": ({ obj, args, e, say }) => logRule({ e, obj, args, phrase: say.log.error }),
};

/** `new Promise((r) => setTimeout(r, ms))` -> the `ms` node; null for any other promise. */
function sleepMs(e: Engine, arg: N): N | null {
	const fn = arg && unwrap(arg);
	if (!fn || !isFn(fn)) return null;
	const resolve = e.paramName(fn.params[0]);
	const ex = e.lambdaExpr(fn) ?? (fn.body.body?.length === 1 && fn.body.body[0].type === "ExpressionStatement" ? fn.body.body[0].expression : null);
	const call = ex && unwrap(ex);
	if (call?.type !== "CallExpression" || unwrap(call.callee).name !== "setTimeout" || call.arguments.length !== 2) return null;
	const cb = unwrap(call.arguments[0]);
	const resolves = cb.type === "Identifier" ? cb.name === resolve : isFn(cb) && unwrap(e.lambdaExpr(cb))?.callee?.name === resolve;
	return resolves ? call.arguments[1] : null;
}

/** `plainLog`: a lone argument of any kind is the logged message ("log usage"), not a detail. */
/** `Math.max(a, b)` / `Math.max(...xs)`: the values, and whether there are more than two of them. */
function extremes(e: Engine, args: N[]): { values: string; many: boolean } {
	const spread = args.length === 1 && unwrap(args[0]).type === "SpreadElement" ? unwrap(args[0]).argument : null;
	if (spread) return { values: e.text(spread), many: true };
	return { values: e.g.list(args.map((a: N) => e.text(a))), many: args.length > 2 };
}

function logRule({
	e,
	obj,
	args,
	phrase,
	plainLog = false,
}: {
	e: Engine;
	obj: N;
	args: N[];
	phrase: StdPhrases["log"]["log"];
	plainLog?: boolean;
}): Doc | null {
	const o = unwrap(obj);
	const name = o.type === "Identifier" ? o.name : o.type === "MemberExpression" && !o.computed ? o.property.name : "";
	if (!/log|console/i.test(name)) return null;
	const isText = (a: N): boolean => {
		const u = unwrap(a);
		if ((u.type === "Literal" && typeof u.value === "string") || u.type === "TemplateLiteral") return true;
		const key = u.type === "CallExpression" ? e.ruleKeyOf(unwrap(u.callee)) : null;
		return !!key && /^chalk(\.|$)/.test(key) && u.arguments.length === 1 && isText(u.arguments[0]);
	};
	const msgIdx = plainLog && args.length === 1 ? 0 : args.findIndex(isText);
	const others = args.filter((_, i) => i !== msgIdx);
	return D(
		phrase({
			message: msgIdx >= 0 ? e.text(args[msgIdx]) : null,
			details: others.length ? e.g.list(e.argPairs(others).map((p) => (p.key ? mk("v", e.lex.humanize(p.key), p.key) : p.text.t))) : null,
		}),
	);
}

function parallel({ e, say, arg, stmt, settled }: { e: Engine; say: StdPhrases; arg: N; stmt: boolean; settled: boolean }): Doc {
	const a = unwrap(arg);
	if (a?.type === "ArrayExpression") {
		const items = a.elements.map((el: N) => (unwrap(el).type === "CallExpression" ? e.call(unwrap(el), true) : e.noun(el)));
		return block(
			say.parallel.list({ stmt, settled }),
			items.flatMap((i: Doc) => e.bullet(i)),
		);
	}
	if (a?.type === "CallExpression" && unwrap(a.callee).property?.name === "map" && isFn(a.arguments[0])) {
		const fn = unwrap(a.arguments[0]);
		const list = e.noun(unwrap(a.callee).object);
		const item = e.isDestructured(fn) ? say.item : itemName({ e, fn, say });
		const ex = e.lambdaExpr(fn);
		const steps = ex ? e.body({ type: "ExpressionStatement", expression: ex, start: ex.start, end: ex.end }, 0) : e.body(fn.body, 0);
		return block(say.parallel.each({ item, list: list.t, stmt, settled }), [...list.kids, ...steps]);
	}
	return D(say.parallel.other({ value: e.text(arg), stmt, settled }));
}
