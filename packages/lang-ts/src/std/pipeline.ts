import { capFirst, D, type Doc, mk } from "@narrate/core";
import { type Engine, type N, unwrap } from "../engine";
import type { CallRule } from "../plugin";
import { block, isFn, itemName, lambdaBlock, lambdaCond, lambdaNoun, pluckedListProp, pluckedProp, propPlural } from "./lambdas";
import type { StdPhrases } from "./phrases";

const PIPE_OPS = new Set([
	"map",
	"flatMap",
	"filter",
	"find",
	"findLast",
	"some",
	"every",
	"sort",
	"toSorted",
	"slice",
	"join",
	"reduce",
	"at",
	"concat",
	"reverse",
	"toReversed",
]);

/** Stands in for the list each stage works on, so a call rule can phrase that stage. */
const THEM = { type: "Identifier", name: "\u0000them" };

type Step = { m: string; args: N[]; node: N };

/** `[...new Set(x)]` -> x */
function dedupeSource(n: N): N | null {
	const u = unwrap(n);
	if (u?.type !== "ArrayExpression" || u.elements.length !== 1 || u.elements[0]?.type !== "SpreadElement") return null;
	const inner = unwrap(u.elements[0].argument);
	return inner.type === "NewExpression" && inner.callee.name === "Set" ? inner.arguments[0] : null;
}

function pipelineParts(node: N): { root: N; steps: Step[] } {
	const steps: Step[] = [];
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

/** One pipeline stage, phrased relative to "them": the list so far. */
function stageDoc({ e, say, step: { m, args, node } }: { e: Engine; say: StdPhrases; step: Step }): Doc {
	const pipe = say.pipe;
	const fn = args[0] && unwrap(args[0]);
	const lam = fn && isFn(fn);
	const whose = lam && e.isDestructured(fn);
	switch (m) {
		case "filter": {
			if (fn?.type === "Identifier" && fn.name === "Boolean") return D(pipe.dropEmpty);
			const c = lam ? lambdaCond(e, fn) : null;
			if (c) return D((whose ? pipe.keepWhose : pipe.keepWhere)({ cond: c.t }), c.kids);
			if (lam) return block(pipe.keepCheckBlock({ items: e.g.plural(itemName({ e, fn, say })) }), lambdaBlock(e, fn).kids);
			return D(pipe.keepPassing({ fn: e.text(fn) }));
		}
		case "map":
		case "flatMap": {
			const flat = m === "flatMap";
			if (!lam) return D(pipe.passThrough({ fn: e.text(fn), flat }));
			const prop = flat ? pluckedListProp(e, fn) : pluckedProp(e, fn);
			if (prop) return D(flat ? pipe.takeAll({ props: propPlural(e, prop) }) : pipe.takeEach({ prop: e.prop(prop) }));
			const body = lambdaNoun({ e, fn, say, eachAlias: false });
			const item = e.isDestructured(fn) ? pipe.destructuredItem({ names: e.g.list(fn.params.flatMap((p: N) => e.patternNames(p))) }) : itemName({ e, fn, say });
			if (body) return D(pipe.turnEach({ item, value: body.t, flat }), body.kids);
			return block(pipe.turnEachBlock({ item, flat }), lambdaBlock(e, fn).kids);
		}
		case "find":
		case "findLast": {
			const last = m === "findLast";
			const c = lam ? lambdaCond(e, fn) : null;
			if (c) return D((whose ? pipe.takeWhose : pipe.takeWhere)({ cond: c.t, last }), c.kids);
			if (lam) return block(pipe.takeCheckBlock({ last }), lambdaBlock(e, fn).kids);
			return D(pipe.takePassing({ fn: e.text(fn), last }));
		}
		case "some":
		case "every": {
			const some = m === "some";
			const c = lam ? lambdaCond(e, fn) : null;
			if (c) {
				const cond = c.t.replace(new RegExp(`^${itemName({ e, fn, say })}\\b`), "");
				return D(pipe.checkHas({ cond, some }).replace(/ {2,}/g, " "), c.kids);
			}
			if (lam) return block(pipe.checkPassesBlock({ some }), lambdaBlock(e, fn).kids);
			return D(pipe.checkPasses({ fn: e.text(fn), some }));
		}
		case "dedupe":
			return D(pipe.dedupe);
		case "join":
			return D(args[0] ? pipe.joinWith({ sep: e.text(args[0]) }) : pipe.joinCommas);
		case "reverse":
		case "toReversed":
			return D(pipe.reverse);
		default: {
			const inner = e.withAlias(
				{ params: [THEM] },
				(p) => mk("v", pipe.them, p),
				() => e.call({ ...node, callee: { ...unwrap(node.callee), object: THEM } }, false),
			);
			return D(inner.t, inner.kids);
		}
	}
}

/** `xs.filter(...).map(...)` -> the source, then numbered steps. */
function pipelineRule({ node, e, say }: { node: N; e: Engine; say: StdPhrases }): Doc | null {
	const { root, steps } = pipelineParts(node);
	if (steps.length < 2) return null;
	const r = e.noun(root);
	const stages = steps.map((step, i) => {
		const d = stageDoc({ e, say, step });
		const t = d.t.replace(/:$/, "") + (d.kids.length ? ":" : "");
		return [
			{
				d: 0,
				text: say.pipe.stage({ n: String(i + 1), step: capFirst(t) }),
				start: step.node.start,
				end: step.node.end,
				kind: "bullet" as const,
			},
			...d.kids.map((k) => ({ ...k, d: k.d + 1 })),
		];
	});
	return block(say.pipe.steps({ source: r.t }), [...r.kids, ...stages.flat()]);
}

/** Array rules that read a multi-step chain as a numbered pipeline before falling back to the single-call phrasing. */
export const withPipelines = (rules: Record<string, CallRule<StdPhrases>>): Record<string, CallRule<StdPhrases>> =>
	Object.fromEntries(
		Object.entries(rules).map(([k, rule]) => {
			const m = k.replace(/^\*\./, "");
			if (!k.startsWith("*.") || !PIPE_OPS.has(m)) return [k, rule];
			const piped: CallRule<StdPhrases> = (x) => pipelineRule(x) ?? rule(x);
			return [k, piped];
		}),
	);
