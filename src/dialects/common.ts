import { mk, plain } from "../markup";
import { D, type Dialect, type Doc, type Engine, type N, listJoin, unwrap } from "../engine";
import { humanize, isPluralWord, possessive, singular, splitWords } from "../names";

const isFn = (n: N) => n && (unwrap(n).type === "ArrowFunctionExpression" || unwrap(n).type === "FunctionExpression");

/** Name used for a lambda's item, e.g. `(price) => …` -> "price". */
const itemName = (e: Engine, fn: N) => {
	const p = fn.params[0];
	const name = e.paramName(p);
	return name ? e.ref(name) : "item";
};

/** Renders a lambda body as a condition, with destructured params reading as "its x". */
function lambdaCond(e: Engine, fn: N, neg = false): Doc | null {
	const ex = e.lambdaExpr(fn);
	if (!ex) return null;
	return e.cond(ex, neg);
}

function lambdaNoun(e: Engine, fn: N, eachAlias: boolean): Doc | null {
	const ex = e.lambdaExpr(fn);
	if (!ex) return null;
	const p = e.paramName(fn.params[0]);
	if (eachAlias && p && e.countUses(ex, p) === 1) return e.withAlias(fn, (x) => `each ${e.ref(x)}`, () => e.noun(ex));
	return e.noun(ex);
}

/** `(x) => x.foo` or `({ foo }) => foo` -> "foo". */
function pluckedProp(e: Engine, fn: N): string | null {
	const ex = e.lambdaExpr(fn);
	if (!ex) return null;
	const u = unwrap(ex);
	const p = e.paramName(fn.params[0]);
	if (p && u.type === "MemberExpression" && !u.computed && unwrap(u.object).type === "Identifier" && unwrap(u.object).name === p) return u.property.name;
	if (fn.params[0]?.type === "ObjectPattern" && u.type === "Identifier" && fn.params[0].properties.length === 1) return u.name;
	return null;
}

/** `x => x.items ?? []` -> "items". */
function pluckedListProp(e: Engine, fn: N): string | null {
	const ex = e.lambdaExpr(fn);
	if (!ex) return null;
	const u = unwrap(ex);
	if (u.type === "LogicalExpression" && u.operator === "??" && unwrap(u.right).type === "ArrayExpression" && !unwrap(u.right).elements.length)
		return pluckedProp(e, { ...fn, body: u.left, params: fn.params });
	return pluckedProp(e, fn);
}

const pluralize = (w: string) => {
	if (isPluralWord(w)) return w;
	if (/IDs?$/.test(w) || w.endsWith("ID")) return `${w}s`;
	if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
	if (/(s|x|ch|sh)$/.test(w)) return `${w}es`;
	return `${w}s`;
};

const propPlural = (prop: string) => mk("v", pluralize(humanize(prop)), prop);

/** "the IDs of customer products" */
function plucked(e: Engine, coll: Doc, prop: string, flat = false): Doc {
	return D(`${flat ? "all " : ""}the ${propPlural(prop)} ${flat ? "across" : "of"} ${coll.t}`, coll.kids);
}

function lambdaBlock(e: Engine, fn: N): Doc {
	const lines = e.body(fn.body, 0);
	return D("", lines);
}

