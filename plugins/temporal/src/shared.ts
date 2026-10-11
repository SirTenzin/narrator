import { type Doc, type Line, lowerFirst, mk } from "@usenarrator/core";
import { type Engine, type N, type StmtRule, unwrap } from "@usenarrator/lang-ts";
import type { MessageKind, TemporalPhrases } from "./phrases";
import { durationText } from "./time";

/** What this file binds from Temporal, and the activities, messages and handles it creates. */
export type Facts = {
	imports: Map<string, { name: string; from: string }>;
	namespaces: Map<string, string>;
	activities: Set<string>;
	activityObjects: Set<string>;
	messages: Map<string, { kind: MessageKind; name: string }>;
	handles: Set<string>;
	workers: Set<string>;
};

export type Ctx = { e: Engine; say: TemporalPhrases; facts: Facts };
export type Site = { node: N; args: N[]; obj: N | null; stmt: boolean };
export type Rule = (c: Ctx, site: Site) => Doc | null;

const isSource = (s: string) => s.startsWith("@temporalio/");
const MODULES = ["@temporalio/workflow", "@temporalio/client", "@temporalio/worker", "@temporalio/activity", "@temporalio/common"];
export const usesTemporal = (e: Engine) => MODULES.some((m) => e.usesLibrary(m));

export const isFn = (n: N) => {
	const u = unwrap(n);
	return u?.type === "ArrowFunctionExpression" || u?.type === "FunctionExpression";
};

export const str = (n: N): string | null => {
	const u = unwrap(n);
	if (u?.type === "Literal" && typeof u.value === "string") return u.value;
	if (u?.type === "TemplateLiteral" && !u.expressions.length) return u.quasis[0].value.cooked;
	return null;
};

export const keyOf = (p: N): string | null => {
	if (p?.type !== "Property" || p.computed) return null;
	if (p.key.type === "Identifier") return p.key.name;
	return p.key.type === "Literal" ? String(p.key.value) : null;
};

export const objectArg = (n: N): N | null => {
	const u = unwrap(n);
	return u?.type === "ObjectExpression" ? u : null;
};

export const propOf = (obj: N | null, key: string): N | null => obj?.properties.find((p: N) => keyOf(p) === key)?.value ?? null;

export const dur = (c: Ctx, n: N) => durationText({ e: c.e, time: c.say.time }, n, "ms");

export const details = (c: Ctx, items: string[]): string | null => (items.length ? c.say.details({ items }) : null);

export const genericOption = (c: Ctx, p: N): string => {
	const k = keyOf(p);
	if (!k) return c.e.text(p.type === "SpreadElement" ? p : p.value);
	return c.say.option({ name: c.e.prop(k), value: p.shorthand ? c.e.ref(k) : c.e.text(p.value) });
};

/** A string the reader should see verbatim (event names, CEL expressions, field paths), as code. */
export const codeText = (c: Ctx, n: N): string => {
	const s = str(n);
	return s === null ? c.e.text(n) : mk("c", s);
};

/** A callback's steps; an expression body is its result. */
export function fnLines(e: Engine, fn: N): Line[] {
	const f = unwrap(fn);
	if (f.body.type === "BlockStatement") return e.body(f.body, 0);
	return e.body({ type: "ReturnStatement", argument: f.body, start: f.body.start, end: f.body.end }, 0);
}

/** A callback whose steps fit on one line, as that line's text (lowercased, no full stop); otherwise null, leaving no trace. */
export function oneLine(e: Engine, fn: N): string | null {
	const f = unwrap(fn);
	const only = f.body.type === "BlockStatement" && f.body.body.length === 1 ? f.body.body[0] : null;
	const raw = f.body.type !== "BlockStatement" ? f.body : only?.type === "ReturnStatement" && only.argument ? only.argument : null;
	const value = raw?.type === "UnaryExpression" && raw.operator === "void" ? raw.argument : raw;
	const stats = { ...e.stats, fallbackTypes: { ...e.stats.fallbackTypes } };
	const used = new Set(e.usedComments);
	const lines = value ? e.body({ type: "ExpressionStatement", expression: value, start: value.start, end: value.end }, 0) : e.body(f.body, 0);
	if (lines.length === 1 && !lines[0]!.text.endsWith(":")) return lowerFirst(lines[0]!.text.replace(/\.$/, ""));
	e.stats = stats;
	e.usedComments = used;
	return null;
}

/** The Temporal export a callee names, through a named import (`sleep`) or a namespace (`wf.sleep`). */
export function exported(c: Ctx, n: N): { name: string; from: string } | null {
	const u = unwrap(n);
	if (u?.type === "Identifier") return c.facts.imports.get(u.name) ?? null;
	if (u?.type !== "MemberExpression" || u.computed) return null;
	const ns = unwrap(u.object);
	const from = ns?.type === "Identifier" ? c.facts.namespaces.get(ns.name) : null;
	return from ? { name: u.property.name, from } : null;
}

export const exportedName = (c: Ctx, n: N): string | null => exported(c, n)?.name ?? null;

