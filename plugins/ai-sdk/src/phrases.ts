/** Rendered markup in, phrase out. Every argument is already-rendered text unless typed otherwise. */
type Value = (p: { value: string }) => string;
type Items = (p: { items: string }) => string;
/** `n` is the plain number when the count is a constant, for plural agreement. */
type Count = (p: { count: string; n: number | null }) => string;
type Flag = (p: { neg: boolean }) => string;
/** An action form ("ask X for text") and a noun form ("a text reply from X") of the same call. */
type Forms<T> = { act: (p: T) => string; noun: (p: T) => string };

/** What kind of model a provider method returns: `openai.embedding(...)` is "embedding". */
export type ModelKind = "chat" | "responses" | "completion" | "embedding" | "image" | "transcription" | "speech" | "reranking" | "video";

/** Result fields whose meaning is the same in every supported version. */
export type ResultField =
	| "text"
	| "textStream"
	| "fullStream"
	| "stream"
	| "steps"
	| "finishReason"
	| "object"
	| "partialObjectStream"
	| "elementStream"
	| "output"
	| "partialOutputStream"
	| "reasoning"
	| "reasoningText"
	| "response"
	| "request"
	| "providerMetadata"
	| "totalUsage"
	| "finalStep"
	| "responseMessages"
	| "embedding"
	| "embeddings"
	| "values"
	| "value"
	| "image"
	| "images"
	| "audio"
	| "segments"
	| "language"
	| "durationInSeconds";

/** Result fields that held the final step only before v7 and every step from v7 on. */
export type StepField = "usage" | "toolCalls" | "toolResults" | "content" | "files" | "sources" | "warnings";
/** Which steps a step field covers; `null` when the version isn't pinned. */
export type StepScope = "finalStep" | "allSteps" | null;

/** Callback options, as intros the callback body hangs off. */
export type CallbackOption =
	| "onFinish"
	| "onStepFinish"
	| "onError"
	| "onAbort"
	| "onStart"
	| "onStepStart"
	| "prepareStep"
	| "repairToolCall"
	| "onToolExecutionStart"
	| "onToolExecutionEnd"
	| "transformParams"
	| "wrapGenerate"
	| "wrapStream";

