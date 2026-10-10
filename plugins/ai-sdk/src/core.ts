import { D, type Doc, type Line, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { AGENT_CLASSES, type Ctx, fnBody, identName, imported, isFn, objectArg, propValue, strLit } from "./context";
import { customProviderDoc, MODEL_METHOD_NAMES, modelDoc, providerLabel, providerModelDoc, providerSetupDoc, registryDoc, wrappedModelDoc } from "./models";
import { arraySchema, callback, coreSpecs, embedSpecs, mediaSpecs, objectSpecs, optionDocs, type Specs, schemaDoc, versionHas } from "./options";
import { providerToolDoc, toolDoc } from "./tools";

export type Site = { node: N; args: N[]; obj: N | null; stmt: boolean };
export type Render = (c: Ctx, site: Site) => Doc | null;

/** The SDK export behind a call's callee, if the file imports it and the pinned version has it. */
export function sdkName(c: Ctx, node: N, sources?: (from: string) => boolean): string | null {
	const local = identName(unwrap(node).callee);
	const name = local ? imported(c, local, sources) : null;
	return name && versionHas(c, name) ? name : null;
}

const bullets = (c: Ctx, docs: Doc[]) => docs.flatMap((d) => c.e.bullet(d));

/** Model calls, keyed by their export name (old experimental names map to the stable one). */
const MODEL_CALLS = {
	generateText: "generateText",
	streamText: "streamText",
	generateObject: "generateObject",
	streamObject: "streamObject",
	embed: "embed",
	embedMany: "embedMany",
	generateImage: "generateImage",
	experimental_generateImage: "generateImage",
	transcribe: "transcribe",
	experimental_transcribe: "transcribe",
	generateSpeech: "generateSpeech",
	experimental_generateSpeech: "generateSpeech",
	rerank: "rerank",
} as const;
export const MODEL_CALL_NAMES = new Set(Object.keys(MODEL_CALLS));
type Canonical = (typeof MODEL_CALLS)[keyof typeof MODEL_CALLS];

/** Options a call folds into its own sentence ("turn X into speech") instead of listing. */
const HEAD: Partial<Record<Canonical, string[]>> = {
	embed: ["value"],
	embedMany: ["values"],
	generateImage: ["n"],
	transcribe: ["audio"],
	generateSpeech: ["text"],
	rerank: ["documents", "query"],
};

const specsFor = (kind: Canonical): Specs => SPECS[kind]();
const SPECS: Record<Canonical, () => Specs> = {
	generateText: coreSpecs,
	streamText: coreSpecs,
	generateObject: objectSpecs,
	streamObject: objectSpecs,
	embed: embedSpecs,
	embedMany: embedSpecs,
	generateImage: mediaSpecs,
	transcribe: mediaSpecs,
	generateSpeech: mediaSpecs,
	rerank: embedSpecs,
};

/** `generateText({ model, prompt, ... })` and the other model calls: one sentence, options as bullets. */
const modelCall: Render = (c, { node, stmt }) => {
	const name = sdkName(c, node);
	if (!name || !(name in MODEL_CALLS)) return null;
	const kind = MODEL_CALLS[name as keyof typeof MODEL_CALLS];
	const { e, say } = c;
	const arg = node.arguments[0];
	const opts = objectArg(arg);
	const model = modelDoc(c, propValue(opts, "model"));
	const head: Record<string, string | number | null> = { model: model.t };
	const headKids: Line[] = [];
	for (const key of HEAD[kind] ?? []) {
		const v = propValue(opts, key);
		if (key === "n") {
			const n = v ? e.fold(v) : null;
			head.n = n;
			head.count = !v ? null : n === null ? e.text(v) : mk("l", e.g.formatNumber(n));
			continue;
		}
		const d = v ? e.noun(v) : D(say.models.unknown);
		head[key] = d.t;
		headKids.push(...d.kids);
	}
	const asArray = kind === "generateObject" || kind === "streamObject" ? arraySchema(c, opts) : null;
	const skip = ["model", ...(HEAD[kind] ?? []), ...(asArray ? ["schema"] : [])];
	const opts2 = opts ? optionDocs(c, { node: opts, specs: specsFor(kind), skip }) : arg ? optionDocs(c, { node: arg, specs: {} }) : [];
	// Each call's phrase reads the head keys it declares; HEAD and the phrase types are kept in step.
	const forms = say.calls[kind] as { act: (p: typeof head) => string; noun: (p: typeof head) => string };
	return D(forms[stmt ? "act" : "noun"](head), [...model.kids, ...headKids, ...bullets(c, [...(asArray ? [asArray] : []), ...opts2])]);
};

/** `Output.object({ schema })` and friends, as the shape of the answer. */
const outputRule =
	(kind: "object" | "array" | "choice" | "text" | "json"): Render =>
	(c, { args, obj }) => {
		if (!obj || imported(c, identName(obj) ?? "") !== "Output") return null;
		const { e, say } = c;
		const opts = objectArg(args[0]);
		const name = strLit(propValue(opts, "name"));
		const named = (d: Doc) => (name === null ? d : D(say.output.named({ shape: d.t, name: mk("l", name) }), d.kids));
		if (kind === "text") return D(say.output.text);
		if (kind === "json") return named(D(say.output.json));
		if (kind === "choice") {
			const o = unwrap(propValue(opts, "options"));
			const items =
				o?.type === "ArrayExpression"
					? e.g.list(
							o.elements.map((x: N) => e.text(x)),
							"or",
						)
					: o
						? e.text(o)
						: "";
			return named(D(say.output.choice({ items })));
		}
		const s = propValue(opts, kind === "array" ? "element" : "schema");
		if (!s) return null;
		const d = schemaDoc(c, s);
		return named(D(say.output[kind]({ value: d.t }), d.kids));
	};

const stopRule =
	(names: string[], render: (c: Ctx, arg: N) => Doc | null): Render =>
	(c, { node, args }) => {
		const name = sdkName(c, node);
		return name && names.includes(name) && args[0] ? render(c, args[0]) : null;
	};

const stepCount = stopRule(["stepCountIs", "isStepCount"], (c, arg) => {
	const n = c.e.fold(arg);
	if (n !== null) return D(c.say.stop.stepCount({ count: mk("l", c.e.g.formatNumber(n)), n }));
	const v = c.e.noun(arg);
	return D(c.say.stop.stepCount({ count: v.t, n: null }), v.kids);
});

const toolCalled = stopRule(["hasToolCall"], (c, arg) => {
	const s = strLit(arg);
	return D(c.say.stop.toolCalled({ tool: s === null ? c.e.text(arg) : c.e.prop(s) }));
});

const simple =
	(names: string[], render: (c: Ctx, site: Site) => Doc | null): Render =>
	(c, site) => {
		const name = sdkName(c, site.node);
		return name && names.includes(name) ? render(c, site) : null;
	};

const valueOf = (c: Ctx, n: N | null | undefined): Doc => (n ? c.e.noun(n) : D(c.say.models.unknown));

/** A stream-result method (`result.toUIMessageStreamResponse()`); only in files that use the AI SDK. */
const streamMethod =
	(pick: (s: Ctx["say"]) => (p: { value: string }) => string, legacy = false): Render =>
	(c, { obj, args }) => {
		if (!obj || !c.state.imports.size || (legacy && c.version !== "auto")) return null;
		const v = c.e.noun(obj);
		const opts = optionDocs(c, { node: args[0], specs: { onFinish: callback("onFinish") } });
		return D(pick(c.say)({ value: v.t }), [...v.kids, ...bullets(c, opts)]);
	};

const pipeMethod =
	(pick: (s: Ctx["say"]) => (p: { source: string; response: string }) => string): Render =>
	(c, { obj, args }) => {
		if (!obj || !c.state.imports.size || !args[0]) return null;
		const v = c.e.noun(obj);
		return D(pick(c.say)({ source: v.t, response: c.e.text(args[0]) }), v.kids);
	};

/** `agent.generate({ prompt })` / `agent.stream(...)` on a local made with `new ToolLoopAgent(...)`. */
const agentRun =
	(kind: "generate" | "stream"): Render =>
	(c, { obj, args, stmt }) => {
		const agent = identName(obj);
		if (!agent || !c.state.agents.has(agent)) return null;
		const { e, say } = c;
		const opts = objectArg(args[0]);
		const promptNode = propValue(opts, "prompt");
		const p = promptNode && opts.properties.length === 1 ? e.noun(promptNode) : null;
		const text = say.agents[kind][stmt ? "act" : "noun"]({ agent: e.ref(agent), prompt: p ? p.t : null });
		if (p) return D(text, p.kids);
		return D(text, bullets(c, optionDocs(c, { node: args[0], specs: coreSpecs() })));
	};

/** `new ToolLoopAgent({ model, instructions, tools })`. */
const agentClass: Render = (c, { node }) => {
	const local = identName(node.callee);
	if (!local || !AGENT_CLASSES.has(imported(c, local) ?? "")) return null;
	const opts = objectArg(node.arguments[0]);
	const model = modelDoc(c, propValue(opts, "model"));
	const docs = optionDocs(c, { node: opts ?? node.arguments[0], specs: coreSpecs(), skip: ["model"] });
	if (!propValue(opts, "stopWhen")) docs.push(D(c.say.stop.agentDefault));
	return D(c.say.agents.agent({ model: model.t }), [...model.kids, ...bullets(c, docs)]);
};

/** Top-level stream helpers that take `{ stream }` (v7) or `{ agent }`. */
const streamHelper =
	(names: string[], pick: (s: Ctx["say"]) => (p: { value: string }) => string, key = "stream"): Render =>
	(c, site) => {
		const name = sdkName(c, site.node);
		if (!name || !names.includes(name)) return null;
		const opts = objectArg(site.args[0]);
		const v = valueOf(c, propValue(opts, key) ?? (opts ? null : site.args[0]));
		const rest = opts ? optionDocs(c, { node: opts, specs: { onFinish: callback("onFinish") }, skip: [key, "response"] }) : [];
		return D(pick(c.say)({ value: v.t }), [...v.kids, ...bullets(c, rest)]);
	};

/** `createUIMessageStream({ execute: ({ writer }) => { ... } })`: what the stream writes, as steps. */
const createUiStream = simple(["createUIMessageStream"], (c, { args }) => {
	const opts = objectArg(args[0]);
	const exec = unwrap(propValue(opts, "execute"));
	const body = isFn(exec) ? fnBody(c.e, exec) : [];
	const rest = optionDocs(c, { node: opts, specs: { onFinish: callback("onFinish"), onError: callback("onError") }, skip: ["execute"] });
	return D(c.say.responses.createUiStream, [...body, ...bullets(c, rest)]);
});

const PROVIDER_NAMES = Object.keys({
	openai: 1,
	anthropic: 1,
	google: 1,
	vertex: 1,
	xai: 1,
	mistral: 1,
	groq: 1,
	deepseek: 1,
	perplexity: 1,
	cohere: 1,
	bedrock: 1,
	azure: 1,
	togetherai: 1,
	fireworks: 1,
	cerebras: 1,
	deepinfra: 1,
	elevenlabs: 1,
	deepgram: 1,
	assemblyai: 1,
	fal: 1,
	luma: 1,
	replicate: 1,
	openrouter: 1,
	ollama: 1,
	gateway: 1,
});

const PROVIDER_FACTORIES = [
	"createOpenAI",
	"createAnthropic",
	"createGoogleGenerativeAI",
	"createGoogle",
	"createVertex",
	"createXai",
	"createMistral",
	"createGroq",
	"createDeepSeek",
	"createPerplexity",
	"createCohere",
	"createAmazonBedrock",
	"createAzure",
	"createTogetherAI",
	"createFireworks",
	"createCerebras",
	"createDeepInfra",
	"createOpenAICompatible",
	"createOpenRouter",
	"createOllama",
	"createElevenLabs",
	"createDeepgram",
	"createGateway",
];

const providerFactory: Render = (c, { node }) => {
	const local = identName(node.callee);
	const imp = local ? c.state.imports.get(local) : undefined;
	if (!imp) return null;
	return providerSetupDoc(c, node, imp.name, imp.from);
};

const PROVIDER_TOOLS = [
	"webSearch",
	"webSearchPreview",
	"webSearch_20250305",
	"webFetch_20250910",
	"fileSearch",
	"codeInterpreter",
	"imageGeneration",
	"localShell",
	"googleSearch",
	"urlContext",
	"codeExecution",
	"computer_20250124",
	"bash_20250124",
	"textEditor_20250124",
	"xSearch",
];

const providerTool: Render = (c, { node, obj }) => {
	const tools = unwrap(obj);
	const owner = tools?.type === "MemberExpression" ? identName(tools.object) : null;
	const provider = owner ? providerLabel(c, owner) : null;
	return provider ? providerToolDoc(c, node, provider) : null;
};

/** Built on demand so importing this module does no work. */
export const coreCalls = (): Record<string, Render> => ({
	...Object.fromEntries([...MODEL_CALL_NAMES].map((k) => [k, modelCall])),
	...Object.fromEntries(PROVIDER_NAMES.map((k) => [k, (c, { node }) => providerModelDoc(c, node)] as [string, Render])),
	...Object.fromEntries(MODEL_METHOD_NAMES.map((k) => [`*.${k}`, (c, { node }) => providerModelDoc(c, node)] as [string, Render])),
	...Object.fromEntries(PROVIDER_FACTORIES.map((k) => [k, providerFactory])),
	...Object.fromEntries(PROVIDER_TOOLS.map((k) => [`*.tools.${k}`, providerTool])),
	createProviderRegistry: simple(["createProviderRegistry", "experimental_createProviderRegistry"], (c, { node }) => registryDoc(c, node)),
	experimental_createProviderRegistry: simple(["experimental_createProviderRegistry"], (c, { node }) => registryDoc(c, node)),
	customProvider: simple(["customProvider", "experimental_customProvider"], (c, { node }) => customProviderDoc(c, node)),
	experimental_customProvider: simple(["experimental_customProvider"], (c, { node }) => customProviderDoc(c, node)),
	wrapLanguageModel: simple(["wrapLanguageModel"], (c, { node }) => wrappedModelDoc(c, node)),
	tool: simple(["tool"], (c, { node }) => toolDoc(c, node, false)),
	dynamicTool: simple(["dynamicTool"], (c, { node }) => toolDoc(c, node, true)),
	stepCountIs: stepCount,
	isStepCount: stepCount,
	hasToolCall: toolCalled,
	smoothStream: simple(["smoothStream"], (c) => D(c.say.options.smoothStream)),
	cosineSimilarity: simple(["cosineSimilarity"], (c, { args }) => {
		if (args.length < 2) return null;
		return D(c.say.calls.similarity({ a: c.e.text(args[0]), b: c.e.text(args[1]) }));
	}),
	convertToModelMessages: simple(["convertToModelMessages", "convertToCoreMessages"], (c, { args }) => {
		const v = valueOf(c, args[0]);
		return D(c.say.responses.toModelMessages({ value: v.t }), v.kids);
	}),
	convertToCoreMessages: simple(["convertToCoreMessages"], (c, { args }) => {
		const v = valueOf(c, args[0]);
		return D(c.say.responses.toModelMessages({ value: v.t }), v.kids);
	}),
	"Output.object": outputRule("object"),
	"Output.array": outputRule("array"),
	"Output.choice": outputRule("choice"),
	"Output.text": outputRule("text"),
	"Output.json": outputRule("json"),
	"new ToolLoopAgent": agentClass,
	"new Experimental_Agent": agentClass,
	"new Agent": agentClass,
	"*.generate": agentRun("generate"),
	"*.stream": agentRun("stream"),
	"*.toUIMessageStreamResponse": streamMethod((s) => s.responses.uiStreamResponse),
	"*.toUIMessageStream": streamMethod((s) => s.responses.uiStream),
	"*.toTextStreamResponse": streamMethod((s) => s.responses.textStreamResponse),
	"*.toDataStreamResponse": streamMethod((s) => s.responses.dataStreamResponse, true),
	"*.consumeStream": streamMethod((s) => s.responses.consume),
	"*.pipeUIMessageStreamToResponse": pipeMethod((s) => s.responses.pipeUiStream),
	"*.pipeTextStreamToResponse": pipeMethod((s) => s.responses.pipeTextStream),
	toUIMessageStream: streamHelper(["toUIMessageStream"], (s) => s.responses.uiStream),
	createUIMessageStreamResponse: streamHelper(["createUIMessageStreamResponse"], (s) => s.responses.createUiStreamResponse),
	createTextStreamResponse: streamHelper(["createTextStreamResponse"], (s) => s.responses.textStreamResponse),
	toTextStream: streamHelper(["toTextStream"], (s) => s.responses.textStreamResponse),
	createUIMessageStream: createUiStream,
	createAgentUIStreamResponse: simple(["createAgentUIStreamResponse"], (c, { args }) => {
		const opts = objectArg(args[0]);
		const agent = propValue(opts, "agent");
		const messages = propValue(opts, "uiMessages", "messages");
		if (!agent || !messages) return null;
		return D(c.say.responses.agentUiStreamResponse({ agent: c.e.text(agent), messages: c.e.text(messages) }));
	}),
	jsonSchema: simple(["jsonSchema", "zodSchema", "valibotSchema"], (c, { args }) => (args[0] ? schemaDoc(c, args[0]) : null)),
	zodSchema: simple(["zodSchema"], (c, { args }) => (args[0] ? schemaDoc(c, args[0]) : null)),
	valibotSchema: simple(["valibotSchema"], (c, { args }) => (args[0] ? schemaDoc(c, args[0]) : null)),
});
