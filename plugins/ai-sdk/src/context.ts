import { D, type Doc, type Line } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import type { AiSdkPhrases, StepScope } from "./phrases";

/** `auto` reads code from either supported major; 6 or 7 pins the meaning of names that changed. */
export type Version = 6 | 7 | "auto";

type Import = { name: string; from: string };

/** Per-file facts: what the file imports from the AI SDK and which locals hold its objects. */
export type FileState = {
	src: string;
	imports: Map<string, Import>;
	/** Locals made by `createOpenAI(...)` and friends -> the provider's import name. */
	providers: Map<string, string>;
	registries: Set<string>;
	agents: Set<string>;
	/** Locals holding a `streamText` / `streamObject` / `agent.stream` result. */
	streams: Set<string>;
	/** Locals destructured from a stream result (`const { textStream } = streamText(...)`) -> the property they hold. */
	streamParts: Map<string, string>;
	/** Locals destructured from `useChat` / `useCompletion` / `useObject` -> the hook's own name for them. */
	hookFns: Map<string, string>;
	/** Locals holding a whole `useChat()` result. */
	chats: Set<string>;
};

export type Ctx = { e: Engine; say: AiSdkPhrases; version: Version; state: FileState };

export const newState = (): FileState => ({
	src: "\0",
	imports: new Map(),
	providers: new Map(),
	registries: new Set(),
	agents: new Set(),
	streams: new Set(),
	streamParts: new Map(),
	hookFns: new Map(),
	chats: new Set(),
});