const lastName = (n: N): string | null => {
	const u = unwrap(n);
	if (u?.type === "Identifier") return u.name;
	if (u?.type === "MemberExpression" && !u.computed) return u.property.name;
	return null;
};

/** A workflow handle: assigned from `start`/`getHandle`/`startChild` here, or named like one. */
export const isHandle = (c: Ctx, n: N | null): boolean => {
	if (!n || !usesTemporal(c.e)) return false;
	const name = lastName(n);
	return !!name && (c.facts.handles.has(name) || /handle$/i.test(name));
};

/** A Temporal worker: made by `Worker.create` here, or named `worker`. */
export const isWorker = (c: Ctx, n: N | null): boolean => {
	if (!n || !usesTemporal(c.e)) return false;
	const name = lastName(n);
	return !!name && (c.facts.workers.has(name) || /^worker$/i.test(name));
};

/** A defined signal/query/update by variable, as "the signal "approve"", with its kind. */
export function messageRef(c: Ctx, n: N): { kind: MessageKind | null; text: string } {
	const u = unwrap(n);
	const m = u?.type === "Identifier" ? c.facts.messages.get(u.name) : null;
	if (m) return { kind: m.kind, text: c.say.messages.noun({ kind: m.kind, name: mk("l", `"${m.name}"`) }) };
	if (str(u) !== null) return { kind: null, text: c.e.text(u) };
	return { kind: null, text: c.e.text(n) };
}

const DEFINERS: Record<string, MessageKind> = { defineSignal: "signal", defineQuery: "query", defineUpdate: "update" };
const HANDLE_MAKERS = new Set(["start", "getHandle", "startChild", "getExternalWorkflowHandle", "signalWithStart"]);

function visit(n: N, f: (n: N) => void) {
	if (!n || typeof n !== "object") return;
	if (Array.isArray(n)) {
		for (const x of n) visit(x, f);
		return;
	}
	if (typeof n.type === "string") f(n);
	for (const k in n) if (k !== "parent" && n[k] && typeof n[k] === "object") visit(n[k], f);
}

function scan(program: N, f: Facts) {
	for (const st of program?.body ?? []) {
		if (st.type !== "ImportDeclaration" || !isSource(st.source.value)) continue;
		for (const sp of st.specifiers ?? []) {
			if (sp.type === "ImportSpecifier") f.imports.set(sp.local.name, { name: sp.imported.name ?? sp.imported.value, from: st.source.value });
			if (sp.type === "ImportNamespaceSpecifier") f.namespaces.set(sp.local.name, st.source.value);
		}
	}
	const c = { facts: f } as Ctx;
	visit(program, (n) => {
		if (n.type !== "VariableDeclarator" || !n.init) return;
		const init = unwrap(n.init);
		if (init?.type !== "CallExpression") return;
		const name = exportedName(c, init.callee);
		if (name === "proxyActivities" || name === "proxyLocalActivities") {
			if (n.id.type === "Identifier") f.activityObjects.add(n.id.name);
			if (n.id.type === "ObjectPattern")
				for (const p of n.id.properties) if (p.type === "Property" && p.value?.type === "Identifier") f.activities.add(p.value.name);
			return;
		}
		if (n.id.type !== "Identifier") return;
		const kind = name ? DEFINERS[name] : undefined;
		const msg = kind ? str(init.arguments[0]) : null;
		if (kind && msg !== null) f.messages.set(n.id.name, { kind, name: msg });
		const callee = unwrap(init.callee);
		const method = callee?.type === "MemberExpression" ? callee.property?.name : name;
		if (method && HANDLE_MAKERS.has(method)) f.handles.add(n.id.name);
		if (method === "create" && exportedName(c, callee.object) === "Worker") f.workers.add(n.id.name);
	});
}

/** Facts for the file being narrated, read once per parsed program. */
export function factsReader(): (e: Engine) => Facts {
	const cache = new WeakMap<object, Facts>();
	return (e) => {
		const key = e.program ?? e;
		const hit = cache.get(key);
		if (hit) return hit;
		const facts: Facts = {
			imports: new Map(),
			namespaces: new Map(),
			activities: new Set(),
			activityObjects: new Set(),
			messages: new Map(),
			handles: new Set(),
			workers: new Set(),
		};
		cache.set(key, facts);
		if (e.program) scan(e.program, facts);
		return facts;
	};
}

/** Runs a statement rule in its own frame so block lines from `e.text(…)` inside it land beneath its line, as they do for call rules. */
export function framed<P>(rule: StmtRule<P>): StmtRule<P> {
	return (ctx) => {
		const { e, d } = ctx;
		e.orphanFrames.push([]);
		const start = e.lines.length;
		let claimed = false;
		try {
			claimed = rule(ctx);
			return claimed;
		} finally {
			const orphans = e.orphanFrames.pop() ?? [];
			const head = e.lines[start];
			if (claimed && head && orphans.length) {
				head.text = head.text.replace(/\.$/, ":");
				for (const k of orphans) e.lines.push({ ...k, d: k.d + d + 1, start: k.start < 0 ? head.start : k.start, end: k.end < 0 ? head.end : k.end });
			}
		}
	};
}
