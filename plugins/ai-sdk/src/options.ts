import { D, type Doc, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, callbackDoc, genericOption, keyOf, listDoc, objectArg, stepScope, strLit } from "./context";
import type { CallbackOption, ResultField, StepField, StepScope } from "./phrases";
import { toolsDoc } from "./tools";

/** Renders one option's value; null falls back to the generic "name: value". */
export type Spec = (c: Ctx, node: N) => Doc | Doc[] | null;
export type Specs = Record<string, Spec>;

/** Option and export names that only exist in one major: dropped (read generically) when the other is pinned. `legacy` is pre-v6 and read only in auto mode. */
const ONLY: Record<string, 6 | 7 | "legacy"> = {
	isStepCount: 7,
	transcribe: 7,
	generateSpeech: 7,
	toUIMessageStream: 7,
	toTextStream: 7,
	experimental_generateImage: 6,
	experimental_customProvider: 6,
	convertToCoreMessages: "legacy",
	onEnd: 7,
	onStepEnd: 7,
	onStart: 7,
	onStepStart: 7,
	onToolExecutionStart: 7,
	onToolExecutionEnd: 7,
	toolApproval: 7,
	runtimeContext: 7,
	toolsContext: 7,
	contextSchema: 7,
	telemetry: 7,
	repairToolCall: 7,
	experimental_output: 6,
	experimental_activeTools: 6,
	experimental_prepareStep: 6,
	experimental_context: 6,
	maxSteps: "legacy",
	maxTokens: "legacy",
	parameters: "legacy",
};

export const versionHas = (c: Ctx, key: string) => {
	const only = ONLY[key];
	if (!only || c.version === "auto") return true;
	return only === c.version;
};

/** Every property of an object literal, rendered by its spec (or generically when unknown). */
export function optionDocs(c: Ctx, { node, specs, skip = [] }: { node: N; specs: Specs; skip?: string[] }): Doc[] {
	const { e, say } = c;
	const o = objectArg(node);
	if (!o) {
		if (!node) return [];
		const v = e.noun(node);
		return [D(say.options.everythingIn({ value: v.t }), v.kids)];
	}
	return o.properties.flatMap((p: N): Doc[] => {
		if (p.type === "SpreadElement") {
			const v = e.noun(p.argument);
			return [D(say.options.everythingIn({ value: v.t }), v.kids)];
		}
		const key = keyOf(p);
		if (key !== null && skip.includes(key)) return [];
		const spec = key !== null && versionHas(c, key) ? specs[key] : undefined;
		const r = spec?.(c, p.value);
		if (!r) return [genericOption({ e, say, prop: p })];
		return Array.isArray(r) ? r : [r];
	});
}

const value =
	(pick: (s: Ctx["say"]) => (p: { value: string }) => string): Spec =>
	(c, node) => {
		const v = c.e.noun(node);
		return D(pick(c.say)({ value: v.t }), v.kids);
	};

const count =
	(pick: (s: Ctx["say"]) => (p: { count: string; n: number | null }) => string): Spec =>
	(c, node) => {
		const n = c.e.fold(node);
		if (n !== null) return D(pick(c.say)({ count: mk("l", c.e.g.formatNumber(n)), n }));
		const v = c.e.noun(node);
		return D(pick(c.say)({ count: v.t, n: null }), v.kids);
	};

const items =
	(pick: (s: Ctx["say"]) => (p: { items: string }) => string): Spec =>
	(c, node) => {
		const l = listDoc({ e: c.e, node, conj: "or" });
		return D(pick(c.say)({ items: l.t }), l.kids);
	};

/** A list of tool names: `activeTools: ['weather', 'search']`. */
const toolNames =
	(pick: (s: Ctx["say"]) => (p: { items: string }) => string): Spec =>
	(c, node) => {
		const u = unwrap(node);
		if (u?.type !== "ArrayExpression") return value((s) => (p) => pick(s)({ items: p.value }))(c, node);
		const names = u.elements.map((x: N) => {
			const s = strLit(x);
			return s === null ? c.e.noun(x).t : c.e.prop(s);
		});
		return D(pick(c.say)({ items: c.e.g.list(names) }));
	};