const arrayRules: Dialect["calls"] = {
	"*.map": ({ obj, args, e }) => {
		const coll = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		if (!fn) return null;
		if (!isFn(fn)) return D(`${coll.t}, each passed through ${e.text(fn)}`, coll.kids);
		const prop = pluckedProp(e, fn);
		if (prop) return plucked(e, coll, prop);
		const body = lambdaNoun(e, fn, true);
		if (body && !body.kids.length && !plain(body.t).startsWith("an object with")) {
			const each = `each ${plain(itemName(e, fn))}`;
			if (plain(body.t).endsWith(each)) return D(`${body.t} in ${coll.t}`, coll.kids);
			if (plain(body.t).includes("each ")) return D(`${body.t}, for each ${itemName(e, fn)} in ${coll.t}`, coll.kids);
			return D(`${coll.t}, each turned into ${body.t}`, [...coll.kids, ...body.kids]);
		}
		if (body) return D(`${coll.t}, with each ${itemName(e, fn)} turned into ${body.t}`, [...coll.kids, ...body.kids]);
		return D(`${coll.t}, with each ${itemName(e, fn)} turned into the result of:`, [...coll.kids, ...lambdaBlock(e, fn).kids]);
	},
	"*.flatMap": ({ obj, args, e }) => {
		const coll = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		if (!fn || !isFn(fn)) return null;
		const prop = pluckedListProp(e, fn);
		if (prop) return plucked(e, coll, prop, true);
		const body = lambdaNoun(e, fn, true);
		const each = `each ${plain(itemName(e, fn))}`;
		if (body && !body.kids.length && plain(body.t).endsWith(each)) return D(`${body.t} in ${coll.t}, combined into one list`, coll.kids);
		if (body && !body.kids.length) return D(`everything in ${body.t}, for each ${itemName(e, fn)} in ${coll.t}`, coll.kids);
		if (body) return D(`all results, combined, of turning each ${itemName(e, fn)} in ${coll.t} into ${body.t}`, [...coll.kids, ...body.kids]);
		return D(`all results, combined, of turning each ${itemName(e, fn)} in ${coll.t} into:`, [...coll.kids, ...lambdaBlock(e, fn).kids]);
	},
	"*.filter": ({ obj, args, e }) => {
		const coll = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		if (!fn) return null;
		if (fn.type === "Identifier" && fn.name === "Boolean") return D(`${coll.t}, minus any empty values`, coll.kids);
		if (!isFn(fn)) return D(`the ${coll.t} that pass ${e.text(fn)}`, coll.kids);
		const c = lambdaCond(e, fn);
		const who = e.isDestructured(fn) ? "whose" : "where";
		if (c) return D(`${coll.t}, keeping only those ${who} ${c.t}`, [...coll.kids, ...c.kids]);
		return D(`${coll.t}, keeping only the ${itemName(e, fn)}s that pass this check:`, [...coll.kids, ...lambdaBlock(e, fn).kids]);
	},
	"*.find": ({ obj, args, e }) => {
		const coll = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		if (!fn || !isFn(fn)) return null;
		const c = lambdaCond(e, fn);
		if (c && e.isDestructured(fn)) return D(`the one in ${coll.t} whose ${c.t}`, [...coll.kids, ...c.kids]);
		if (c) return D(`the first ${itemName(e, fn)} in ${coll.t} where ${c.t}`, [...coll.kids, ...c.kids]);
		return D(`the first ${itemName(e, fn)} in ${coll.t} that passes this check:`, [...coll.kids, ...lambdaBlock(e, fn).kids]);
	},
	"*.findLast": ({ obj, args, e }) => {
		const coll = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		const c = fn && isFn(fn) ? lambdaCond(e, fn) : null;
		if (!c) return null;
		return D(`the last ${itemName(e, fn)} in ${coll.t} where ${c.t}`, [...coll.kids, ...c.kids]);
	},
	"*.findIndex": ({ obj, args, e }) => {
		const coll = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		const c = fn && isFn(fn) ? lambdaCond(e, fn) : null;
		if (!c) return null;
		return D(`the position of the first ${itemName(e, fn)} in ${coll.t} where ${c.t} (or -1)`, [...coll.kids, ...c.kids]);
	},
	"*.some": ({ obj, args, e }) => {
		const c = someEvery(e, obj, args, false, "some");
		return c ? D(`whether ${c.t}`, c.kids) : null;
	},
	"*.every": ({ obj, args, e }) => {
		const c = someEvery(e, obj, args, false, "every");
		return c ? D(`whether ${c.t}`, c.kids) : null;
	},
	"*.includes": ({ obj, args, e, node }) => {
		const c = includes(e, obj, args, false);
		void node;
		return D(`whether ${c.t}`, c.kids);
	},
	"*.reduce": ({ obj, args, e }) => {
		const coll = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		const init = args[1];
		if (!fn || !isFn(fn)) return null;
		const ex = e.lambdaExpr(fn);
		const acc = e.paramName(fn.params[0]);
		const item = e.paramName(fn.params[1]);
		if (ex && acc && item) {
			const u = unwrap(ex);
			if (u.type === "BinaryExpression" && u.operator === "+" && unwrap(u.left).name === acc) {
				const term = e.withAlias({ params: [fn.params[1]] }, (x) => `each ${e.ref(x)}`, () => e.noun(u.right));
				const prop = unwrap(u.right).type === "MemberExpression" && unwrap(unwrap(u.right).object).name === item ? unwrap(u.right).property.name : null;
				if (prop) return D(`the total ${mk("v", humanize(prop), prop)} across ${coll.t}`, coll.kids);
				return D(`the total of ${term.t} across ${coll.t}`, [...coll.kids, ...term.kids]);
			}
		}
		const start = init ? e.noun(init) : D("the first item");
		const steps = ex ? [{ d: 0, text: `• the running total becomes ${e.text(ex)}`, start: -1, end: -1, kind: "bullet" as const }] : e.body(fn.body, 0);
		return D(`${coll.t} combined into one value, starting from ${start.t}; for each ${item ? e.ref(item) : "item"} (with the running total ${acc ? e.ref(acc) : ""}):`, [...coll.kids, ...start.kids, ...steps]);
	},
	"*.sort": ({ obj, args, e }) => sortRule(e, obj, args),
	"*.toSorted": ({ obj, args, e }) => sortRule(e, obj, args),
	"*.join": ({ obj, args, e }) => {
		const coll = e.noun(obj);
		const sep = args[0] ? e.text(args[0]) : null;
		return D(`${coll.t} joined ${sep ? `with ${sep}` : "with commas"}`, coll.kids);
	},
	"*.slice": ({ obj, args, e }) => {
		const coll = e.noun(obj);
		const [a, b] = args.map((x: N) => unwrap(x));
		if (!a) return D(`a copy of ${coll.t}`, coll.kids);
		if (a.type === "Literal" && a.value === 0 && b) return D(`the first ${e.text(b)} of ${coll.t}`, coll.kids);
		if (a.type === "UnaryExpression" && a.operator === "-" && !b) return D(`the last ${e.text(a.argument)} of ${coll.t}`, coll.kids);
		if (!b) return D(`${coll.t} from position ${e.text(a)} onward`, coll.kids);
		return D(`${coll.t} from position ${e.text(a)} up to ${e.text(b)}`, coll.kids);
	},
	"*.at": ({ obj, args, e }) => {
		const coll = e.noun(obj);
		const a = unwrap(args[0]);
		if (a?.type === "UnaryExpression" && a.operator === "-" && a.argument.value === 1) return D(`the last of ${coll.t}`, coll.kids);
		if (a?.type === "Literal" && a.value === 0) return D(`the first of ${coll.t}`, coll.kids);
		return null;
	},
	"*.concat": ({ obj, args, e }) => {
		const coll = e.noun(obj);
		const rest = args.map((a: N) => e.noun(a));
		return D(`${coll.t} followed by ${listJoin(rest.map((r: Doc) => r.t))}`, [...coll.kids, ...rest.flatMap((r: Doc) => r.kids)]);
	},
	"*.push": ({ obj, args, e }) => {
		const coll = e.noun(obj);
		if (args.length === 1 && unwrap(args[0]).type === "SpreadElement") {
			const x = e.noun(unwrap(args[0]).argument);
			return D(`add everything in ${x.t} to ${coll.t}`, [...x.kids, ...coll.kids]);
		}
		const items = args.map((a: N) => e.noun(a));
		const joined = listJoin(items.map((i: Doc) => i.t));
		if (items.some((i: Doc) => i.kids.length) || plain(joined).length > 80) {
			if (items.length === 1) return D(`add ${items[0]!.t.replace(/:$/, "")} to ${coll.t}:`, items[0]!.kids);
			return D(`add these to ${coll.t}:`, items.flatMap((i: Doc) => e.bullet(i)));
		}
		return D(`add ${joined} to ${coll.t}`, coll.kids);
	},
	"*.unshift": ({ obj, args, e }) => D(`put ${listJoin(args.map((a: N) => e.text(a)))} at the start of ${e.text(obj)}`),
	"*.pop": ({ obj, e }) => D(`take the last item off ${e.text(obj)}`),
	"*.shift": ({ obj, e }) => D(`take the first item off ${e.text(obj)}`),
	"*.indexOf": ({ obj, args, e }) => D(`the position of ${e.text(args[0])} in ${e.text(obj)} (or -1)`),
	"*.keys": ({ obj, args, e }) => (unwrap(obj).name === "Object" ? D(`the keys of ${e.text(args[0])}`) : null),
	"*.values": ({ obj, args, e }) => (unwrap(obj).name === "Object" ? D(`the values in ${e.text(args[0])}`) : null),
	"*.entries": ({ obj, args, e }) => (unwrap(obj).name === "Object" ? D(`the key/value pairs of ${e.text(args[0])}`) : null),
	"Object.fromEntries": ({ args, e }) => {
		const a = e.noun(args[0]);
		return D(`an object built from ${a.t}`, a.kids);
	},
	"Object.assign": ({ args, e, stmt }) => {
		const [t, ...rest] = args.map((a: N) => e.noun(a));
		if (plain(t!.t) === "an empty object") return D(`${listJoin(rest.map((r) => r.t))} merged together`);
		return D(`${stmt ? "copy" : "the result of copying"} everything from ${listJoin(rest.map((r) => r.t))} into ${t!.t}`);
	},
	"Object.freeze": ({ args, e }) => e.noun(args[0]),
	"Array.from": ({ args, e }) => {
		const src = e.noun(args[0]);
		const fn = args[1] && unwrap(args[1]);
		if (fn && isFn(fn)) {
			const body = lambdaNoun(e, fn, true);
			if (body) return D(`${src.t} as a list, each turned into ${body.t}`, [...src.kids, ...body.kids]);
		}
		const a = unwrap(args[0]);
		if (a?.type === "ObjectExpression") return D(`a list of ${e.noun(a.properties.find((p: N) => p.key?.name === "length")?.value).t} items`);
		return D(`${src.t} as a list`, src.kids);
	},
	"Array.isArray": ({ args, e }) => D(`whether ${e.text(args[0])} is a list`),
	"*.has": ({ obj, args, e }) => {
		const c = hasRule(e, obj, args, false);
		return D(`whether ${c.t}`, c.kids);
	},
	"*.get": ({ obj, args, e }) => {
		if (args.length !== 1 || e.isAmbient(obj) || unwrap(args[0]).type === "ObjectExpression") return null;
		const o = e.noun(obj);
		const k = e.noun(args[0]);
		return D(`${possessive(o.t)} entry for ${k.t}`, [...o.kids, ...k.kids]);
	},
	"*.set": ({ obj, args, e }) => {
		if (args.length !== 2) return null;
		const o = e.noun(obj);
		const k = e.noun(args[0]);
		const v = e.noun(args[1]);
		return D(`record ${v.t} under ${k.t} in ${o.t}`, [...o.kids, ...k.kids, ...v.kids]);
	},
	"*.add": ({ obj, args, e }) => (args.length === 1 ? D(`add ${e.text(args[0])} to ${e.text(obj)}`) : null),
	"*.delete": ({ obj, args, e }) => (args.length === 1 ? D(`remove ${e.text(args[0])} from ${e.text(obj)}`) : null),
	"*.clear": ({ obj, e }) => D(`empty out ${e.text(obj)}`),
	"new Set": ({ args, e }) => (args[0] ? D(`the unique values of ${e.text(args[0])}`) : D("an empty set")),
	"new Map": ({ args, e }) => (args[0] ? D(`a lookup table built from ${e.text(args[0])}`) : D("an empty lookup table")),
	"new WeakMap": () => D("an empty lookup table"),
	"new Date": ({ args, e }) => (args.length ? D(`${e.text(args[0])} as a date`) : D("the current time")),
	"new Promise": () => D("a promise"),
};

