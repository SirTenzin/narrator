import { D, type Doc, type Line } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import type { BullmqPhrases } from "./phrases";
import { durationText } from "./time";

/** Names this file binds from BullMQ, and the variables it creates as queues, workers, event streams, flow producers, and jobs. */
export type Facts = {
	imports: Map<string, string>;
	queues: Set<string>;
	workers: Set<string>;
	events: Set<string>;
	flows: Set<string>;
	jobs: Set<string>;
};

export type Ctx = { e: Engine; say: BullmqPhrases; facts: Facts };
export type Site = { node: N; args: N[]; obj: N | null; stmt: boolean };
export type Rule = (c: Ctx, site: Site) => Doc | null;

const SOURCES = ["bullmq", "bullmq-pro", "@taskforcesh/bullmq-pro"];

export const usesBullmq = (e: Engine) => SOURCES.some((s) => e.usesLibrary(s));

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

export const isTrue = (n: N) => unwrap(n)?.type === "Literal" && unwrap(n).value === true;
export const isFalse = (n: N) => unwrap(n)?.type === "Literal" && unwrap(n).value === false;

export const ms = (c: Ctx, n: N) => durationText({ e: c.e, time: c.say.time }, n, "ms");
/** A duration after "per": "per second" rather than "per 1 second". */
export const perMs = (c: Ctx, n: N) => durationText({ e: c.e, time: c.say.time }, n, "ms", true);
export const secs = (c: Ctx, n: N) => durationText({ e: c.e, time: c.say.time }, n, "s");

export const details = (c: Ctx, items: string[]): string | null => (items.length ? c.say.details({ items }) : null);

/** An option the plugin doesn't interpret: "name: value", spreads as the engine renders them. */
export const genericOption = (c: Ctx, p: N): string => {
	const k = keyOf(p);
	if (!k) return c.e.text(p.type === "SpreadElement" ? p : p.value);
	return c.say.option({ name: c.e.prop(k), value: p.shorthand ? c.e.ref(k) : c.e.text(p.value) });
};

/** A callback's steps. An expression body is its result when `returns` (a processor), else its one action (an event handler). */
export function fnLines(e: Engine, fn: N, returns = true): Line[] {
	const f = unwrap(fn);
	if (f.body.type === "BlockStatement") return e.body(f.body, 0);
	const type = returns ? "ReturnStatement" : "ExpressionStatement";
	return e.body({ type, argument: f.body, expression: f.body, start: f.body.start, end: f.body.end }, 0);
}

const lastName = (n: N): string | null => {
	const u = unwrap(n);
	if (u?.type === "Identifier") return u.name;
	if (u?.type === "MemberExpression" && !u.computed) return u.property.name;
	return null;
};

const role = (set: keyof Facts, pattern: RegExp) => (c: Ctx, n: N | null) => {
	if (!n || !usesBullmq(c.e)) return false;
	const name = lastName(n);
	if (!name) return false;
	return (c.facts[set] as Set<string>).has(name) || pattern.test(name);
};

export const isQueue = role("queues", /queue$/i);
export const isWorker = role("workers", /worker$/i);
export const isQueueEvents = role("events", /queueEvents$|^events$/i);
export const isFlow = role("flows", /flow(Producer)?$/i);
export const isJob = role("jobs", /^job$|Job$/);

/** The BullMQ export a callee was imported as (`Queue`, `Worker`), or null. */
export function importedAs(c: Ctx, callee: N): string | null {
	const u = unwrap(callee);
	return u?.type === "Identifier" ? (c.facts.imports.get(u.name) ?? null) : null;
}

const CTORS: Record<string, keyof Facts> = {
	Queue: "queues",
	QueuePro: "queues",
	Worker: "workers",
	WorkerPro: "workers",
	QueueEvents: "events",
	QueueEventsPro: "events",
	FlowProducer: "flows",
	FlowProducerPro: "flows",
};
export const ctorKind = (c: Ctx, n: N): keyof Facts | null => {
	const u = unwrap(n);
	if (u?.type !== "NewExpression") return null;
	const name = importedAs(c, u.callee);
	return name ? (CTORS[name] ?? null) : null;
};

const paramName = (p: N): string | null => {
	const u = p?.type === "AssignmentPattern" ? p.left : p;
	return u?.type === "Identifier" ? u.name : null;
};

function visit(n: N, f: (n: N) => void) {
	if (!n || typeof n !== "object") return;
	if (Array.isArray(n)) {
		for (const x of n) visit(x, f);
		return;
	}
	if (typeof n.type === "string") f(n);
	for (const k in n) if (k !== "parent" && n[k] && typeof n[k] === "object") visit(n[k], f);
}

const typeName = (id: N): string | null => {
	const t = id?.typeAnnotation?.typeAnnotation;
	return t?.type === "TSTypeReference" && t.typeName.type === "Identifier" ? t.typeName.name : null;
};

function scan(program: N, f: Facts) {
	for (const st of program?.body ?? []) {
		if (st.type !== "ImportDeclaration" || !SOURCES.includes(st.source.value)) continue;
		for (const sp of st.specifiers ?? []) if (sp.type === "ImportSpecifier") f.imports.set(sp.local.name, sp.imported.name ?? sp.imported.value);
	}
	const c = { facts: f } as Ctx;
	visit(program, (n) => {
		if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && n.init) {
			const kind = ctorKind(c, n.init);
			if (kind) (f[kind] as Set<string>).add(n.id.name);
		}
		if ((n.type === "PropertyDefinition" || n.type === "AssignmentExpression") && (n.value ?? n.right)) {
			const kind = ctorKind(c, n.value ?? n.right);
			const name = lastName(n.key ?? n.left);
			if (kind && name) (f[kind] as Set<string>).add(name);
		}
		if (n.type === "Identifier" && f.imports.get(typeName(n) ?? "") === "Job") f.jobs.add(n.name);
		if (n.type === "NewExpression" && ctorKind(c, n) === "workers") {
			const fn = unwrap(n.arguments[1]);
			const p = isFn(fn) ? paramName(fn.params[0]) : null;
			if (p) f.jobs.add(p);
		}
	});
}

/** Facts for the file being narrated, read once per parsed program. */
export function factsReader(): (e: Engine) => Facts {
	const cache = new WeakMap<object, Facts>();
	return (e) => {
		const key = e.program ?? e;
		const hit = cache.get(key);
		if (hit) return hit;
		const facts: Facts = { imports: new Map(), queues: new Set(), workers: new Set(), events: new Set(), flows: new Set(), jobs: new Set() };
		cache.set(key, facts);
		if (e.program) scan(e.program, facts);
		return facts;
	};
}

export const asDoc = (t: string, kids: Line[] = []) => D(t, kids);