/** Result field names (`text`, `usage`) as phrases; step fields name the steps they cover. */
export function resultName(c: Ctx, key: string, scope: StepScope): string {
	const r = c.say.results;
	if (key in r.stepFields) return r.scoped({ thing: r.stepFields[key as StepField], scope });
	if (key in r.fields) return r.fields[key as ResultField];
	return c.e.prop(key);
}

/** `{ text, usage: tokens }` -> "text and token usage (as tokens)". */
export function resultNames(c: Ctx, pattern: N, scope: StepScope): string[] {
	if (pattern?.type !== "ObjectPattern") return pattern ? c.e.patternNames(pattern) : [];
	return pattern.properties.flatMap((p: N) => {
		if (p.type === "RestElement") return c.e.patternNames(p.argument);
		const key = keyOf(p);
		if (key === null) return c.e.patternNames(p.value);
		const thing = resultName(c, key, scope);
		const v = p.value.type === "AssignmentPattern" ? p.value.left : p.value;
		if (v.type !== "Identifier" || v.name === key) return [thing];
		return [c.say.results.renamed({ thing, name: c.e.ref(v.name) })];
	});
}

export const callback =
	(key: CallbackOption, given?: (c: Ctx) => StepScope): Spec =>
	(c, node) =>
		callbackDoc({
			e: c.e,
			say: c.say,
			node,
			intro: c.say.options.callbacks[key],
			given: given ? (fn) => resultNames(c, fn.params[0], given(c)) : undefined,
		});

/** `onChunk`: v7 hands it every stream part; earlier versions only content chunks. */
const onChunk: Spec = (c, node) => {
	const which = c.version === "auto" ? "any" : c.version === 7 ? "every" : "subset";
	return callbackDoc({ e: c.e, say: c.say, node, intro: c.say.options.onChunk[which] });
};

const TOOL_CHOICES = ["auto", "required", "none"] as const;

const toolChoice: Spec = (c, node) => {
	const s = strLit(node);
	const tc = c.say.toolChoice;
	if (s !== null) return (TOOL_CHOICES as readonly string[]).includes(s) ? D(tc[s as (typeof TOOL_CHOICES)[number]]) : null;
	const o = objectArg(node);
	const name = strLit(o?.properties.find((p: N) => keyOf(p) === "toolName")?.value);
	return name === null ? null : D(tc.tool({ tool: c.e.prop(name) }));
};

/** `stopWhen`: one condition, or a list where any one stops the loop. */
const stopWhen: Spec = (c, node) => {
	const u = unwrap(node);
	if (u?.type === "ArrayExpression")
		return D(
			c.say.stop.anyOf,
			u.elements.flatMap((x: N) => c.e.bullet(c.e.noun(x))),
		);
	if (u?.type === "CallExpression" && c.e.applyRulesQuiet(u)) return c.e.noun(u);
	const v = c.e.noun(node);
	return D(c.say.stop.custom({ value: v.t }), v.kids);
};

/** `experimental_transform: smoothStream()` reads as what it does; other transforms by name. */
const transform: Spec = (c, node) => {
	const u = unwrap(node);
	const list: N[] = u?.type === "ArrayExpression" ? u.elements.filter(Boolean) : [u];
	return list.map((x) => {
		const v = c.e.noun(x);
		return unwrap(x)?.type === "CallExpression" && c.e.applyRulesQuiet(unwrap(x)) ? v : D(c.say.options.transform({ value: v.t }), v.kids);
	});
};

export const schemaDoc = (c: Ctx, node: N): Doc => {
	const t = c.e.schemaText(node);
	return t ? D(t) : c.e.noun(node);
};

const schema: Spec = (c, node) => {
	const s = schemaDoc(c, node);
	return D(c.say.options.schema({ value: s.t }), s.kids);
};

