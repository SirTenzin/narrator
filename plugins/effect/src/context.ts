import { capFirst, D, type Doc, type Line, mk } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import type { EffectPhrases } from "./phrases";

export type Version = 3 | 4 | "auto";
export type Mode = "noun" | "act";

/** Per-file facts the yield reader needs (v3 fibers, refs and deferreds are themselves yieldable). */
export type FileState = {
	src: string;
	fibers: Set<string>;
	refs: Set<string>;
	deferreds: Set<string>;
	queues: Set<string>;
	/** The Effect class being narrated, so `this` inside it reads as its name. */
	currentClass: string | null;
} & FileImports;

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

const IMPORT = /\bimport\s+(?:type\s+)?([\w$*{}\s,]+?)\s+from\s+["']([^"']+)["']/g;
export const isEffectModule = (m: string) => /^(effect|@effect\/[\w-]+)(\/|$)/.test(m);

/** Local names bound by an import clause: `A`, `* as A`, `{ a, b as c, type d }`. */
function importedNames(clause: string): string[] {
	return clause
		.replace(/[{}]/g, ",")
		.split(",")
		.map((part) => part.trim().replace(/^type\s+/, ""))
		.filter(Boolean)
		.map((part) =>
			part
				.split(/\s+as\s+/)
				.at(-1)!
				.trim(),
		);
}

/** What a file imports: names bound from Effect modules, names bound from anything else, and every module specifier. */
export type FileImports = { importsEffect: boolean; effectNames: Set<string>; foreignNames: Set<string>; modules: Set<string> };

export function readImports(src: string): FileImports {
	const out: FileImports = { importsEffect: false, effectNames: new Set(), foreignNames: new Set(), modules: new Set() };
	for (const [, clause, from] of src.matchAll(IMPORT)) {
		out.modules.add(from!);
		const names = isEffectModule(from!) ? out.effectNames : out.foreignNames;
		for (const n of importedNames(clause!)) names.add(n);
	}
	out.importsEffect = [...out.modules].some(isEffectModule);
	return out;
}

/** Whether `name` (e.g. `Queue`) refers to Effect's module: the file imports Effect and didn't take `name` from another library. */
export const ownsIn = (imports: FileImports, name: string) => imports.importsEffect && (imports.effectNames.has(name) || !imports.foreignNames.has(name));

export function resetState(c: Ctx) {
	if (c.state.src === c.e.src) return;
	const s = c.state;
	s.src = c.e.src;
	s.fibers.clear();
	s.refs.clear();
	s.deferreds.clear();
	s.queues.clear();
	Object.assign(s, readImports(c.e.src));
}

/** A schema argument as a type phrase via whichever plugin describes schemas; a bare `User` reads "a user". */
export function schemaPhrase(e: Engine, n: N): string {
	const u = unwrap(n);
	const described = u ? e.schemaText(u) : null;
	if (described) return described;
	if (u?.type === "Identifier" && /^[A-Z]/.test(u.name)) {
		const words = e.lex.humanize(u.name);
		return `${e.g.article(words)} ${e.ref(u.name)}`;
	}
	return e.noun(u).t;
}

/** `ownsIn` for the file being narrated. */
export const owns = (c: Ctx, name: string) => ownsIn(c.state, name);

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
	if (parts.expr) return c.e.noun(parts.expr);
	return D(c.say.common.theFollowing, c.e.body(parts.block, 0));
}

/** A callback body read as something to do. */
export function cbAction(c: Ctx, parts: { expr: N | null; block: N | null }): Doc {
	if (parts.expr) return act(c, parts.expr);
	return D(c.say.common.doThis, c.e.body(parts.block, 0));
}

export type Callback = { named: (p: any) => string; anon: (p: any) => string; fn: (p: any) => string };

/** Picks the named / anonymous / function-reference reading of a callback step. */
export function callbackStep(
	c: Ctx,
	phrases: Callback,
	fn: N,
	as: "value" | "action" | "cond",
	extra: Record<string, string> = {},
	read: (c: Ctx, n: N) => Doc = (c, n) => c.e.noun(n),
): Doc {
	if (!isFn(fn)) return D(phrases.fn({ ...extra, fn: c.e.noun(fn).t }));
	const parts = callbackParts(c, fn);
	const value = () => (parts.expr ? read(c, parts.expr) : cbValue(c, parts));
	const body = as === "cond" ? (parts.expr ? c.e.cond(parts.expr) : cbValue(c, parts)) : as === "value" ? value() : cbAction(c, parts);
	const p = { ...extra, [as]: body.t };
	return D(parts.name ? phrases.named({ ...p, name: parts.name }) : phrases.anon(p), body.kids);
}

export const delegate = (n: N) => {
	const u = unwrap(n);
	return u?.type === "YieldExpression" && u.delegate ? unwrap(u.argument) : null;
};

const FAILS = new Set(["Effect.fail", "Effect.failSync", "Effect.die", "Effect.dieMessage", "Effect.interrupt"]);
export const FORKS = new Set(["Effect.fork", "Effect.forkDaemon", "Effect.forkScoped", "Effect.forkChild", "Effect.forkDetach", "Effect.forkIn"]);
export const endsTheProgram = (arg: N) => arg.type === "NewExpression" || FAILS.has(calleeKey(arg) ?? "");

/** A service tag as a linkable name (`Database`), or its noun for anything more complex. */
export function serviceName(c: Ctx, tag: N): string {
	const u = unwrap(tag);
	if (u?.type === "Identifier") return c.e.fnRef(u.name, u.name);
	if (u?.type === "ThisExpression" && c.state.currentClass) return c.e.fnRef(c.state.currentClass, c.state.currentClass);
	if (isServiceTag(u)) return c.e.fnRef(c.e.code(u), u.property.name);
	return c.e.noun(u).t;
}

