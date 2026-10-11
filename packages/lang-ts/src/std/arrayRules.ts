import { D, type Doc, mk, plain } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "../engine";
import type { CallRule } from "../plugin";
import { block, isFn, itemName, lambdaBlock, lambdaCond, lambdaNoun, pluckedListProp, pluckedProp, propPlural } from "./lambdas";
import type { StdPhrases } from "./phrases";

type Calls = Record<string, CallRule<StdPhrases>>;

const isEmptyObject = (n: N) => unwrap(n)?.type === "ObjectExpression" && !unwrap(n).properties.length;
/** Whether a rendered noun opens with the engine's object-literal phrasing, which reads badly after "each turned into". */
const readsAsObject = (e: Engine, d: Doc) => plain(d.t).startsWith(plain(e.objectFromItems([]).t).trimEnd());

export const arrayRules: Calls = {
	"*.map": ({ obj, args, e, say }) => {
		const list = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		if (!fn) return null;
		if (!isFn(fn)) return D(say.map.passedThrough({ list: list.t, fn: e.text(fn) }), list.kids);
		const prop = pluckedProp(e, fn);
		if (prop) return D(say.map.pluck({ props: propPlural(e, prop), list: list.t }), list.kids);
		const body = lambdaNoun({ e, fn, say, eachAlias: true });
		const item = itemName({ e, fn, say });
		if (body && !body.kids.length && !readsAsObject(e, body)) {
			if (plain(body.t).endsWith(plain(say.each({ item })))) return D(say.map.eachIn({ value: body.t, list: list.t }), list.kids);
			if (plain(body.t).includes(plain(say.each({ item: "" })))) return D(say.map.forEach({ value: body.t, item, list: list.t }), list.kids);
			return D(say.map.eachInto({ list: list.t, value: body.t }), [...list.kids, ...body.kids]);
		}
		if (body) return D(say.map.withEachInto({ list: list.t, item, value: body.t }), [...list.kids, ...body.kids]);
		return block(say.map.withEachIntoBlock({ list: list.t, item }), [...list.kids, ...lambdaBlock(e, fn).kids]);
	},
	"*.flatMap": ({ obj, args, e, say }) => {
		const list = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		if (!fn || !isFn(fn)) return null;
		const prop = pluckedListProp(e, fn);
		if (prop) return D(say.flatMap.pluck({ props: propPlural(e, prop), list: list.t }), list.kids);
		const body = lambdaNoun({ e, fn, say, eachAlias: true });
		const item = itemName({ e, fn, say });
		if (body && !body.kids.length && plain(body.t).endsWith(plain(say.each({ item }))))
			return D(say.flatMap.eachIn({ value: body.t, list: list.t }), list.kids);
		if (body && !body.kids.length) return D(say.flatMap.forEach({ value: body.t, item, list: list.t }), list.kids);
		if (body) return D(say.flatMap.into({ item, list: list.t, value: body.t }), [...list.kids, ...body.kids]);
		return block(say.flatMap.intoBlock({ item, list: list.t }), [...list.kids, ...lambdaBlock(e, fn).kids]);
	},
	"*.filter": ({ obj, args, e, say }) => {
		const list = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		if (!fn) return null;
		if (fn.type === "Identifier" && fn.name === "Boolean") return D(say.filter.dropEmpty({ list: list.t }), list.kids);
		if (!isFn(fn)) return D(say.filter.passing({ list: list.t, fn: e.text(fn) }), list.kids);
		const c = lambdaCond(e, fn);
		const keep = c && e.readsWhose(fn, c) ? say.filter.whose : say.filter.where;
		if (c) return D(keep({ list: list.t, cond: c.t }), [...list.kids, ...c.kids]);
		return block(say.filter.checkBlock({ list: list.t, items: e.g.plural(itemName({ e, fn, say })) }), [...list.kids, ...lambdaBlock(e, fn).kids]);
	},
	"*.find": ({ obj, args, e, say }) => {
		const list = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		if (!fn || !isFn(fn)) return null;
		const c = lambdaCond(e, fn);
		const item = itemName({ e, fn, say });
		if (c && e.readsWhose(fn, c)) return D(say.find.whose({ list: list.t, cond: c.t }), [...list.kids, ...c.kids]);
		if (c) return D(say.find.firstWhere({ item, list: list.t, cond: c.t }), [...list.kids, ...c.kids]);
		return block(say.find.firstCheckBlock({ item, list: list.t }), [...list.kids, ...lambdaBlock(e, fn).kids]);
	},
	"*.findLast": ({ obj, args, e, say }) => {
		const list = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		const c = fn && isFn(fn) ? lambdaCond(e, fn) : null;
		if (!c) return null;
		return D(say.find.lastWhere({ item: itemName({ e, fn, say }), list: list.t, cond: c.t }), [...list.kids, ...c.kids]);
	},
	"*.findIndex": ({ obj, args, e, say }) => {
		const list = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		const c = fn && isFn(fn) ? lambdaCond(e, fn) : null;
		if (!c) return null;
		return D(say.find.indexWhere({ item: itemName({ e, fn, say }), list: list.t, cond: c.t }), [...list.kids, ...c.kids]);
	},
	"*.some": ({ obj, args, e, say }) => whether(say, someEvery({ e, say, obj, args, neg: false, kind: "some" })),
	"*.every": ({ obj, args, e, say }) => whether(say, someEvery({ e, say, obj, args, neg: false, kind: "every" })),
	"*.includes": ({ obj, args, e, say }) => whether(say, includes({ e, say, obj, args, neg: false })),
	"*.reduce": ({ obj, args, e, say }) => {
		const list = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		const init = args[1];
		if (!fn || !isFn(fn)) return null;
		const ex = e.lambdaExpr(fn);
		const acc = e.paramName(fn.params[0]);
		const item = e.paramName(fn.params[1]);
		if (ex && acc && item) {
			const u = unwrap(ex);
			if (u.type === "BinaryExpression" && u.operator === "+" && unwrap(u.left).name === acc) {
				const term = e.withAlias(
					{ params: [fn.params[1]] },
					(x) => say.each({ item: e.ref(x) }),
					() => e.noun(u.right),
				);
				const r = unwrap(u.right);
				const prop = r.type === "MemberExpression" && !r.computed && unwrap(r.object).name === item ? r.property.name : null;
				const total = prop
					? D(say.reduce.totalProp({ prop: e.prop(prop), list: list.t }), list.kids)
					: r.type === "Identifier" && r.name === item
						? D(say.reduce.sum({ list: list.t }), list.kids)
						: D(say.reduce.total({ value: term.t, list: list.t }), [...list.kids, ...term.kids]);
				const u0 = unwrap(init);
				if (!init || (u0.type === "Literal" && (u0.value === 0 || u0.value === ""))) return total;
				const start = e.noun(init);
				return D(say.reduce.plusStart({ start: start.t, total: total.t }), [...total.kids, ...start.kids]);
			}
		}
		const start = init ? e.noun(init) : D(say.reduce.firstItem);
		const steps = ex ? e.bullet(D(say.reduce.step({ value: e.text(ex) }))) : e.body(fn.body, 0);
		return block(say.reduce.block({ list: list.t, start: start.t, item: item ? e.ref(item) : say.item, acc: acc ? e.ref(acc) : "" }), [
			...list.kids,
			...start.kids,
			...steps,
		]);
	},
	"*.sort": ({ obj, args, e, say }) => sortRule({ e, say, obj, args }),
	"*.toSorted": ({ obj, args, e, say }) => sortRule({ e, say, obj, args }),
	"*.join": ({ obj, args, e, say }) => {
		const list = e.noun(obj);
		return D(args[0] ? say.join.with({ list: list.t, sep: e.text(args[0]) }) : say.join.commas({ list: list.t }), list.kids);
	},
	"*.slice": ({ obj, args, e, say }) => {
		const list = e.noun(obj);
		const [a, b] = args.map((x: N) => unwrap(x));
		if (!a) return D(say.slice.copy({ list: list.t }), list.kids);
		if (a.type === "Literal" && a.value === 0 && b) return D(say.slice.first({ count: e.text(b), list: list.t }), list.kids);
		if (a.type === "UnaryExpression" && a.operator === "-" && !b) return D(say.slice.last({ count: e.text(a.argument), list: list.t }), list.kids);
		if (!b) return D(say.slice.from({ list: list.t, start: e.text(a) }), list.kids);
		return D(say.slice.range({ list: list.t, start: e.text(a), end: e.text(b) }), list.kids);
	},
	"*.at": ({ obj, args, e, say }) => {
		const list = e.noun(obj);
		const a = unwrap(args[0]);
		if (a?.type === "UnaryExpression" && a.operator === "-" && a.argument.value === 1) return D(say.at.last({ list: list.t }), list.kids);
		if (a?.type === "Literal" && a.value === 0) return D(say.at.first({ list: list.t }), list.kids);
		return null;
	},
	"*.concat": ({ obj, args, e, say }) => {
		const list = e.noun(obj);
		const rest = args.map((a: N) => e.noun(a));
		return D(say.concat({ list: list.t, rest: e.g.list(rest.map((r: Doc) => r.t)) }), [...list.kids, ...rest.flatMap((r: Doc) => r.kids)]);
	},
	"*.push": ({ obj, args, e, say }) => {
		if (!args.length) return null;
		const list = e.noun(obj);
		if (args.length === 1 && unwrap(args[0]).type === "SpreadElement") {
			const x = e.noun(unwrap(args[0]).argument);
			return D(say.push.everything({ source: x.t, list: list.t }), [...x.kids, ...list.kids]);
		}
		const items = args.map((a: N) => e.noun(a));
		const joined = e.g.list(items.map((i: Doc) => i.t));
		if (items.some((i: Doc) => i.kids.length) || plain(joined).length > 80) {
			if (items.length === 1) return block(say.push.add({ values: items[0]!.t.replace(/:$/, ""), list: list.t }), items[0]!.kids);
			return block(
				say.push.addThese({ list: list.t }),
				items.flatMap((i: Doc) => e.bullet(i)),
			);
		}
		return D(say.push.add({ values: joined, list: list.t }), list.kids);
	},
	"*.unshift": ({ obj, args, e, say }) => D(say.unshift({ values: e.g.list(args.map((a: N) => e.text(a))), list: e.text(obj) })),
	"*.pop": ({ obj, e, say }) => D(say.pop({ list: e.text(obj) })),
	"*.shift": ({ obj, e, say }) => D(say.shift({ list: e.text(obj) })),
	"*.indexOf": ({ obj, args, e, say }) => D(say.indexOf({ value: e.text(args[0]), list: e.text(obj) })),
	"*.keys": ({ obj, args, e, say }) => (unwrap(obj).name === "Object" ? D(say.object.keys({ value: e.text(args[0]) })) : null),
	"*.values": ({ obj, args, e, say }) => (unwrap(obj).name === "Object" ? D(say.object.values({ value: e.text(args[0]) })) : null),
	"*.entries": ({ obj, args, e, say }) => (unwrap(obj).name === "Object" ? D(say.object.entries({ value: e.text(args[0]) })) : null),
	"Object.fromEntries": ({ args, e, say }) => {
		const a = e.noun(args[0]);
		return D(say.object.fromEntries({ value: a.t }), a.kids);
	},
	"Object.assign": ({ args, e, say, stmt }) => {
		const [t, ...rest] = args.map((a: N) => e.noun(a));
		const sources = e.g.list(rest.map((r) => r.t));
		if (isEmptyObject(args[0])) return D(say.object.merged({ sources }));
		return D((stmt ? say.object.copyInto : say.object.copiedInto)({ sources, target: t!.t }));
	},
	"Object.freeze": ({ args, e }) => e.noun(args[0]),
	"Array.from": ({ args, e, say }) => {
		const src = e.noun(args[0]);
		const fn = args[1] && unwrap(args[1]);
		const a = unwrap(args[0]);
		const length = a?.type === "ObjectExpression" && a.properties.length === 1 ? a.properties.find((p: N) => p.key?.name === "length")?.value : null;
		if (length && fn && isFn(fn) && e.paramName(fn.params[1]) && unwrap(e.lambdaExpr(fn))?.name === e.paramName(fn.params[1]))
			return D(say.arrayFrom.range({ count: e.text(length) }));
		if (length && fn && isFn(fn)) {
			const value = e.lambdaExpr(fn) ? e.noun(e.lambdaExpr(fn)) : null;
			if (value) return D(say.arrayFrom.sizedEach({ count: e.text(length), value: value.t }), value.kids);
		}
		if (length) return D(say.arrayFrom.sized({ count: e.text(length) }));
		if (fn && isFn(fn)) {
			const body = lambdaNoun({ e, fn, say, eachAlias: true });
			if (body) return D(say.arrayFrom.mapped({ source: src.t, value: body.t }), [...src.kids, ...body.kids]);
		}
		return D(say.arrayFrom.list({ source: src.t }), src.kids);
	},
	"Array.isArray": ({ args, e, say }) => D(say.whether({ cond: say.isList({ value: e.text(args[0]), neg: false }) })),
	"*.has": ({ obj, args, e, say }) => whether(say, isIn({ e, say, obj, args, neg: false })),
	"*.get": ({ obj, args, e, say }) => {
		if (args.length !== 1 || e.isAmbient(obj) || unwrap(args[0]).type === "ObjectExpression") return null;
		const o = e.noun(obj);
		const k = e.noun(args[0]);
		return D(say.collection.get({ owner: o.t, ownerPossessive: e.g.possessive(o.t), key: k.t }), [...o.kids, ...k.kids]);
	},
	"*.set": ({ obj, args, e, say }) => {
		if (args.length !== 2) return null;
		const o = e.noun(obj);
		const k = e.noun(args[0]);
		const v = e.noun(args[1]);
		return D(say.collection.set({ value: v.t, key: k.t, owner: o.t }), [...o.kids, ...k.kids, ...v.kids]);
	},
	"*.add": ({ obj, args, e, say }) => (args.length === 1 ? D(say.collection.add({ value: e.text(args[0]), owner: e.text(obj) })) : null),
	"*.delete": ({ obj, args, e, say }) => (args.length === 1 ? D(say.collection.remove({ value: e.text(args[0]), owner: e.text(obj) })) : null),
	"*.clear": ({ obj, e, say }) => D(say.collection.clear({ owner: e.text(obj) })),
	"new Set": ({ args, e, say }) => D(args[0] ? say.collection.uniqueOf({ value: e.text(args[0]) }) : say.collection.emptySet),
	"new Map": ({ args, e, say }) => D(args[0] ? say.collection.lookupFrom({ value: e.text(args[0]) }) : say.collection.emptyLookup),
	"new WeakMap": ({ say }) => D(say.collection.emptyLookup),
	"new Date": ({ args, e, say }) => D(args.length ? say.date.from({ value: e.text(args[0]) }) : say.date.now),
};