function someEvery(e: Engine, obj: N, args: N[], neg: boolean, kind: "some" | "every"): Doc | null {
	const coll = e.noun(obj);
	const fn = args[0] && unwrap(args[0]);
	if (!fn) return null;
	if (!isFn(fn)) {
		const f = e.noun(fn);
		return D(`${kind === "some" ? (neg ? "none of" : "at least one of") : neg ? "not all of" : "all of"} ${coll.t} ${kind === "some" && !neg ? "passes" : "pass"} ${f.t}`, coll.kids);
	}
	const item = itemName(e, fn);
	const destr = e.isDestructured(fn);
	if (kind === "some") {
		const c = lambdaCond(e, fn);
		if (!c) return D(`${neg ? "no" : "at least one"} ${item} in ${coll.t} passes this check:`, [...coll.kids, ...lambdaBlock(e, fn).kids]);
		if (destr) return D(`${coll.t} ${neg ? "has no item" : "has an item"} whose ${c.t}`, [...coll.kids, ...c.kids]);
		return D(`${coll.t} ${neg ? "has no" : `has ${/^[aeiou]/i.test(plain(item)) ? "an" : "a"}`} ${item} where ${c.t}`, [...coll.kids, ...c.kids]);
	}
	const c = lambdaCond(e, fn);
	if (!c) return D(`${neg ? "not every" : "every"} ${item} in ${coll.t} passes this check:`, [...coll.kids, ...lambdaBlock(e, fn).kids]);
	if (destr) return D(`${neg ? "not every one" : "every one"} of ${coll.t} has ${c.t}`, [...coll.kids, ...c.kids]);
	return D(`${neg ? "not every" : "every"} ${item} in ${coll.t} satisfies: ${c.t}`, [...coll.kids, ...c.kids]);
}

