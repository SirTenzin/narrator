import { D, type Doc, mk } from "@narrate/core";
import { type Engine, type N, unwrap } from "../engine";
import type { CallRule } from "../plugin";
import { block, isFn, itemName, lambdaBlock, lambdaNoun } from "./lambdas";
import type { StdPhrases } from "./phrases";

type Calls = Record<string, CallRule<StdPhrases>>;

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
	"*.catch": ({ obj, args, e, say }) => {
		const o = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		if (!fn || !isFn(fn)) return null;
		const body = lambdaNoun({ e, fn, say, eachAlias: false });
		if (body) return D(say.promise.catch({ value: o.t, fallback: body.t }), [...o.kids, ...body.kids]);
		return block(say.promise.catchBlock({ value: o.t }), [...o.kids, ...lambdaBlock(e, fn).kids]);
	},
	"JSON.stringify": ({ args, e, say }) => D(say.json.stringify({ value: e.text(args[0]) })),
	"JSON.parse": ({ args, e, say }) => D(say.json.parse({ value: e.text(args[0]) })),
	"Math.max": ({ args, e, say }) => D(say.math.max({ values: e.g.list(args.map((a: N) => e.text(a))) })),
	"Math.min": ({ args, e, say }) => D(say.math.min({ values: e.g.list(args.map((a: N) => e.text(a))) })),
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
	setTimeout: ({ args, e, say }) => {
		const fn = args[0] && unwrap(args[0]);
		if (!fn || !isFn(fn)) return null;
		return block(say.setTimeout({ ms: args[1] ? e.text(args[1]) : "0" }), lambdaBlock(e, fn).kids);
	},
	"*.log": ({ obj, args, e, say }) => logRule({ e, obj, args, phrase: say.log.log }),
	"*.info": ({ obj, args, e, say }) => logRule({ e, obj, args, phrase: say.log.log }),
	"*.debug": ({ obj, args, e, say }) => logRule({ e, obj, args, phrase: say.log.debug }),
	"*.warn": ({ obj, args, e, say }) => logRule({ e, obj, args, phrase: say.log.warn }),
	"*.error": ({ obj, args, e, say }) => logRule({ e, obj, args, phrase: say.log.error }),
};

function logRule({ e, obj, args, phrase }: { e: Engine; obj: N; args: N[]; phrase: StdPhrases["log"]["log"] }): Doc | null {
	const o = unwrap(obj);
	const name = o.type === "Identifier" ? o.name : o.type === "MemberExpression" && !o.computed ? o.property.name : "";
	if (!/log|console/i.test(name)) return null;
	const msgIdx = args.findIndex((a) => {
		const u = unwrap(a);
		return (u.type === "Literal" && typeof u.value === "string") || u.type === "TemplateLiteral";
	});
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
		const steps = ex
			? [{ d: 0, text: unwrap(ex).type === "CallExpression" ? e.call(unwrap(ex), true).t : e.text(ex), start: -1, end: -1, kind: "stmt" as const }]
			: e.body(fn.body, 0);
		return block(say.parallel.each({ item, list: list.t, stmt, settled }), [...list.kids, ...steps]);
	}
	return D(say.parallel.other({ value: e.text(arg), stmt, settled }));
}