const whether = (say: StdPhrases, c: Doc | null) => (c ? D(say.whether({ cond: c.t }), c.kids) : null);

type CondArgs = { e: Engine; say: StdPhrases; obj: N; args: N[]; neg: boolean };

export function someEvery({ e, say, obj, args, neg, kind }: CondArgs & { kind: "some" | "every" }): Doc | null {
	const list = e.noun(obj);
	const fn = args[0] && unwrap(args[0]);
	if (!fn) return null;
	const phrases = say[kind];
	if (!isFn(fn)) return D(phrases.passes({ list: list.t, fn: e.noun(fn).t, neg }), list.kids);
	const item = itemName({ e, fn, say });
	const c = lambdaCond(e, fn);
	if (!c) return block(phrases.checkBlock({ item, list: list.t, neg }), [...list.kids, ...lambdaBlock(e, fn).kids]);
	if (e.readsWhose(fn, c)) return D(phrases.whose({ list: list.t, cond: c.t, neg }), [...list.kids, ...c.kids]);
	return D(phrases.where({ item, list: list.t, cond: c.t, neg, article: e.g.article(plain(item)) }), [...list.kids, ...c.kids]);
}

export function includes({ e, say, obj, args, neg }: CondArgs): Doc {
	const list = e.noun(obj);
	const x = e.noun(args[0]);
	const o = unwrap(obj);
	if (o.type === "ArrayExpression" && o.elements.length <= 5) {
		const options = e.g.list(
			o.elements.map((el: N) => e.text(el)),
			"or",
		);
		return D(say.isOneOf({ value: x.t, options, neg }), x.kids);
	}
	return D(say.isIn({ value: x.t, list: list.t, neg }), [...list.kids, ...x.kids]);
}