function includes(e: Engine, obj: N, args: N[], neg: boolean): Doc {
	const coll = e.noun(obj);
	const x = e.noun(args[0]);
	const o = unwrap(obj);
	if (o.type === "ArrayExpression" && o.elements.length <= 5) {
		const opts = o.elements.map((el: N) => e.text(el));
		return D(`${x.t} ${neg ? "is none of" : "is one of"} ${listJoin(opts, "or")}`, x.kids);
	}
	return D(`${x.t} ${neg ? "is not in" : "is in"} ${coll.t}`, [...coll.kids, ...x.kids]);
}

function hasRule(e: Engine, obj: N, args: N[], neg: boolean): Doc {
	const coll = e.noun(obj);
	const x = e.noun(args[0]);
	return D(`${x.t} ${neg ? "is not in" : "is in"} ${coll.t}`, [...coll.kids, ...x.kids]);
}

function sortRule(e: Engine, obj: N, args: N[]): Doc {
	const coll = e.noun(obj);
	const fn = args[0] && unwrap(args[0]);
	if (!fn) return D(`${coll.t}, sorted`, coll.kids);
	if (!isFn(fn)) return D(`${coll.t}, sorted using ${e.text(fn)}`, coll.kids);
	const ex = e.lambdaExpr(fn);
	const a = e.paramName(fn.params[0]);
	const b = e.paramName(fn.params[1]);
	if (ex && a && b) {
		const u = unwrap(ex);
		const key = (side: N, who: string) => {
			const s = unwrap(side);
			if (s.type === "Identifier" && s.name === who) return "value";
			if (s.type === "MemberExpression" && !s.computed && unwrap(s.object).name === who) return s.property.name;
			if (s.type === "CallExpression") return null;
			return null;
		};
		if (u.type === "BinaryExpression" && u.operator === "-") {
			const ka = key(u.left, a);
			const kb = key(u.right, b);
			if (ka && ka === kb) return D(`${coll.t}, sorted by ${mk("v", humanize(ka), ka)} (smallest first)`, coll.kids);
			const ra = key(u.left, b);
			const rb = key(u.right, a);
			if (ra && ra === rb) return D(`${coll.t}, sorted by ${mk("v", humanize(ra), ra)} (largest first)`, coll.kids);
		}
		if (u.type === "CallExpression" && unwrap(u.callee).property?.name === "localeCompare") {
			const k1 = key(unwrap(u.callee).object, a);
			const k2 = key(u.arguments[0], b);
			if (k1 && k1 === k2) return D(`${coll.t}, sorted alphabetically by ${mk("v", humanize(k1), k1)}`, coll.kids);
			const r1 = key(unwrap(u.callee).object, b);
			if (r1) return D(`${coll.t}, sorted reverse-alphabetically by ${mk("v", humanize(r1), r1)}`, coll.kids);
		}
	}
	return D(`${coll.t}, sorted by this rule:`, [...coll.kids, ...(ex ? [{ d: 0, text: `• compare ${a} and ${b} by ${e.text(ex)}`, start: -1, end: -1, kind: "bullet" as const }] : e.body(fn.body, 0))]);
}