const IMPORT = /import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
const BINDING = /\b(?:const|let|var)\s+([\w$]+)(?:\s*:[^=]+)?\s*=\s*(?:await\s+)?(new\s+)?([\w$]+)(?:\.([\w$]+))?\s*[(<]/g;

/** Packages whose imports count as the AI SDK. */
export const isSdkSource = (from: string) =>
	from === "ai" || from.startsWith("ai/") || from.startsWith("@ai-sdk/") || from === "@openrouter/ai-sdk-provider" || from === "ollama-ai-provider";

export function resetState(c: Ctx) {
	const s = c.state;
	if (s.src === c.e.src) return;
	Object.assign(s, newState(), { src: c.e.src });
	for (const m of c.e.src.matchAll(IMPORT)) {
		if (!isSdkSource(m[2]!)) continue;
		for (const spec of m[1]!.split(",")) {
			const parts = spec
				.trim()
				.replace(/^type\s+/, "")
				.split(/\s+as\s+/);
			const name = parts[0];
			if (name && !spec.trim().startsWith("type ")) s.imports.set(parts[1] ?? name, { name, from: m[2]! });
		}
	}
	for (const m of c.e.src.matchAll(BINDING)) {
		const [, local, isNew, head, method] = m;
		const imp = s.imports.get(head!);
		if (isNew && imp && AGENT_CLASSES.has(imp.name)) s.agents.add(local!);
		else if (!method && imp && /^create/.test(imp.name) && imp.from !== "ai") s.providers.set(local!, providerKey(imp));
		else if (!method && imp?.name === "createProviderRegistry") s.registries.add(local!);
		else if (!method && imp && (imp.name === "streamText" || imp.name === "streamObject")) s.streams.add(local!);
		else if (method === "stream" && s.agents.has(head!)) s.streams.add(local!);
		else if (!method && imp?.name === "useChat") s.chats.add(local!);
	}
}

export const AGENT_CLASSES = new Set(["ToolLoopAgent", "Experimental_Agent"]);

/** `createOpenAI` from "@ai-sdk/openai" -> "openai"; `createOpenAICompatible` keeps its package name. */
function providerKey(imp: Import): string {
	const pkg = imp.from.replace(/^@ai-sdk\//, "").replace(/^@openrouter\/.*/, "openrouter");
	return pkg.replace(/-ai-provider$/, "");
}

/** The AI SDK export a local names, when the file imports it from one of `sources`. */
export function imported(c: Ctx, local: string, sources: (from: string) => boolean = (f) => f === "ai" || f.startsWith("ai/")): string | null {
	const imp = c.state.imports.get(local);
	return imp && sources(imp.from) ? imp.name : null;
}

export const fromReact = (from: string) => from.startsWith("@ai-sdk/") || from === "ai/react";

export const isFn = (n: N) => {
	const u = unwrap(n);
	return u?.type === "ArrowFunctionExpression" || u?.type === "FunctionExpression";
};

export const keyOf = (p: N): string | null => {
	if (p.computed) return null;
	if (p.key?.type === "Identifier") return p.key.name;
	return p.key?.type === "Literal" ? String(p.key.value) : null;
};

export const literal = (n: N): string | number | boolean | null => {
	const u = unwrap(n);
	return u?.type === "Literal" && u.value !== null && !u.regex ? u.value : null;
};

export const strLit = (n: N): string | null => {
	const v = literal(n);
	return typeof v === "string" ? v : null;
};

export const objectArg = (n: N): N | null => {
	const u = unwrap(n);
	return u?.type === "ObjectExpression" ? u : null;
};

export const findProp = (obj: N | null, key: string): N | null => obj?.properties.find((p: N) => p.type !== "SpreadElement" && keyOf(p) === key) ?? null;

export const propValue = (obj: N | null, ...keys: string[]): N | null => {
	for (const k of keys) {
		const p = findProp(obj, k);
		if (p) return p.value;
	}
	return null;
};

export const identName = (n: N): string | null => {
	const u = unwrap(n);
	return u?.type === "Identifier" ? u.name : null;
};

/** Steps-dependent result fields: v7 made them cover every step. */
export const stepScope = (c: Ctx): StepScope => (c.version === "auto" ? null : c.version === 7 ? "allSteps" : "finalStep");

const looksBoolean = (n: N) => {
	const u = unwrap(n);
	return u?.type === "BinaryExpression" || u?.type === "LogicalExpression" || (u?.type === "UnaryExpression" && u.operator === "!");
};

/** A function's body as lines; an expression body becomes "give back …" or a plain action. */
export function fnBody(e: Engine, fn: N): Line[] {
	if (fn.body.type === "BlockStatement") return e.body(fn.body, 0);
	const ex = unwrap(fn.body);
	const asAction = ex?.type === "CallExpression" && !looksBoolean(ex);
	const stmt = asAction
		? { type: "ExpressionStatement", expression: fn.body, start: fn.body.start, end: fn.body.end }
		: { type: "ReturnStatement", argument: fn.body, start: fn.body.start, end: fn.body.end };
	return e.body(stmt, 0);
}

/** A callback option: its intro with the function body beneath, naming what it's given. */
export function callbackDoc({ e, say, node, intro, given }: Pick<Ctx, "e" | "say"> & { node: N; intro: string; given?: (fn: N) => string[] }): Doc {
	const fn = unwrap(node);
	if (isFn(fn)) {
		const names = given ? given(fn) : fn.params.slice(0, 1).flatMap((p: N) => e.patternNames(p));
		const head = names.length ? say.options.given({ intro, given: e.g.list(names) }) : intro;
		return D(head, fnBody(e, fn));
	}
	const v = e.noun(node);
	return D(say.options.callBy({ intro, fn: v.t }), v.kids);
}

/** "name: value" for an option nobody special-cased. */
export function genericOption({ e, say, prop }: Pick<Ctx, "e" | "say"> & { prop: N }): Doc {
	const key = keyOf(prop);
	const name = key === null ? e.noun(prop.key).t : e.prop(key);
	const v = e.noun(prop.value);
	return D(say.options.option({ name, value: v.t }), v.kids);
}

/** An array literal as "a, b, and c"; anything else as its noun. */
export function listDoc({ e, node, conj = "and" }: { e: Engine; node: N; conj?: "and" | "or" }): Doc {
	const u = unwrap(node);
	if (u?.type !== "ArrayExpression") return e.noun(node);
	const parts = u.elements.filter(Boolean).map((x: N) => e.noun(x));
	return D(
		e.g.list(
			parts.map((p: Doc) => p.t),
			conj,
		),
		parts.flatMap((p: Doc) => p.kids),
	);
}
