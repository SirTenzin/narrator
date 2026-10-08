import { D } from "@narrate/core";
import { type CallRule, type CondRule, definePlugin, type Engine, type StmtRule, type TsPlugin } from "@narrate/lang-ts";
import { type Ctx, type FileState, type Mode, type OpTable, pipeline, pipeStep, resetState, type Version } from "./context";
import { en } from "./en";
import { dataConditions, dataOps } from "./ops/data";
import { effectOps } from "./ops/effect";
import { layerOps } from "./ops/layer";
import { scheduleHow, scheduleOps } from "./ops/schedule";
import { schemaOps, schemaType } from "./ops/schema";
import { streamOps } from "./ops/stream";
import type { EffectPhrases } from "./phrases";
import { classStatement, curriedStatement, effectFnDeclaration, useRule, yieldStatement } from "./statements";

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
	const v: Version = version ?? "auto";
	const ops = opsFor(v, [effectOps, { shared: scheduleOps }, { shared: schemaOps }, dataOps, streamOps, layerOps]);
	const state: FileState = { src: "\0", importsEffect: false, fibers: new Set(), refs: new Set(), deferreds: new Set(), currentClass: null };
	const ctx = (e: Engine, say: EffectPhrases): Ctx => {
		const c = { e, say, version: v, state, ops };
		resetState(c);
		return c;
	};

	const calls: Record<string, CallRule<EffectPhrases>> = {};
	for (const [key, op] of Object.entries(ops))
		calls[key] = ({ node, args, e, stmt, say }) => {
			const c = ctx(e, say);
			const mode: Mode = stmt ? "act" : "noun";
			if (op.kind === "make") return op.render(c, args, mode, node);
			if (op.kind === "curried") return op.render(c, args, null, mode);
			if (op.dataFirst(args)) {
				if (op.first) return op.first(c, args, mode);
				const s = op.render(c, args.slice(1));
				return s && pipeline(c, args[0], [s], mode);
			}
			const s = op.render(c, args);
			if (!s || mode === "act") return s;
			return D(say.pipe.stepFn({ step: s.t }), s.kids);
		};

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
	for (const [key, pick] of Object.entries(dataConditions(v)))
		conditions[key] = ({ args, e, neg, say }) => (args[0] ? pick(say)({ subject: e.noun(args[0]).t, neg }) : null);

	// The engine reads any `.some(...)` call as a yes/no check; claim `Option.some` back as a value.
	conditions["Option.some"] = ({ node, e, say }) => calls["Option.some"]!({ node, args: node.arguments, obj: null, e, stmt: false, say });

	const statement =
		(f: (c: Ctx, n: any, d: number) => boolean, gated: boolean): StmtRule<EffectPhrases> =>
		({ node, e, d, say }) => {
			const c = ctx(e, say);
			if (gated && !c.state.importsEffect) return false;
			return f(c, node, d);
		};

	return definePlugin<EffectPhrases>({
		name: "effect",
		phrases: { en },
		calls,
		conditions,
		statements: [statement(yieldStatement, true), statement(effectFnDeclaration, false), statement(curriedStatement, false), statement(classStatement, false)],
		describeSchema: (e, n, say) => schemaType(ctx(e, say), n, true),
	});
};