const valueRules: Dialect["calls"] = {
	"*.toString": ({ obj, e }) => D(`${e.text(obj)} as text`),
	"*.toLowerCase": ({ obj, e }) => D(`${e.text(obj)} in lowercase`),
	"*.toUpperCase": ({ obj, e }) => D(`${e.text(obj)} in uppercase`),
	"*.trim": ({ obj, e }) => D(`${e.text(obj)} without surrounding spaces`),
	"*.split": ({ obj, args, e }) => D(`${e.text(obj)} split on ${e.text(args[0])}`),
	"*.replace": ({ obj, args, e }) => D(`${e.text(obj)} with ${e.text(args[0])} replaced by ${e.text(args[1])}`),
	"*.replaceAll": ({ obj, args, e }) => D(`${e.text(obj)} with every ${e.text(args[0])} replaced by ${e.text(args[1])}`),
	"*.toFixed": ({ obj, args, e }) => D(`${e.text(obj)} rounded to ${e.text(args[0])} decimal places`),
	"*.padStart": ({ obj, args, e }) => D(`${e.text(obj)} padded to ${e.text(args[0])} characters`),
	"*.getTime": ({ obj, e }) => D(`${e.text(obj)} as a timestamp`),
	"*.valueOf": ({ obj, e }) => e.noun(obj),
	"*.toISOString": ({ obj, e }) => D(`${e.text(obj)} as an ISO date string`),
	"*.charAt": ({ obj, args, e }) => D(`the character at ${e.text(args[0])} in ${e.text(obj)}`),
	"*.localeCompare": ({ obj, args, e }) => D(`how ${e.text(obj)} compares alphabetically to ${e.text(args[0])}`),
	"*.then": ({ obj, args, e }) => {
		const o = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		if (fn && isFn(fn)) {
			const body = lambdaNoun(e, fn, false);
			if (body) return D(`${o.t}, then (with the result as ${itemName(e, fn)}) ${body.t}`, [...o.kids, ...body.kids]);
		}
		return null;
	},
	"*.catch": ({ obj, args, e }) => {
		const o = e.noun(obj);
		const fn = args[0] && unwrap(args[0]);
		if (fn && isFn(fn)) {
			const body = lambdaNoun(e, fn, false);
			if (body) return D(`${o.t} (and if that fails, ${body.t} instead)`, [...o.kids, ...body.kids]);
			return D(`${o.t}, and if that fails:`, [...o.kids, ...lambdaBlock(e, fn).kids]);
		}
		return null;
	},
	"JSON.stringify": ({ args, e }) => D(`${e.text(args[0])} as JSON`),
	"JSON.parse": ({ args, e }) => D(`${e.text(args[0])} parsed from JSON`),
	"Math.max": ({ args, e }) => D(`the larger of ${listJoin(args.map((a: N) => e.text(a)))}`),
	"Math.min": ({ args, e }) => D(`the smaller of ${listJoin(args.map((a: N) => e.text(a)))}`),
	"Math.round": ({ args, e }) => D(`${e.text(args[0])}, rounded`),
	"Math.floor": ({ args, e }) => D(`${e.text(args[0])}, rounded down`),
	"Math.ceil": ({ args, e }) => D(`${e.text(args[0])}, rounded up`),
	"Math.abs": ({ args, e }) => D(`the absolute value of ${e.text(args[0])}`),
	"Math.random": () => D("a random number"),
	"Date.now": () => D("the current time"),
	"process.exit": ({ args, e }) => D(`exit the process${args[0] ? ` with code ${e.text(args[0])}` : ""}`),
	Number: ({ args, e }) => D(`${e.text(args[0])} as a number`),
	parseInt: ({ args, e }) => D(`${e.text(args[0])} as a whole number`),
	parseFloat: ({ args, e }) => D(`${e.text(args[0])} as a number`),
	String: ({ args, e }) => D(`${e.text(args[0])} as text`),
	Boolean: ({ args, e }) => {
		const c = e.cond(args[0]);
		return D(`whether ${c.t}`, c.kids);
	},
	structuredClone: ({ args, e }) => D(`a deep copy of ${e.text(args[0])}`),
	"Promise.resolve": ({ args, e }) => (args[0] ? e.noun(args[0]) : D("nothing")),
	"Promise.all": ({ args, e, stmt }) => parallel(e, args[0], stmt, false),
	"Promise.allSettled": ({ args, e, stmt }) => parallel(e, args[0], stmt, true),
	setTimeout: ({ args, e }) => {
		const fn = args[0] && unwrap(args[0]);
		const ms = args[1] ? e.text(args[1]) : "0";
		if (fn && isFn(fn)) return D(`after ${ms}ms, do the following:`, lambdaBlock(e, fn).kids);
		return null;
	},
	"*.log": ({ obj, args, e }) => logRule(e, obj, args, "log"),
	"*.info": ({ obj, args, e }) => logRule(e, obj, args, "log"),
	"*.debug": ({ obj, args, e }) => logRule(e, obj, args, "debug log"),
	"*.warn": ({ obj, args, e }) => logRule(e, obj, args, "warn"),
	"*.error": ({ obj, args, e }) => logRule(e, obj, args, "log an error"),
};

function logRule(e: Engine, obj: N, args: N[], verb: string): Doc | null {
	const o = unwrap(obj);
	const name = o.type === "Identifier" ? o.name : o.type === "MemberExpression" && !o.computed ? o.property.name : "";
	if (!/log|console/i.test(name)) return null;
	const msgIdx = args.findIndex((a) => {
		const u = unwrap(a);
		return (u.type === "Literal" && typeof u.value === "string") || u.type === "TemplateLiteral";
	});
	const msg = msgIdx >= 0 ? e.text(args[msgIdx]) : null;
	const others = args.filter((_, i) => i !== msgIdx);
	const extra = others.length ? ` (with ${listJoin(e.argPairs(others).map((p) => (p.key ? mk("v", humanize(p.key), p.key) : p.text.t)))})` : "";
	return D(`${verb}${msg ? ` ${msg}` : ""}${extra}`);
}

function parallel(e: Engine, arg: N, stmt: boolean, settled: boolean): Doc {
	const a = unwrap(arg);
	const tail = settled ? " (carrying on even if some fail)" : "";
	if (a?.type === "ArrayExpression") {
		const items = a.elements.map((el: N) => (unwrap(el).type === "CallExpression" ? e.call(unwrap(el), true) : e.noun(el)));
		return D(`${stmt ? "do" : "the results of doing"} these at the same time${tail}:`, items.flatMap((i: Doc) => e.bullet(i)));
	}
	if (a?.type === "CallExpression" && unwrap(a.callee).property?.name === "map" && isFn(a.arguments[0])) {
		const fn = unwrap(a.arguments[0]);
		const coll = e.noun(unwrap(a.callee).object);
		const item = e.isDestructured(fn) ? "item" : itemName(e, fn);
		const ex = e.lambdaExpr(fn);
		const steps = ex ? [{ d: 0, text: unwrap(ex).type === "CallExpression" ? e.call(unwrap(ex), true).t : e.text(ex), start: -1, end: -1, kind: "stmt" as const }] : e.body(fn.body, 0);
		return D(`for every ${item} in ${coll.t}, all at the same time${tail}${stmt ? "" : ", collecting the results"}:`, [...coll.kids, ...steps]);
	}
	return D(`${stmt ? "wait for all of" : "the results of"} ${e.text(arg)}${tail}`);
}

const styleOnly = ({ args, e }: { args: N[]; e: Engine }) => (args.length === 1 ? e.noun(args[0]) : null);