export function isIn({ e, say, obj, args, neg }: CondArgs): Doc {
	const list = e.noun(obj);
	const x = e.noun(args[0]);
	return D(say.isIn({ value: x.t, list: list.t, neg }), [...list.kids, ...x.kids]);
}

const SELF = "value";

function sortRule({ e, say, obj, args }: { e: Engine; say: StdPhrases; obj: N; args: N[] }): Doc {
	const list = e.noun(obj);
	const fn = args[0] && unwrap(args[0]);
	if (!fn) return D(say.sort.sorted({ list: list.t }), list.kids);
	if (!isFn(fn)) return D(say.sort.using({ list: list.t, fn: e.text(fn) }), list.kids);
	const ex = e.lambdaExpr(fn);
	const a = e.paramName(fn.params[0]);
	const b = e.paramName(fn.params[1]);
	if (ex && a && b) {
		const u = unwrap(ex);
		const keyOf = (side: N, who: string) => {
			const s = unwrap(side);
			if (s.type === "Identifier" && s.name === who) return SELF;
			if (s.type === "MemberExpression" && !s.computed && unwrap(s.object).name === who) return s.property.name as string;
			return null;
		};
		const sorted = (phrase: StdPhrases["sort"]["smallestFirst"], k: string) =>
			D(phrase({ list: list.t, key: k === SELF ? mk("v", say.sort.value, SELF) : e.prop(k) }), list.kids);
		if (u.type === "BinaryExpression" && u.operator === "-") {
			const ka = keyOf(u.left, a);
			if (ka && ka === keyOf(u.right, b)) return sorted(say.sort.smallestFirst, ka);
			const ra = keyOf(u.left, b);
			if (ra && ra === keyOf(u.right, a)) return sorted(say.sort.largestFirst, ra);
		}
		if (u.type === "CallExpression" && unwrap(u.callee).property?.name === "localeCompare") {
			const k1 = keyOf(unwrap(u.callee).object, a);
			if (k1 && k1 === keyOf(u.arguments[0], b)) return sorted(say.sort.alphabetical, k1);
			const r1 = keyOf(unwrap(u.callee).object, b);
			if (r1) return sorted(say.sort.reverseAlphabetical, r1);
		}
	}
	return block(say.sort.byRule({ list: list.t }), [
		...list.kids,
		...(ex ? e.bullet(D(say.sort.compare({ a: `${a}`, b: `${b}`, expr: e.text(ex) }))) : e.body(fn.body, 0)),
	]);
}