/** Options every model call shares. */
export const coreSpecs = (): Specs => ({
	system: value((s) => s.options.instructions),
	instructions: value((s) => s.options.instructions),
	prompt: value((s) => s.options.prompt),
	messages: value((s) => s.options.messages),
	tools: (c, node) => toolsDoc(c, node),
	toolChoice,
	activeTools: toolNames((s) => s.options.activeTools),
	experimental_activeTools: toolNames((s) => s.options.activeTools),
	stopWhen,
	maxSteps: count((s) => s.options.maxSteps),
	temperature: value((s) => s.options.temperature),
	maxOutputTokens: count((s) => s.options.maxOutputTokens),
	maxTokens: count((s) => s.options.maxOutputTokens),
	topP: value((s) => s.options.topP),
	topK: value((s) => s.options.topK),
	seed: value((s) => s.options.seed),
	presencePenalty: value((s) => s.options.presencePenalty),
	frequencyPenalty: value((s) => s.options.frequencyPenalty),
	stopSequences: items((s) => s.options.stopSequences),
	maxRetries: count((s) => s.options.maxRetries),
	abortSignal: value((s) => s.options.abortSignal),
	timeout: value((s) => s.options.timeout),
	headers: value((s) => s.options.headers),
	providerOptions: value((s) => s.options.providerOptions),
	reasoning: value((s) => s.options.reasoning),
	telemetry: value((s) => s.options.telemetry),
	experimental_telemetry: value((s) => s.options.telemetry),
	runtimeContext: value((s) => s.options.runtimeContext),
	experimental_context: value((s) => s.options.runtimeContext),
	toolsContext: value((s) => s.options.toolsContext),
	toolApproval: value((s) => s.options.toolApproval),
	experimental_transform: transform,
	output: (c, node) => {
		const v = c.e.noun(node);
		return D(c.say.options.answerAs({ value: v.t }), v.kids);
	},
	experimental_output: (c, node) => coreSpecs().output!(c, node),
	onFinish: callback("onFinish", stepScope),
	onEnd: callback("onFinish", stepScope),
	onStepFinish: callback("onStepFinish", () => null),
	onStepEnd: callback("onStepFinish", () => null),
	onChunk,
	onError: callback("onError"),
	onAbort: callback("onAbort"),
	onStart: callback("onStart"),
	experimental_onStart: callback("onStart"),
	onStepStart: callback("onStepStart"),
	experimental_onStepStart: callback("onStepStart"),
	prepareStep: callback("prepareStep"),
	experimental_prepareStep: callback("prepareStep"),
	repairToolCall: callback("repairToolCall"),
	experimental_repairToolCall: callback("repairToolCall"),
	onToolExecutionStart: callback("onToolExecutionStart"),
	experimental_onToolCallStart: callback("onToolExecutionStart"),
	onToolExecutionEnd: callback("onToolExecutionEnd"),
	experimental_onToolCallFinish: callback("onToolExecutionEnd"),
});

/** `generateObject` / `streamObject`: the shape comes from `schema`, `output`, and `enum` together. */
export const objectSpecs = (): Specs => ({
	...coreSpecs(),
	schema,
	schemaName: value((s) => s.options.schemaName),
	schemaDescription: value((s) => s.options.schemaDescription),
	output: (c, node) => {
		const s = strLit(node);
		if (s === "no-schema") return D(c.say.options.noSchema);
		return s === "array" || s === "enum" || s === "object" ? [] : null;
	},
	enum: items((s) => s.options.enumValues),
});

/** `generateObject({ output: 'array', schema })` reads the schema as a list's item shape. */
export function arraySchema(c: Ctx, opts: N): Doc | null {
	const o = objectArg(opts);
	const out = strLit(o?.properties.find((p: N) => keyOf(p) === "output")?.value);
	const sch = o?.properties.find((p: N) => keyOf(p) === "schema")?.value;
	if (out !== "array" || !sch) return null;
	const s = schemaDoc(c, sch);
	return D(c.say.options.arrayOf({ value: s.t }), s.kids);
}

export const embedSpecs = (): Specs => {
	const core = coreSpecs();
	return {
		maxRetries: core.maxRetries!,
		abortSignal: core.abortSignal!,
		headers: core.headers!,
		providerOptions: core.providerOptions!,
		maxParallelCalls: count((s) => s.options.maxParallelCalls),
		telemetry: core.telemetry!,
		experimental_telemetry: core.telemetry!,
	};
};

export const mediaSpecs = (): Specs => {
	const core = coreSpecs();
	return {
		...embedSpecs(),
		prompt: core.prompt!,
		size: value((s) => s.options.size),
		aspectRatio: value((s) => s.options.aspectRatio),
		seed: core.seed!,
		audio: value((s) => s.options.audio),
		text: value((s) => s.options.text),
		voice: value((s) => s.options.voice),
		language: value((s) => s.options.language),
		speed: value((s) => s.options.speed),
		outputFormat: value((s) => s.options.outputFormat),
		instructions: core.instructions!,
	};
};