/** A module's service tag such as `HttpClient.HttpClient` or `SqlClient.SqlClient`. */
export const isServiceTag = (n: N) => {
	const u = unwrap(n);
	return u?.type === "MemberExpression" && !u.computed && isPascal(u.object) && /^[A-Z]/.test(u.property.name ?? "");
};

/** `Users.Default` (v3 `Effect.Service`) / `Users.layer` (v4 convention) as "the default Users layer"; anything else as itself. */
export function layerNoun(c: Ctx, n: N): string {
	const u = unwrap(n);
	const obj = u?.type === "MemberExpression" && !u.computed ? unwrap(u.object) : null;
	if (obj?.type === "Identifier" && isPascal(obj)) {
		const service = c.e.fnRef(obj.name, obj.name);
		if (u.property.name === "Default" || u.property.name === "DefaultWithoutDependencies") return c.say.service.defaultLayer({ service });
		if (u.property.name === "layer") return c.say.service.layerOf({ service });
	}
	return c.e.noun(u).t;
}

/** `new NotFound({ id })` where only an error makes sense (yielded, failed with): the error kind plus every field. */
export function errorNoun(c: Ctx, n: N): Doc {
	const u = unwrap(n);
	const callee = unwrap(u.callee);
	if (callee?.type !== "Identifier") return c.e.noun(u);
	const words = c.e.lex.humanize(callee.name);
	const kind = `${c.e.g.article(words)} ${c.e.fnRef(callee.name, words)}`;
	const arg = unwrap(u.arguments[0]);
	if (!arg) return D(c.say.data.newError({ kind }));
	const fields =
		arg.type === "ObjectExpression"
			? arg.properties.map((p: N) => {
					if (p.type !== "Property") return c.e.noun(p);
					const label = c.e.prop(p.key?.name ?? String(p.key?.value));
					if (p.shorthand) return D(label);
					const v = c.e.noun(p.value);
					return D(c.say.common.labeled({ label, value: v.t }), v.kids);
				})
			: [c.e.noun(arg)];
	if (!fields.length) return D(c.say.data.newError({ kind }));
	return D(
		c.say.data.newErrorWith({ kind, fields: c.e.g.list(fields.map((f: Doc) => f.t)) }),
		fields.flatMap((f: Doc) => f.kids),
	);
}

/** A value in a position that can only be an error (`Effect.fail(x)`, `catch: () => x`). */
export const errorValue = (c: Ctx, n: N): Doc => (unwrap(n)?.type === "NewExpression" ? errorNoun(c, n) : c.e.noun(n));

/** What `yield* arg` does, as an action. */
export function yieldAction(c: Ctx, arg: N): Doc {
	const y = c.say.yield;
	if (arg.type === "NewExpression") {
		const err = errorNoun(c, arg);
		return D(y.failWith({ error: err.t }), err.kids);
	}
	if (arg.type === "Identifier") {
		const name = c.e.ref(arg.name);
		if (c.state.fibers.has(arg.name)) return D(y.awaitFiber({ fiber: name }));
		if (c.state.refs.has(arg.name)) return D(y.readRef({ ref: name }));
		if (c.state.deferreds.has(arg.name)) return D(y.awaitDeferred({ deferred: name }));
		if (c.state.queues.has(arg.name)) return D(c.say.queue.take.act({ queue: name }));
		if (isPascal(arg)) return D(y.service({ service: serviceName(c, arg) }));
	}
	if (isServiceTag(arg)) return D(y.service({ service: serviceName(c, arg) }));
	return act(c, arg);
}

const BARE_ACTS: Record<string, (say: EffectPhrases) => string> = {
	"Effect.void": (s) => s.program.nothing.act,
	"Effect.never": (s) => s.program.never.act,
	"Effect.yieldNow": (s) => s.program.yieldNow,
	"Effect.interrupt": (s) => s.program.interrupt,
};

/** A node read as something to do: an effect call's action form, a yielded effect, or "run X". */
export function act(c: Ctx, n: N): Doc {
	const u = unwrap(n);
	const yielded = delegate(u);
	if (yielded) return yieldAction(c, yielded);
	if (u?.type === "CallExpression") return c.e.call(u, true);
	const bare = memberKey(u);
	if (bare && BARE_ACTS[bare]) return D(BARE_ACTS[bare](c.say));
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
	// Steps from companion plugins (`effect/platform`): their rules read a call in action form as the step itself.
	const root = key?.slice(0, key.indexOf("."));
	if (!op && root && owns(c, root) && u.type === "CallExpression" && c.e.applyRulesQuiet(u)) return c.e.call(u, true);
	const fn = c.e.noun(u);
	return D(c.say.pipe.apply({ fn: fn.t }), fn.kids);
}

/** `subject` followed by `steps`: inline for one simple step, otherwise numbered. */
export function pipeline(c: Ctx, subject: N, steps: Doc[], mode: Mode): Doc {
	const first = mode === "noun" ? c.e.noun(subject) : act(c, subject);
	if (steps.length === 1 && !first.kids.length && !steps[0]!.kids.length) return D(c.say.pipe.then({ first: first.t, next: steps[0]!.t }));
	const start = mode === "noun" ? D(c.say.pipe.start({ subject: first.t }), first.kids) : first;
	return D(mode === "noun" ? c.say.pipe.noun : c.say.pipe.act, numbered(c, [start, ...steps]));
}
