import { D } from "@usenarrator/core";
import { type CallRule, type CondRule, definePlugin, type Engine, type StmtRule, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import {
	type Ctx,
	type FileState,
	isPascal,
	isServiceTag,
	type Mode,
	type Op,
	type OpTable,
	owns,
	pipeline,
	pipeStep,
	resetState,
	serviceName,
	type Version,
	yieldAction,
} from "./context";
import { en } from "./en";
import { normalize, YIELD_KEY } from "./normalize";
import { configOps } from "./ops/config";
import { dataConditions, dataOps } from "./ops/data";
import { effectOps } from "./ops/effect";
import { layerOps } from "./ops/layer";
import { matchPipeline } from "./ops/match";
import { observeOps } from "./ops/observe";
import { scheduleHow, scheduleOps } from "./ops/schedule";
import { schemaOps, schemaType } from "./ops/schema";
import { stateOps } from "./ops/state";
import { streamOps } from "./ops/stream";
import type { EffectPhrases } from "./phrases";
import { classStatement, effectFnDeclaration, useRule, yieldStatement } from "./statements";

export { en } from "./en";
export type { EffectPhrases } from "./phrases";

export type EffectOptions = {
	/** Pin the Effect major version for APIs whose meaning changed (`Effect.catch`, `Schema.Date`). Defaults to reading both. */
	version?: 3 | 4;
};

type Versioned = { shared?: OpTable; v3?: OpTable; v4?: OpTable; auto?: OpTable };

function opsFor(version: Version, groups: Versioned[]): OpTable {
	const out: OpTable = {};
	for (const g of groups) {
		Object.assign(out, g.shared);
		if (version !== 4) Object.assign(out, g.v3);
		if (version !== 3) Object.assign(out, g.v4);
		if (version === "auto") Object.assign(out, g.auto);
	}
	return out;
}

/** Effect (effect.website), v3 and v4: generators read as steps, pipes as numbered steps. */
export const effect = ({ version }: EffectOptions = {}): TsPlugin<EffectPhrases> => {
	const groups = [effectOps, { shared: scheduleOps }, { shared: schemaOps }, dataOps, streamOps, layerOps, stateOps, configOps, observeOps];
	const tables: Record<Version, OpTable> = { 3: opsFor(3, groups), 4: opsFor(4, groups), auto: opsFor("auto", groups) };
	const state: FileState = {
		program: null,
		importsEffect: false,
		fibers: new Set(),
		refs: new Set(),
		deferreds: new Set(),
		queues: new Set(),
		currentClass: null,
		effectNames: new Set(),
		foreignNames: new Set(),
		modules: new Set(),
	};
	/** A pinned version wins; otherwise the file's package decides, and both readings apply when it's unknown. */
	const versionOf = (e: Engine): Version => {
		if (version) return version;
		const major = e.libraryMajor("effect");
		return major === 3 || major === 4 ? major : "auto";
	};
	const ctx = (e: Engine, say: EffectPhrases): Ctx => {
		const v = versionOf(e);
		const c = { e, say, version: v, state, ops: tables[v] };
		resetState(c);
		return c;
	};

	const render = (c: Ctx, op: Op, node: any, args: any[], mode: Mode) => {
		if (op.kind === "make") return op.render(c, args, mode, node);
		if (op.kind === "curried") return op.render(c, args, null, mode);
		if (op.dataFirst(args)) {
			if (op.first) return op.first(c, args, mode);
			const s = op.render(c, args.slice(1));
			return s && pipeline(c, args[0], [s], mode);
		}
		const s = op.render(c, args);
		if (!s || mode === "act") return s;
		return D(c.say.pipe.stepFn({ step: s.t }), s.kids);
	};

	const calls: Record<string, CallRule<EffectPhrases>> = {};
	const keys = new Set([...Object.keys(tables[3]), ...Object.keys(tables[4]), ...Object.keys(tables.auto)]);
	for (const key of keys) {
		const owner = key.slice(0, key.indexOf("."));
		calls[key] = ({ node, args, e, stmt, say }) => {
			const c = ctx(e, say);
			const op = c.ops[key];
			return op && owns(c, owner) ? render(c, op, node, args, stmt ? "act" : "noun") : null;
		};
		// `Layer.succeed(Tag)(impl)`: the engine hands curried rules the outer call.
		if ([3, 4, "auto"].some((v) => tables[v as Version][key]?.kind === "curried"))
			calls[`${key}()`] = ({ node, args, e, stmt, say }) => {
				const c = ctx(e, say);
				const op = c.ops[key];
				return op?.kind === "curried" && owns(c, owner) ? op.render(c, unwrap(node.callee).arguments, args, stmt ? "act" : "noun") : null;
			};
	}

	/** `x.pipe(a, b)` and `pipe(x, a, b)`; only in files that import Effect, since `.pipe` is common elsewhere. */
	const pipeRule =
		(subjectOf: (obj: any, args: any[]) => any, stepsOf: (args: any[]) => any[]): CallRule<EffectPhrases> =>
		({ node, obj, args, e, stmt, say }) => {
			const c = ctx(e, say);
			if (!c.state.importsEffect) return null;
			const subject = subjectOf(obj, args);
			if (!subject) return null;
			const sched = scheduleHow(c, node);
			if (sched) return D(say.schedule.noun({ how: sched }));
			const schema = schemaType(c, node, true);
			if (schema) return D(say.schema.of({ type: schema }));
			const matched = matchPipeline(c, subject, stepsOf(args), stmt ? "act" : "noun");
			if (matched) return matched;
			return pipeline(
				c,
				subject,
				stepsOf(args).map((a) => pipeStep(c, a)),
				stmt ? "act" : "noun",
			);
		};
	calls["*.pipe"] = pipeRule(
		(obj) => obj,
		(args) => args,
	);
	calls.pipe = pipeRule(
		(_obj, args) => (args.length > 1 ? args[0] : null),
		(args) => args.slice(1),
	);
	const use: CallRule<EffectPhrases> = ({ obj, args, e, stmt, say }) => {
		const c = ctx(e, say);
		return c.state.importsEffect ? useRule(c, obj, args, stmt ? "act" : "noun") : null;
	};
	const schemaMethod: CallRule<EffectPhrases> = ({ node, e, say }) => {
		const c = ctx(e, say);
		const type = c.state.importsEffect ? schemaType(c, node, true) : null;
		return type ? D(say.schema.of({ type })) : null;
	};
	for (const m of ["check", "annotate", "annotations"]) calls[`*.${m}`] = schemaMethod;
	calls["*.use"] = use;
	calls["*.useSync"] = use;

	const conditions: Record<string, CondRule<EffectPhrases>> = {};
	const condTables: Record<Version, ReturnType<typeof dataConditions>> = { 3: dataConditions(3), 4: dataConditions(4), auto: dataConditions("auto") };
	for (const key of Object.keys(condTables.auto))
		conditions[key] = ({ args, e, neg, say }) => {
			const c = ctx(e, say);
			const pick = condTables[c.version][key];
			return pick && args[0] && owns(c, key.slice(0, key.indexOf("."))) ? pick(say)({ subject: e.noun(args[0]).t, neg }) : null;
		};

	calls[YIELD_KEY] = ({ args, e, stmt, say }) => {
		const c = ctx(e, say);
		const arg = unwrap(args[0]);
		if (!arg) return null;
		if (stmt) return yieldAction(c, arg);
		if (isServiceTag(arg) || isPascal(arg)) return D(say.yield.serviceValue({ service: serviceName(c, arg) }));
		const v = c.e.noun(arg);
		if (arg.type === "CallExpression" && e.applyRulesQuiet(arg)) return v;
		return D(say.yield.result({ effect: v.t }), v.kids);
	};
	conditions[YIELD_KEY] = ({ args, e, neg }) => (args[0] ? e.cond(args[0], neg) : null);

	const statement =
		(f: (c: Ctx, n: any, d: number) => boolean, gated: boolean): StmtRule<EffectPhrases> =>
		({ node, e, d, say }) => {
			const c = ctx(e, say);
			if (gated && !c.state.importsEffect) return false;
			return f(c, node, d);
		};

	return definePlugin<EffectPhrases>({
		name: "effect",
		library: { name: "effect", versions: ">=3.0 <5" },
		phrases: { en },
		calls,
		conditions,
		statements: [
			statement((c, n) => {
				normalize(c, n);
				return false;
			}, true),
			statement(yieldStatement, true),
			statement(effectFnDeclaration, true),
			statement(classStatement, true),
		],
		describeSchema: (e, n, say) => schemaType(ctx(e, say), n, true),
	});
};
