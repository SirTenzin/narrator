import { D, type Doc, type Line, lowerFirst, mk } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import type { InngestPhrases } from "./phrases";
import { durationText } from "./time";

/** What this file binds from Inngest: imported names, client variables, and `eventType` constants with their event names. */
export type Facts = {
	imports: Map<string, { name: string; from: string }>;
	clients: Set<string>;
	eventTypes: Map<string, string>;
};

export type Ctx = { e: Engine; say: InngestPhrases; facts: Facts };
export type Site = { node: N; args: N[]; obj: N | null; stmt: boolean };
export type Rule = (c: Ctx, site: Site) => Doc | null;

const isSource = (s: string) => s === "inngest" || s.startsWith("inngest/");
export const usesInngest = (e: Engine) => e.usesLibrary("inngest");

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
export const perDur = (c: Ctx, n: N) => durationText({ e: c.e, time: c.say.time }, n, "ms", true);

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

/** A callback whose steps fit on one line, as that line's text (lowercased, no full stop); otherwise null. */
export function oneLine(e: Engine, fn: N): string | null {
	const f = unwrap(fn);
	const only = f.body.type === "BlockStatement" && f.body.body.length === 1 ? f.body.body[0] : null;
	const value = f.body.type !== "BlockStatement" ? f.body : only?.type === "ReturnStatement" && only.argument ? only.argument : null;
	const lines = value ? e.body({ type: "ExpressionStatement", expression: value, start: value.start, end: value.end }, 0) : e.body(f.body, 0);
	if (lines.length !== 1 || lines[0]!.text.endsWith(":")) return null;
	return lowerFirst(lines[0]!.text.replace(/\.$/, ""));
}

/** The Inngest export a callee was imported as (`serve`, `eventType`), with its module. */
export function importedAs(c: Ctx, callee: N): { name: string; from: string } | null {
	const u = unwrap(callee);
	return u?.type === "Identifier" ? (c.facts.imports.get(u.name) ?? null) : null;
}

const lastName = (n: N): string | null => {
	const u = unwrap(n);
	if (u?.type === "Identifier") return u.name;
	if (u?.type === "MemberExpression" && !u.computed) return u.property.name;
	return null;
};

/** An Inngest client: a `new Inngest(…)` variable here, or anything named like one in a file that uses Inngest. */
export const isClient = (c: Ctx, n: N | null): boolean => {
	if (!n || !usesInngest(c.e)) return false;
	const name = lastName(n);
	return !!name && (c.facts.clients.has(name) || /inngest$/i.test(name));
};

/** An event name: `"app/user.created"` or an `eventType` constant, as code. */
export function eventName(c: Ctx, n: N): string {
	const u = unwrap(n);
	if (u?.type === "Identifier" && c.facts.eventTypes.has(u.name)) return mk("c", c.facts.eventTypes.get(u.name)!);
	return codeText(c, n);
}

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
		for (const sp of st.specifiers ?? [])
			if (sp.type === "ImportSpecifier") f.imports.set(sp.local.name, { name: sp.imported.name ?? sp.imported.value, from: st.source.value });
	}
	visit(program, (n) => {
		if (n.type !== "VariableDeclarator" || n.id.type !== "Identifier") return;
		const init = unwrap(n.init);
		const callee = unwrap(init?.callee);
		const imported = callee?.type === "Identifier" ? f.imports.get(callee.name)?.name : null;
		if (init?.type === "NewExpression" && imported === "Inngest") f.clients.add(n.id.name);
		const name = init?.type === "CallExpression" && imported === "eventType" ? str(init.arguments[0]) : null;
		if (name) f.eventTypes.set(n.id.name, name);
	});
}

/** Facts for the file being narrated, read once per parsed program. */
export function factsReader(): (e: Engine) => Facts {
	const cache = new WeakMap<object, Facts>();
	return (e) => {
		const key = e.program ?? e;
		const hit = cache.get(key);
		if (hit) return hit;
		const facts: Facts = { imports: new Map(), clients: new Set(), eventTypes: new Map() };
		cache.set(key, facts);
		if (e.program) scan(e.program, facts);
		return facts;
	};
}
