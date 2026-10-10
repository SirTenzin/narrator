import { D, type Doc, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, callbackDoc, identName, imported, isSdkSource, keyOf, literal, objectArg, propValue, strLit } from "./context";
import { coreSpecs, optionDocs, type Spec, type Specs } from "./options";
import type { ModelKind } from "./phrases";

/** Provider methods that pick a kind of model: `openai.embedding('text-embedding-3-small')`. */
const MODEL_METHODS: Record<string, ModelKind | null> = {
	languageModel: null,
	chat: "chat",
	responses: "responses",
	completion: "completion",
	embedding: "embedding",
	embeddingModel: "embedding",
	textEmbedding: "embedding",
	textEmbeddingModel: "embedding",
	image: "image",
	imageModel: "image",
	transcription: "transcription",
	transcriptionModel: "transcription",
	speech: "speech",
	speechModel: "speech",
	reranking: "reranking",
	rerankingModel: "reranking",
	video: "video",
	videoModel: "video",
};
export const MODEL_METHOD_NAMES = Object.keys(MODEL_METHODS);

const fromProviderPackage = (from: string) => isSdkSource(from) && from !== "ai" && !from.startsWith("ai/");

/** The provider a local names: an imported `openai`, the `gateway`, or a `createOpenAI(...)` result. Null if it isn't one. */
export function providerLabel(c: Ctx, local: string): string | null {
	const { e, say, state } = c;
	if (state.providers.has(local)) return e.ref(local);
	const name = imported(c, local, fromProviderPackage) ?? (imported(c, local) === "gateway" ? "gateway" : null);
	if (!name || /^create[A-Z]/.test(name)) return null;
	return say.models.providers[name] ?? e.lex.humanize(name);
}

const modelId = (c: Ctx, node: N) => {
	const s = strLit(node);
	return s === null ? null : mk("l", s);
};

/** `openai('gpt-5')`, `openai.embedding(...)`, `registry.languageModel(...)`; null when the call isn't one. */
export function providerModelDoc(c: Ctx, call: N): Doc | null {
	const { e, say } = c;
	const callee = unwrap(call.callee);
	const local = identName(callee);
	const idNode = call.arguments[0];
	if (local) {
		const provider = providerLabel(c, local);
		if (!provider || !idNode) return null;
		const id = modelId(c, idNode);
		if (local === "gateway" || imported(c, local) === "gateway") return id ? D(say.models.gateway({ id })) : null;
		if (id) return D(say.models.model({ provider, id }));
		const v = e.noun(idNode);
		return D(say.models.namedBy({ provider, value: v.t }), v.kids);
	}
	if (callee?.type !== "MemberExpression" || callee.computed) return null;
	const obj = identName(callee.object);
	const method = callee.property.name;
	if (!obj || !(method in MODEL_METHODS) || !idNode) return null;
	if (c.state.registries.has(obj)) {
		const v = e.noun(idNode);
		return D(say.models.fromRegistry({ registry: e.ref(obj), id: modelId(c, idNode) ?? v.t }), v.kids);
	}
	const provider = providerLabel(c, obj);
	if (!provider) return null;
	const kind = MODEL_METHODS[method];
	const id = modelId(c, idNode);
	if (!id) {
		const v = e.noun(idNode);
		return D(say.models.namedBy({ provider, value: v.t }), v.kids);
	}
	return D(kind ? say.models.kindModel({ provider, id, kind: say.models.kinds[kind] }) : say.models.model({ provider, id }));
}

/** The `model` option: a gateway id string, a provider call, or whatever expression holds the model. */
export function modelDoc(c: Ctx, node: N | null): Doc {
	if (!node) return D(c.say.models.unknown);
	const id = strLit(node);
	if (id !== null) return D(c.say.models.gateway({ id: mk("l", id) }));
	return c.e.noun(node);
}

