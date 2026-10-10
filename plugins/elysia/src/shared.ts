import { D, type Doc, type Line, mk } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import type { ElysiaPhrases } from "./phrases";

export type Version = 1 | 2 | "auto";

/** What the current file tells us about Elysia: imports, app and client variables. */
export type FileState = {
	src: string;
	/** Local name -> module it's imported from. */
	imports: Map<string, string>;
	/** Variables holding an Elysia app (`const app = new Elysia()`, `(app: Elysia) =>`, group callbacks). */
	apps: Set<string>;
	/** Variables holding an Eden treaty client. */
	clients: Set<string>;
	/** Names the JWT plugin is registered under (`jwt({ name: "auth" })`). */
	jwtNames: Set<string>;
};

export type Ctx = { e: Engine; say: ElysiaPhrases; version: Version; state: FileState };

export const newState = (): FileState => ({ src: "\0", imports: new Map(), apps: new Set(), clients: new Set(), jwtNames: new Set() });

const IMPORT = /import\s+(?:type\s+)?([\w$\s{},*]+?)\s+from\s+["']([^"']+)["']/g;

function importsOf(src: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const [, clause, mod] of src.matchAll(IMPORT)) {
		const named = /\{([^}]*)\}/.exec(clause!)?.[1] ?? "";
		for (const part of named.split(",")) {
			const local = part
				.trim()
				.replace(/^type\s+/, "")
				.split(/\s+as\s+/)
				.at(-1)
				?.trim();
			if (local) out.set(local, mod!);
		}
		const rest = clause!.replace(/\{[^}]*\}/, "").replace(/\*\s+as\s+/, "");
		for (const name of rest.split(",").map((s) => s.trim())) if (/^[\w$]+$/.test(name)) out.set(name, mod!);
	}
	return out;
}

/** Re-reads the file-level facts when the engine moves to a new source. */
export function refresh(c: Ctx) {
	const s = c.state;
	if (s.src === c.e.src) return;
	s.src = c.e.src;
	s.imports = importsOf(s.src);
	s.apps = new Set([
		...[...s.src.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*(?::[^=]*)?=\s*new\s+Elysia\b/g)].map((m) => m[1]!),
		...[...s.src.matchAll(/([\w$]+)\??\s*:\s*Elysia\b/g)].map((m) => m[1]!),
	]);
	s.clients = new Set([...s.src.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*(?::[^=]*)?=\s*(?:treaty|edenTreaty)\s*[<(]/g)].map((m) => m[1]!));
	s.jwtNames = new Set(["jwt", ...[...s.src.matchAll(/\bjwt\s*\(\s*\{[^}]*?\bname\s*:\s*["']([\w$]+)["']/g)].map((m) => m[1]!)]);
}

export const isElysiaModule = (m: string | undefined) => !!m && /^elysia(\/.*)?$/.test(m);
export const isPluginModule = (m: string | undefined, name: string) => !!m && new RegExp(`^@elysiajs?/${name}$`).test(m);
export const importsElysia = (c: Ctx) => [...c.state.imports.values()].some(isElysiaModule);

/** `t` from Elysia, or `Type` / `t` from TypeBox. */
export const isTypeBox = (c: Ctx, name: string) => {
	const m = c.state.imports.get(name);
	return isElysiaModule(m) || m === "@sinclair/typebox" || m === "typebox";
};

export type Step = { m: string; args: N[]; node: N };

/** `a.b(x).c(y)` -> root `a`, steps `[b(x), c(y)]`. */
export function chainOf(node: N): { root: N; steps: Step[] } {
	const steps: Step[] = [];
	let cur = unwrap(node);
	while (cur?.type === "CallExpression" && unwrap(cur.callee)?.type === "MemberExpression" && !unwrap(cur.callee).computed) {
		const c = unwrap(cur.callee);
		steps.unshift({ m: c.property.name, args: cur.arguments, node: cur });
		cur = unwrap(c.object);
	}
	return { root: cur, steps };
}

export const isFn = (n: N) => ["ArrowFunctionExpression", "FunctionExpression"].includes(unwrap(n)?.type);

export const keyOf = (p: N): string | null => {
	if (p?.type !== "Property" || p.computed) return null;
	if (p.key.type === "Identifier") return p.key.name;
	return p.key.type === "Literal" ? String(p.key.value) : null;
};

export const literal = (n: N): string | number | boolean | null => {
	const u = unwrap(n);
	return u?.type === "Literal" && u.value !== null && !u.regex ? u.value : null;
};

export const stringLit = (n: N): string | null => {
	const v = literal(n);
	if (typeof v === "string") return v;
	const u = unwrap(n);
	return u?.type === "TemplateLiteral" && !u.expressions.length ? u.quasis[0].value.cooked : null;
};

export const objectArg = (n: N): N | null => (unwrap(n)?.type === "ObjectExpression" ? unwrap(n) : null);

export const findProp = (obj: N | null, key: string): N | null => obj?.properties.find((p: N) => keyOf(p) === key) ?? null;

/** A lambda's single returned expression, or null when it has a statement body. */
export function fnResult(fn: N): N | null {
	const f = unwrap(fn);
	if (f.body.type !== "BlockStatement") return f.body;
	const only = f.body.body.length === 1 ? f.body.body[0] : null;
	return only?.type === "ReturnStatement" ? only.argument : null;
}

/** Handler-context calls that build the reply; an arrow returning one reads as "reply with …". */
export const REPLY_CALLS = new Set(["status", "error", "problem", "redirect"]);

/** A function's body as lines; an expression body reads as an action when it's a call, else "give back …". */
export function fnBody(e: Engine, fn: N): Line[] {
	const f = unwrap(fn);
	if (f.body.type === "BlockStatement") return e.body(f.body, 0);
	const call = unwrap(f.body);
	const replies = call?.type === "CallExpression" && REPLY_CALLS.has(unwrap(call.callee)?.name);
	const asAction = call?.type === "CallExpression" && !replies && !e.looksBoolean(f.body);
	const at = { start: f.body.start, end: f.body.end };
	return e.body(asAction ? { type: "ExpressionStatement", expression: f.body, ...at } : { type: "ReturnStatement", argument: f.body, ...at }, 0);
}

/** A callback (`intro` + its steps), or "intro, run fn" when it's passed by name. */
export function callbackDoc({ e, say, node, intro }: Pick<Ctx, "e" | "say"> & { node: N; intro: string }): Doc {
	if (isFn(node)) return D(intro, fnBody(e, node));
	const v = e.noun(node);
	return D(say.hooks.callBy({ intro, fn: v.t }), v.kids);
}

/** Several docs as one list phrase, block lines kept. */
export const listDoc = (e: Engine, docs: Doc[], conj: "and" | "or" = "and"): Doc =>
	D(
		e.g.list(
			docs.map((d) => d.t),
			conj,
		),
		docs.flatMap((d) => d.kids),
	);

export const bullets = (e: Engine, docs: Doc[]): Line[] => docs.flatMap((d) => e.bullet(d));

/** An HTTP method as shown to the reader: `get` -> `GET`. */
export const methodText = (m: string) => mk("l", m.toUpperCase());

/** "name: value" for an option the plugin doesn't interpret. */
export function optionDoc({ e, prop, phrase }: { e: Engine; prop: N; phrase: (p: { name: string; value: string }) => string }): Doc {
	if (prop.type === "SpreadElement") return e.noun(prop);
	const key = keyOf(prop);
	const v = e.noun(prop.value);
	return D(phrase({ name: key === null ? e.text(prop.key) : e.prop(key), value: v.t }), v.kids);
}
