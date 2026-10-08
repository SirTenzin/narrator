import { capFirst, D, type Doc, type Line, mk } from "@narrate/core";
import { type Engine, type N, unwrap } from "@narrate/lang-ts";
import type { EffectPhrases } from "./phrases";

export type Version = 3 | 4 | "auto";
export type Mode = "noun" | "act";

/** Per-file facts the yield reader needs (v3 fibers, refs and deferreds are themselves yieldable). */
export type FileState = {
	src: string;
	importsEffect: boolean;
	fibers: Set<string>;
	refs: Set<string>;
	deferreds: Set<string>;
	/** The Effect class being narrated, so `this` inside it reads as its name. */
	currentClass: string | null;
};

export type Ctx = { e: Engine; say: EffectPhrases; version: Version; state: FileState; ops: OpTable };

/** Builds a value (`Effect.succeed(1)`); `act` reads it as something to do. Return null to decline. */
export type MakeOp = { kind: "make"; render: (c: Ctx, args: N[], mode: Mode, node: N) => Doc | null };
/** A pipeable combinator (`Effect.map(f)`); `render` gets the step arguments without the data-first subject. */
export type StepOp = {
	kind: "step";
	dataFirst: (args: N[]) => boolean;
	render: (c: Ctx, args: N[]) => Doc | null;
	/** Overrides the default "subject, then step" reading of the data-first form. */
	first?: (c: Ctx, args: N[], mode: Mode) => Doc | null;
};
/** A curried builder (`Schema.decodeUnknown(User)(input)`); `outer` is null when only the first call is present. */
export type CurriedOp = { kind: "curried"; render: (c: Ctx, inner: N[], outer: N[] | null, mode: Mode) => Doc | null };
export type Op = MakeOp | StepOp | CurriedOp;
export type OpTable = Record<string, Op>;

export const make = (render: MakeOp["render"]): MakeOp => ({ kind: "make", render });
/** `arity` is how many arguments the data-last form takes; one more means data-first. */
export const step = (arity: number, render: StepOp["render"]): StepOp => ({ kind: "step", dataFirst: (a) => a.length > arity, render });
export const stepIf = (dataFirst: StepOp["dataFirst"], render: StepOp["render"]): StepOp => ({ kind: "step", dataFirst, render });
export const curried = (render: CurriedOp["render"]): CurriedOp => ({ kind: "curried", render });
export const fixed = (pick: (say: EffectPhrases) => string) => step(0, (c) => D(pick(c.say)));
export const form = (f: { noun: (p: any) => string; act: (p: any) => string }, mode: Mode, p: Record<string, string>) => f[mode](p);

export const isFn = (n: N) => {
	const u = unwrap(n);
	return u?.type === "ArrowFunctionExpression" || u?.type === "FunctionExpression";
};

/** `Effect.map` for a member callee, or null. */
export function memberKey(n: N): string | null {
	const u = unwrap(n);
	if (u?.type !== "MemberExpression" || u.computed) return null;
	const obj = unwrap(u.object);
	if (obj?.type !== "Identifier") return null;
	return `${obj.name}.${u.property.name}`;
}

export const calleeKey = (call: N): string | null => (unwrap(call)?.type === "CallExpression" ? memberKey(unwrap(call).callee) : null);

export const strLit = (n: N): string | null => {
	const u = unwrap(n);
	return u?.type === "Literal" && typeof u.value === "string" ? u.value : null;
};

export const objProp = (obj: N, key: string): N | null => {
	const u = unwrap(obj);
	if (u?.type !== "ObjectExpression") return null;
	const p = u.properties.find((x: N) => x.type === "Property" && (x.key?.name === key || x.key?.value === key));
	return p ? p.value : null;
};

export const isObj = (n: N) => unwrap(n)?.type === "ObjectExpression";
export const isPascal = (n: N) => unwrap(n)?.type === "Identifier" && /^[A-Z]/.test(unwrap(n).name);

/** Lines `1. …`, `2. …` for a pipeline, each step's own block nested beneath it. */
export function numbered(c: Ctx, docs: Doc[]): Line[] {
	return docs.flatMap((doc, i) => [
		{
			d: 0,
			text: `${c.say.common.numbered({ n: String(i + 1), step: capFirst(doc.t) })}${doc.kids.length ? ":" : ""}`,
			start: -1,
			end: -1,
			kind: "bullet" as const,
		},
		...doc.kids.map((k) => ({ ...k, d: k.d + 1 })),
	]);
}