/** `createOpenAI({ apiKey, baseURL })`. */
export function providerSetupDoc(c: Ctx, call: N, factory: string, from: string): Doc {
	const { e, say } = c;
	const key = from.replace(/^@ai-sdk\//, "").replace(/^@openrouter\/.*/, "openrouter");
	const provider = say.models.providers[key] ?? e.lex.humanize(factory.replace(/^create/, ""));
	const opts = objectArg(call.arguments[0]);
	if (!opts?.properties.length) return D(say.models.providerDefault({ provider }));
	return D(
		say.models.providerSetup({ provider }),
		optionDocs(c, { node: opts, specs: {} }).flatMap((d) => e.bullet(d)),
	);
}

/** `createProviderRegistry({ openai, anthropic })`. */
export function registryDoc(c: Ctx, call: N): Doc {
	const { e, say } = c;
	const o = objectArg(call.arguments[0]);
	if (!o) {
		const v = e.noun(call.arguments[0]);
		return D(say.models.registry({ items: v.t }), v.kids);
	}
	const names = o.properties.map((p: N) =>
		p.type === "SpreadElement" ? say.options.everythingIn({ value: e.text(p.argument) }) : mk("l", keyOf(p) ?? e.code(p.key)),
	);
	return D(say.models.registry({ items: e.g.list(names) }));
}

/** `customProvider({ languageModels: { fast: openai('gpt-5-mini') }, fallbackProvider: openai })`. */
export function customProviderDoc(c: Ctx, call: N): Doc {
	const { e, say } = c;
	const o = objectArg(call.arguments[0]);
	const items: Doc[] = [];
	for (const p of o?.properties ?? []) {
		const key = p.type === "SpreadElement" ? null : keyOf(p);
		const models = key && /Models$/.test(key) ? objectArg(p.value) : null;
		if (models) {
			for (const m of models.properties) {
				if (m.type === "SpreadElement") continue;
				const v = e.noun(m.value);
				items.push(D(say.models.alias({ name: mk("l", keyOf(m) ?? e.code(m.key)), model: v.t }), v.kids));
			}
			continue;
		}
		if (key === "fallbackProvider") {
			const v = e.noun(p.value);
			items.push(D(say.models.fallback({ value: v.t }), v.kids));
			continue;
		}
		items.push(...optionDocs(c, { node: { type: "ObjectExpression", properties: [p] }, specs: {} }));
	}
	return D(
		say.models.customProvider,
		items.flatMap((d) => e.bullet(d)),
	);
}

/** One middleware: a built-in helper, or an object of hooks (one bullet per hook). */
function middlewareDocs(c: Ctx, node: N): Doc[] {
	const { e, say } = c;
	const u = unwrap(node);
	const m = say.models.middleware;
	if (u?.type === "CallExpression") {
		const name = imported(c, identName(u.callee) ?? "");
		const opts = objectArg(u.arguments[0]);
		const tag = strLit(propValue(opts, "tagName"));
		if (name === "extractReasoningMiddleware" && tag !== null)
			return [D(m.extractReasoning({ tag: mk("l", tag), startsWithReasoning: literal(propValue(opts, "startWithReasoning")) === true }))];
		if (name === "defaultSettingsMiddleware")
			return [
				D(
					m.defaultSettings,
					optionDocs(c, { node: propValue(opts, "settings"), specs: coreSpecs() }).flatMap((d) => e.bullet(d)),
				),
			];
		if (name === "simulateStreamingMiddleware") return [D(m.simulateStreaming)];
		if (name === "extractJsonMiddleware") return [D(m.extractJson)];
		if (name === "addToolInputExamplesMiddleware") return [D(m.addToolInputExamples)];
	}
	if (objectArg(u)) return optionDocs(c, { node: u, specs: hookSpecs });
	return [e.noun(node)];
}

const hook =
	(key: "transformParams" | "wrapGenerate" | "wrapStream"): Spec =>
	(c, node) =>
		callbackDoc({ e: c.e, say: c.say, node, intro: c.say.options.callbacks[key] });
const hookSpecs: Specs = { transformParams: hook("transformParams"), wrapGenerate: hook("wrapGenerate"), wrapStream: hook("wrapStream") };

/** `wrapLanguageModel({ model, middleware })`: the model, then each middleware as a bullet. */
export function wrappedModelDoc(c: Ctx, call: N): Doc | null {
	const { e, say } = c;
	const o = objectArg(call.arguments[0]);
	if (!o) return null;
	const model = modelDoc(c, propValue(o, "model"));
	const mw = unwrap(propValue(o, "middleware"));
	const list: N[] = mw?.type === "ArrayExpression" ? mw.elements.filter(Boolean) : mw ? [mw] : [];
	const docs = list.flatMap((n) => middlewareDocs(c, n));
	return D(say.models.wrapped({ model: model.t }), [...model.kids, ...docs.flatMap((d) => e.bullet(d))]);
}