const conditionRules: Dialect["conditions"] = {
	"*.includes": ({ obj, args, e, neg }) => includes(e, obj, args, neg),
	"*.has": ({ obj, args, e, neg }) => hasRule(e, obj, args, neg),
	"*.some": ({ obj, args, e, neg }) => someEvery(e, obj, args, neg, "some"),
	"*.every": ({ obj, args, e, neg }) => someEvery(e, obj, args, neg, "every"),
	"*.startsWith": ({ obj, args, e, neg }) => D(`${e.text(obj)} ${neg ? "does not start" : "starts"} with ${e.text(args[0])}`),
	"*.endsWith": ({ obj, args, e, neg }) => D(`${e.text(obj)} ${neg ? "does not end" : "ends"} with ${e.text(args[0])}`),
	"*.test": ({ obj, args, e, neg }) => D(`${e.text(args[0])} ${neg ? "does not match" : "matches"} ${e.text(obj)}`),
	"Array.isArray": ({ args, e, neg }) => D(`${e.text(args[0])} is ${neg ? "not " : ""}a list`),
	"Number.isFinite": ({ args, e, neg }) => D(`${e.text(args[0])} is ${neg ? "not " : ""}a real number`),
	"Number.isNaN": ({ args, e, neg }) => D(`${e.text(args[0])} is ${neg ? "" : "not "}a valid number`),
	"Number.isInteger": ({ args, e, neg }) => D(`${e.text(args[0])} is ${neg ? "not " : ""}a whole number`),
	Boolean: ({ args, e, neg }) => e.cond(args[0], neg),
	"Object.keys": () => null,
};

/** Zod: `z.string().optional()` -> "optional text". */
export function zodText(e: Engine, n: N): string | null {
	const steps: { m: string; args: N[] }[] = [];
	let cur = unwrap(n);
	while (cur?.type === "CallExpression" && unwrap(cur.callee).type === "MemberExpression") {
		const c = unwrap(cur.callee);
		steps.unshift({ m: c.property.name, args: cur.arguments });
		cur = unwrap(c.object);
	}
	if (cur?.type !== "Identifier" || cur.name !== "z" || !steps.length) return null;
	const base = steps[0]!;
	const BASE: Record<string, string> = { string: "text", number: "a number", boolean: "true/false", date: "a date", any: "anything", unknown: "anything", null: "null", bigint: "a big number" };
	let t: string;
	if (BASE[base.m]) t = BASE[base.m]!;
	else if (base.m === "object" || base.m === "strictObject") {
		const o = unwrap(base.args[0]);
		const keys = o?.type === "ObjectExpression" ? o.properties.map((p: N) => (p.key ? mk("v", humanize(p.key.name ?? String(p.key.value)), p.key.name) : "…")) : [];
		t = `an object with ${listJoin(keys)}`;
	} else if (base.m === "array") t = `a list of ${zodText(e, base.args[0]) ?? e.text(base.args[0])}`;
	else if (base.m === "enum") t = `one of ${unwrap(base.args[0])?.type === "ArrayExpression" ? listJoin(unwrap(base.args[0]).elements.map((x: N) => e.text(x)), "or") : e.text(base.args[0])}`;
	else if (base.m === "literal") t = `exactly ${e.text(base.args[0])}`;
	else if (base.m === "union") t = `either ${unwrap(base.args[0])?.type === "ArrayExpression" ? listJoin(unwrap(base.args[0]).elements.map((x: N) => zodText(e, x) ?? e.text(x)), "or") : "…"}`;
	else if (base.m === "record") t = `a lookup of ${zodText(e, base.args[base.args.length - 1]) ?? "values"}`;
	else if (base.m === "nativeEnum") t = `one of the ${e.text(base.args[0])} values`;
	else return null;
	const mods: string[] = [];
	for (const s of steps.slice(1)) {
		if (s.m === "optional") mods.push("optional");
		else if (s.m === "nullable" || s.m === "nullish") mods.push("can be null");
		else if (s.m === "default") mods.push(`defaults to ${e.text(s.args[0])}`);
		else if (s.m === "min") mods.push(`at least ${e.text(s.args[0])}`);
		else if (s.m === "max") mods.push(`at most ${e.text(s.args[0])}`);
		else if (s.m === "int") mods.push("whole number");
		else if (s.m === "positive") mods.push("positive");
		else if (s.m === "nonnegative") mods.push("not negative");
		else if (s.m === "email") mods.push("an email");
		else if (s.m === "url") mods.push("a URL");
		else if (s.m === "uuid") mods.push("a UUID");
		else if (s.m === "extend") t += ` plus more fields`;
		else if (s.m === "refine" || s.m === "superRefine") mods.push("with extra checks");
		else if (s.m === "transform") mods.push("transformed");
		else if (s.m === "describe" || s.m === "meta" || s.m === "openapi") continue;
	}
	return `${t}${mods.length ? ` (${mods.join(", ")})` : ""}`;
}

const zodRule = ({ node, e }: { node: N; e: Engine }) => {
	const t = zodText(e, node);
	return t ? D(`a schema for ${t}`) : null;
};

const zodRules: Dialect["calls"] = Object.fromEntries(
	["z.object", "z.string", "z.number", "z.boolean", "z.array", "z.enum", "z.union", "z.literal", "z.record", "z.date", "z.any", "z.unknown", "z.nativeEnum", "z.strictObject", "*.optional", "*.nullable", "*.nullish", "*.default", "*.min", "*.max", "*.int", "*.positive", "*.nonnegative", "*.email", "*.url", "*.uuid", "*.describe", "*.meta", "*.openapi", "*.extend", "*.refine", "*.transform"].map((k) => [k, zodRule]),
);