export function resetState(c: Ctx) {
	if (c.state.src === c.e.src) return;
	c.state.src = c.e.src;
	c.state.importsEffect = /from\s+["'](effect|@effect\/[\w-]+)(\/[\w/-]*)?["']/.test(c.e.src);
	c.state.fibers.clear();
	c.state.refs.clear();
	c.state.deferreds.clear();
}

/** A duration argument: `"5 seconds"` reads as-is, a bare number is milliseconds, `Duration.seconds(5)` reads naturally. */
export function duration(c: Ctx, n: N): Doc {
	const u = unwrap(n);
	const s = strLit(u);
	if (s !== null) return D(mk("l", s));
	if (u?.type === "Literal" && typeof u.value === "number") return D(c.say.duration.millis({ n: mk("l", String(u.value)) }));
	const key = calleeKey(u);
	const unit = key?.startsWith("Duration.") ? key.slice(9) : null;
	const units = { millis: "millis", seconds: "seconds", minutes: "minutes", hours: "hours", days: "days", weeks: "weeks" } as const;
	if (unit && unit in units) return D(c.say.duration[units[unit as keyof typeof units]]({ n: c.e.noun(u.arguments[0]).t }));
	if (memberKey(u) === "Duration.infinity") return D(c.say.duration.infinity);
	return c.e.noun(u);
}

/** The `concurrency` option as an adverbial phrase ("one after another" when absent). */
export function concurrency(c: Ctx, opts: N | null): string {
	const v = opts ? unwrap(objProp(opts, "concurrency")) : null;
	if (!v) return c.say.concurrency.sequential;
	const s = strLit(v);
	if (s === "unbounded") return c.say.concurrency.unbounded;
	if (s === "inherit") return c.say.concurrency.inherit;
	return c.say.concurrency.limited({ n: c.e.noun(v).t });
}

/** The parts of a callback: its parameter read as a name (null when unused) and its body. */
export function callbackParts(c: Ctx, fn: N): { name: string | null; expr: N | null; block: N | null } {
	const f = unwrap(fn);
	const p = f.params[0];
	const ex = c.e.lambdaExpr(f);
	const body = ex ?? f.body;
	let name: string | null = null;
	if (p?.type === "Identifier" && !p.name.startsWith("_") && c.e.countUses(body, p.name) > 0) name = c.e.ref(p.name);
	else if (p?.type === "ObjectPattern") {
		const names = c.e.patternNames(p);
		if (names.length) name = c.e.g.list(names);
	}
	return { name, expr: ex, block: ex ? null : f.body };
}

/** A callback body read as a value ("the user's name") or, for block bodies, "the following" plus its lines. */
export function cbValue(c: Ctx, parts: { expr: N | null; block: N | null }): Doc {
	if (parts.expr) return noun(c, parts.expr);
	return D(c.say.common.theFollowing, c.e.body(parts.block, 0));
}

/** A callback body read as something to do. */
export function cbAction(c: Ctx, parts: { expr: N | null; block: N | null }): Doc {
	if (parts.expr) return act(c, parts.expr);
	return D(c.say.common.doThis, c.e.body(parts.block, 0));
}

export type Callback = { named: (p: any) => string; anon: (p: any) => string; fn: (p: any) => string };

/** Picks the named / anonymous / function-reference reading of a callback step. */
export function callbackStep(c: Ctx, phrases: Callback, fn: N, as: "value" | "action" | "cond", extra: Record<string, string> = {}): Doc {
	if (!isFn(fn)) return D(phrases.fn({ ...extra, fn: c.e.noun(fn).t }));
	const parts = callbackParts(c, fn);
	const body = as === "cond" ? (parts.expr ? c.e.cond(parts.expr) : cbValue(c, parts)) : as === "value" ? cbValue(c, parts) : cbAction(c, parts);
	const p = { ...extra, [as]: body.t };
	return D(parts.name ? phrases.named({ ...p, name: parts.name }) : phrases.anon(p), body.kids);
}

/** Renders a curried call (`Schema.decodeUnknown(User)(input)`) if the plugin knows its inner builder. */
export function curriedCall(c: Ctx, n: N, mode: Mode): Doc | null {
	const u = unwrap(n);
	if (u?.type !== "CallExpression") return null;
	const inner = unwrap(u.callee);
	const key = calleeKey(inner);
	const op = key ? c.ops[key] : null;
	if (op?.kind !== "curried") return null;
	return op.render(c, inner.arguments, u.arguments, mode);
}

/** A node as a noun phrase, curried Effect builders included. */
export function noun(c: Ctx, n: N): Doc {
	return curriedCall(c, n, "noun") ?? c.e.noun(n);
}

const BARE_ACTS: Record<string, (say: EffectPhrases) => { noun: string; act: string }> = {
	"Effect.void": (s) => s.program.nothing,
	"Effect.unit": (s) => s.program.nothing,
	"Effect.never": (s) => s.program.never,
};

/** A node read as something to do: an effect call's action form, or "run X". */
export function act(c: Ctx, n: N): Doc {
	const u = unwrap(n);
	const cur = curriedCall(c, u, "act");
	if (cur) return cur;
	if (u?.type === "CallExpression") return c.e.call(u, true);
	const bare = memberKey(u);
	if (bare && BARE_ACTS[bare]) return D(BARE_ACTS[bare](c.say).act);
	const v = c.e.noun(u);
	return D(c.say.program.run({ effect: v.t }), v.kids);
}

/** One argument of a pipe: a known combinator's step phrase, or "apply f". */
export function pipeStep(c: Ctx, n: N): Doc {
	const u = unwrap(n);
	const key = u?.type === "CallExpression" ? calleeKey(u) : memberKey(u);
	const op = key ? c.ops[key] : null;
	if (op?.kind === "step") {
		const r = op.render(c, u.type === "CallExpression" ? u.arguments : []);
		if (r) return r;
	}
	if (op?.kind === "make" && u.type !== "CallExpression") {
		const r = op.render(c, [], "act", u);
		if (r) return r;
	}
	const fn = noun(c, u);
	return D(c.say.pipe.apply({ fn: fn.t }), fn.kids);
}

/** `subject` followed by `steps`: inline for one simple step, otherwise numbered. */
export function pipeline(c: Ctx, subject: N, steps: Doc[], mode: Mode): Doc {
	const first = mode === "noun" ? noun(c, subject) : act(c, subject);
	if (steps.length === 1 && !first.kids.length && !steps[0]!.kids.length) return D(c.say.pipe.then({ first: first.t, next: steps[0]!.t }));
	const start = mode === "noun" ? D(c.say.pipe.start({ subject: first.t }), first.kids) : first;
	return D(mode === "noun" ? c.say.pipe.noun : c.say.pipe.act, numbered(c, [start, ...steps]));
}