export type AiSdkPhrases = {
	models: {
		/** Provider display names, keyed by the provider's import name (`openai`, `anthropic`). */
		providers: Record<string, string>;
		kinds: Record<ModelKind, string>;
		/** `openai('gpt-5')`. */
		model: (p: { provider: string; id: string }) => string;
		/** `openai.embedding('text-embedding-3-small')`. */
		kindModel: (p: { provider: string; id: string; kind: string }) => string;
		/** `openai(modelId)`: the id isn't known. */
		namedBy: (p: { provider: string; value: string }) => string;
		/** No `model` option in sight (`generateText(options)`). */
		unknown: string;
		/** `model: 'openai/gpt-5'` or `gateway('openai/gpt-5')`. */
		gateway: (p: { id: string }) => string;
		/** `registry.languageModel('openai:gpt-5')`. */
		fromRegistry: (p: { registry: string; id: string }) => string;
		/** `createOpenAI({ apiKey })`: a block title. */
		providerSetup: (p: { provider: string }) => string;
		providerDefault: (p: { provider: string }) => string;
		registry: Items;
		customProvider: string;
		alias: (p: { name: string; model: string }) => string;
		fallback: Value;
		/** `wrapLanguageModel({ model, middleware })`: a block title, middleware beneath. */
		wrapped: (p: { model: string }) => string;
		middleware: {
			extractReasoning: (p: { tag: string; startsWithReasoning: boolean }) => string;
			defaultSettings: string;
			simulateStreaming: string;
			extractJson: string;
			addToolInputExamples: string;
		};
	};
	/** The model calls; `model` is a rendered model phrase. */
	calls: {
		generateText: Forms<{ model: string }>;
		streamText: Forms<{ model: string }>;
		generateObject: Forms<{ model: string }>;
		streamObject: Forms<{ model: string }>;
		embed: Forms<{ model: string; value: string }>;
		embedMany: Forms<{ model: string; values: string }>;
		/** `count` is null when `n` isn't given (one image). */
		generateImage: Forms<{ model: string; count: string | null; n: number | null }>;
		transcribe: Forms<{ model: string; audio: string }>;
		generateSpeech: Forms<{ model: string; text: string }>;
		rerank: Forms<{ model: string; documents: string; query: string }>;
		similarity: (p: { a: string; b: string }) => string;
	};
	options: {
		option: (p: { name: string; value: string }) => string;
		given: (p: { intro: string; given: string }) => string;
		callBy: (p: { intro: string; fn: string }) => string;
		everythingIn: Value;
		instructions: Value;
		prompt: Value;
		messages: Value;
		temperature: Value;
		maxOutputTokens: Count;
		topP: Value;
		topK: Value;
		seed: Value;
		presencePenalty: Value;
		frequencyPenalty: Value;
		stopSequences: Items;
		maxRetries: Count;
		abortSignal: Value;
		timeout: Value;
		headers: Value;
		providerOptions: Value;
		activeTools: Items;
		reasoning: Value;
		telemetry: Value;
		runtimeContext: Value;
		toolsContext: Value;
		toolApproval: Value;
		transform: Value;
		smoothStream: string;
		/** Legacy (v4) `maxSteps`. */
		maxSteps: Count;
		schema: Value;
		schemaName: Value;
		schemaDescription: Value;
		/** `generateObject({ output: 'array' })`. */
		arrayOf: Value;
		enumValues: Items;
		noSchema: string;
		answerAs: Value;
		value: Value;
		values: Value;
		maxParallelCalls: Count;
		size: Value;
		aspectRatio: Value;
		audio: Value;
		text: Value;
		voice: Value;
		language: Value;
		speed: Value;
		outputFormat: Value;
		/** `onChunk`: which chunks it sees changed in v7. */
		onChunk: Record<"any" | "subset" | "every", string>;
		callbacks: Record<CallbackOption, string>;
	};
	stop: {
		stepCount: Count;
		toolCalled: (p: { tool: string }) => string;
		anyOf: string;
		custom: Value;
		/** An agent without `stopWhen`. */
		agentDefault: string;
	};
	toolChoice: {
		auto: string;
		required: string;
		none: string;
		tool: (p: { tool: string }) => string;
	};
	tools: {
		/** `description` is the tool's own description text; `null` when it has none. */
		tool: (p: { description: string | null }) => string;
		describedBy: Value;
		dynamic: (p: { description: string | null }) => string;
		/** `tools: { weather, search }`: names only. */
		list: Items;
		title: string;
		named: (p: { name: string; tool: string }) => string;
		input: Value;
		outputShape: Value;
		context: Value;
		run: string;
		approval: Flag;
		approvalIf: string;
		strict: Flag;
		toModelOutput: string;
		/** Tools a provider runs itself: `openai.tools.webSearch()`. */
		providerTool: (p: { provider: string; name: string }) => string;
	};
	output: {
		object: Value;
		array: Value;
		choice: Items;
		text: string;
		json: string;
		named: (p: { shape: string; name: string }) => string;
	};
	results: {
		fields: Record<ResultField, string>;
		stepFields: Record<StepField, string>;
		scoped: (p: { thing: string; scope: StepScope }) => string;
		/** `{ text: answer }`. */
		renamed: (p: { thing: string; name: string }) => string;
	};
	/** `for await (const x of result.textStream)` loop heads; `source` is null for a destructured stream. */
	streams: {
		text: (p: { item: string; source: string | null }) => string;
		events: (p: { item: string; source: string | null }) => string;
		partialObject: (p: { item: string; source: string | null }) => string;
		element: (p: { item: string; source: string | null }) => string;
	};
	responses: {
		uiStream: Value;
		uiStreamResponse: Value;
		textStreamResponse: Value;
		pipeUiStream: (p: { source: string; response: string }) => string;
		pipeTextStream: (p: { source: string; response: string }) => string;
		/** Legacy (v4) `toDataStreamResponse()`. */
		dataStreamResponse: Value;
		consume: Value;
		createUiStream: string;
		createUiStreamResponse: Value;
		agentUiStreamResponse: (p: { agent: string; messages: string }) => string;
		toModelMessages: Value;
	};
	agents: {
		agent: (p: { model: string }) => string;
		/** `prompt` is null when the call passes messages or other options instead. */
		generate: Forms<{ agent: string; prompt: string | null }>;
		stream: Forms<{ agent: string; prompt: string | null }>;
	};
	ui: {
		chat: Forms<{ api: string | null }>;
		completion: Forms<{ api: string | null }>;
		object: Forms<{ api: string | null }>;
		transport: (p: { api: string | null }) => string;
		autoSend: Value;
		lastAssistantComplete: string;
		lastAssistantApproved: string;
		send: (p: { message: string }) => string;
		sendWith: (p: { message: string }) => string;
		regenerate: string;
		stop: string;
		resume: string;
		clearError: string;
		addToolOutput: (p: { output: string; tool: string | null }) => string;
		approve: (p: { approved: string }) => string;
		complete: Value;
		submit: Value;
		callbacks: { onFinish: string; onError: string; onToolCall: string; onData: string };
		initialMessages: Value;
		requestBody: Value;
	};
};