/** bun:test / vitest / jest. */
function expectChain(e: Engine, node: N): Doc | null {
	const steps: { m: string; args: N[] }[] = [];
	let cur = unwrap(node);
	let neg = false;
	while (cur && (cur.type === "CallExpression" || cur.type === "MemberExpression")) {
		if (cur.type === "CallExpression") {
			const c = unwrap(cur.callee);
			if (c.type === "Identifier" && c.name === "expect") {
				const subject = e.noun(cur.arguments[0]);
				const last = steps[0];
				if (!last) return null;
				const arg = last.args[0] ? e.text(last.args[0]) : "";
				const not = neg ? " not" : "";
				const M: Record<string, string> = {
					toBe: `is${not} ${arg}`,
					toEqual: `${neg ? "does not equal" : "equals"} ${arg}`,
					toStrictEqual: `${neg ? "does not equal" : "equals"} ${arg}`,
					toMatchObject: `${neg ? "does not match" : "matches"} ${arg}`,
					toBeDefined: neg ? "is missing" : "is set",
					toBeUndefined: neg ? "is set" : "is missing",
					toBeNull: neg ? "is not null" : "is null",
					toBeTruthy: neg ? "is falsy" : "is truthy",
					toBeFalsy: neg ? "is truthy" : "is falsy",
					toHaveLength: `has${not} ${arg} item(s)`,
					toContain: `${neg ? "does not contain" : "contains"} ${arg}`,
					toThrow: neg ? "does not throw" : `throws${arg ? ` ${arg}` : ""}`,
					toBeGreaterThan: `is${not} more than ${arg}`,
					toBeLessThan: `is${not} less than ${arg}`,
					toBeGreaterThanOrEqual: `is${not} at least ${arg}`,
					toBeLessThanOrEqual: `is${not} at most ${arg}`,
					toBeCloseTo: `is${not} about ${arg}`,
					toHaveProperty: `has${not} a ${arg} property`,
					toBeInstanceOf: `is${not} a ${arg}`,
					toHaveBeenCalled: neg ? "was never called" : "was called",
					toHaveBeenCalledTimes: `was called ${arg} time(s)`,
					toHaveBeenCalledWith: `was called with ${arg}`,
				};
				const verb = M[last.m] ?? `${humanize(last.m)}${not} ${arg}`;
				return D(`check that ${subject.t} ${verb}`, subject.kids);
			}
			const m = c.type === "MemberExpression" ? c.property.name : null;
			if (!m) return null;
			steps.unshift({ m, args: cur.arguments });
			cur = unwrap(c.object);
			continue;
		}
		if (cur.property?.name === "not") neg = !neg;
		else if (cur.property?.name === "resolves" || cur.property?.name === "rejects") {
		} else return null;
		cur = unwrap(cur.object);
	}
	return null;
}

const testRules: Dialect["calls"] = {
	describe: ({ args, e }) => testBlock(e, "Test group", args),
	test: ({ args, e }) => testBlock(e, "Test", args),
	it: ({ args, e }) => testBlock(e, "Test", args),
	beforeAll: ({ args, e }) => testBlock(e, "Before all tests", [null, ...args]),
	beforeEach: ({ args, e }) => testBlock(e, "Before each test", [null, ...args]),
	afterAll: ({ args, e }) => testBlock(e, "After all tests", [null, ...args]),
	afterEach: ({ args, e }) => testBlock(e, "After each test", [null, ...args]),
	"*.toBe": ({ node, e }) => expectChain(e, node),
	"*.toEqual": ({ node, e }) => expectChain(e, node),
	"*.toStrictEqual": ({ node, e }) => expectChain(e, node),
	"*.toMatchObject": ({ node, e }) => expectChain(e, node),
	"*.toBeDefined": ({ node, e }) => expectChain(e, node),
	"*.toBeUndefined": ({ node, e }) => expectChain(e, node),
	"*.toBeNull": ({ node, e }) => expectChain(e, node),
	"*.toBeTruthy": ({ node, e }) => expectChain(e, node),
	"*.toBeFalsy": ({ node, e }) => expectChain(e, node),
	"*.toHaveLength": ({ node, e }) => expectChain(e, node),
	"*.toContain": ({ node, e }) => expectChain(e, node),
	"*.toThrow": ({ node, e }) => expectChain(e, node),
	"*.toBeGreaterThan": ({ node, e }) => expectChain(e, node),
	"*.toBeLessThan": ({ node, e }) => expectChain(e, node),
	"*.toBeGreaterThanOrEqual": ({ node, e }) => expectChain(e, node),
	"*.toBeLessThanOrEqual": ({ node, e }) => expectChain(e, node),
	"*.toBeCloseTo": ({ node, e }) => expectChain(e, node),
	"*.toHaveProperty": ({ node, e }) => expectChain(e, node),
	"*.toBeInstanceOf": ({ node, e }) => expectChain(e, node),
};

function testBlock(e: Engine, label: string, args: (N | null)[]): Doc | null {
	const [name, fn] = args;
	const f = fn && unwrap(fn);
	if (!f || !isFn(f)) return null;
	const title = name ? ` ${e.text(name)}` : "";
	const ex = f.body.type === "BlockStatement" ? null : f.body;
	const lines = ex ? [{ d: 0, text: e.text(ex), start: -1, end: -1, kind: "stmt" as const }] : e.body(f.body, 0);
	return D(`${label}${title}:`, lines);
}

const PIPE_OPS = new Set(["map", "flatMap", "filter", "find", "findLast", "some", "every", "sort", "toSorted", "slice", "join", "reduce", "at", "concat", "reverse", "toReversed"]);

/** `[...new Set(x)]` -> x */
function dedupeSource(n: N): N | null {
	const u = unwrap(n);
	if (u?.type !== "ArrayExpression" || u.elements.length !== 1 || u.elements[0]?.type !== "SpreadElement") return null;
	const inner = unwrap(u.elements[0].argument);
	return inner.type === "NewExpression" && inner.callee.name === "Set" ? inner.arguments[0] : null;
}

function pipelineParts(node: N): { root: N; steps: { m: string; args: N[]; node: N }[] } {
	const steps: { m: string; args: N[]; node: N }[] = [];
	let cur = unwrap(node);
	while (cur?.type === "CallExpression") {
		const c = unwrap(cur.callee);
		if (c.type !== "MemberExpression" || c.computed || !PIPE_OPS.has(c.property.name)) break;
		steps.unshift({ m: c.property.name, args: cur.arguments, node: cur });
		cur = unwrap(c.object);
		const set = dedupeSource(cur);
		if (set) {
			steps.unshift({ m: "dedupe", args: [], node: cur });
			cur = unwrap(set);
		}
	}
	return { root: cur, steps };
}

/** One pipeline stage, phrased relative to "the current list". */
function stageDoc(e: Engine, m: string, args: N[], node: N): Doc {
	const fn = args[0] && unwrap(args[0]);
	const lam = fn && isFn(fn);
	const who = lam && e.isDestructured(fn) ? "whose" : "where";
	switch (m) {
		case "filter": {
			if (fn?.type === "Identifier" && fn.name === "Boolean") return D("drop empty values");
			const c = lam ? lambdaCond(e, fn) : null;
			if (c) return D(`keep only those ${who} ${c.t}`, c.kids);
			if (lam) return D(`keep only the ${itemName(e, fn)}s that pass this check:`, lambdaBlock(e, fn).kids);
			return D(`keep only those that pass ${e.text(fn)}`);
		}
		case "map":
		case "flatMap": {
			const flat = m === "flatMap" ? ", and flatten the results into one list" : "";
			if (!lam) return D(`pass each one through ${e.text(fn)}${flat}`);
			const prop = m === "flatMap" ? pluckedListProp(e, fn) : pluckedProp(e, fn);
			if (prop) return D(m === "flatMap" ? `take all of their ${propPlural(prop)}` : `take each one's ${mk("v", humanize(prop), prop)}`);
			const body = lambdaNoun(e, fn, false);
			const item = e.isDestructured(fn) ? `item (${listJoin(fn.params.flatMap((p: N) => e.patternNames(p)))})` : itemName(e, fn);
			if (body) return D(`turn each ${item} into ${body.t}${flat}`, body.kids);
			return D(`turn each ${item} into the result of these steps${flat}:`, lambdaBlock(e, fn).kids);
		}
		case "find":
		case "findLast": {
			const c = lam ? lambdaCond(e, fn) : null;
			if (c) return D(`take the ${m === "find" ? "first" : "last"} one ${who} ${c.t}`, c.kids);
			return D(`take the ${m === "find" ? "first" : "last"} one that passes ${lam ? "this check:" : e.text(fn)}`, lam ? lambdaBlock(e, fn).kids : []);
		}
		case "some":
		case "every": {
			const c = lam ? lambdaCond(e, fn) : null;
			const q = m === "some" ? "any of them" : "all of them";
			if (c) return D(`check whether ${q} ${m === "some" ? "has" : "have"} ${c.t.replace(new RegExp(`^${itemName(e, fn)}\\b`), "")}`.replace(/  +/g, " "), c.kids);
			return D(`check whether ${q} pass${m === "some" ? "es" : ""} ${lam ? "this check:" : e.text(fn)}`, lam ? lambdaBlock(e, fn).kids : []);
		}
		case "dedupe":
			return D("remove duplicates");
		case "join":
			return D(`join them${args[0] ? ` with ${e.text(args[0])}` : " with commas"}`);
		case "reverse":
		case "toReversed":
			return D("reverse the order");
		default: {
			const inner = e.call({ ...node, callee: { ...unwrap(node.callee), object: { type: "Identifier", name: "\u0000them" } } }, false);
			return D(plain(inner.t).replace(/\u0000them|them/g, "them") === plain(inner.t) ? inner.t : inner.t, inner.kids);
		}
	}
}

function pipelineRule({ node, e }: { node: N; e: Engine }): Doc | null {
	const { root, steps } = pipelineParts(node);
	if (steps.length < 2) return null;
	const r = e.noun(root);
	const stages = steps.map((s, i) => {
		const d = stageDoc(e, s.m, s.args, s.node);
		const t = d.t.replace(/:$/, "") + (d.kids.length ? ":" : "");
		return [{ d: 0, text: `${i + 1}. ${t.charAt(0).toUpperCase()}${t.slice(1)}`, start: s.node.start, end: s.node.end, kind: "bullet" as const }, ...d.kids.map((k) => ({ ...k, d: k.d + 1 }))];
	});
	return D(`${r.t}, after these steps:`, [...r.kids, ...stages.flat()]);
}

const pipelinedArrayRules = Object.fromEntries(
	Object.entries(arrayRules!).map(([k, rule]) => {
		const m = k.replace(/^\*\./, "");
		if (!k.startsWith("*.") || !PIPE_OPS.has(m)) return [k, rule];
		return [k, (x: any) => pipelineRule(x) ?? rule(x)];
	}),
);

export const common: Dialect = {
	name: "common",
	ambient: ["ctx"],
	errors: /Error$/,
	constants: {
		"Number.MAX_SAFE_INTEGER": "the largest possible number",
		"Number.POSITIVE_INFINITY": "infinity",
		Infinity: "infinity",
		NaN: "not-a-number",
		"Number.EPSILON": "a tiny number",
	},
	calls: { ...pipelinedArrayRules, ...valueRules, ...zodRules, ...testRules, "chalk.*": styleOnly, chalk: styleOnly, cn: ({ args }) => (args.length ? D("some CSS classes") : null), clsx: () => D("some CSS classes") },
	conditions: conditionRules,
};

void singular;
void splitWords;
