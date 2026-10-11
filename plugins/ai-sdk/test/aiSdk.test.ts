import { describe, expect, test } from "bun:test";
import { createNarrator, renderText } from "@usenarrator/core";
import { type TsPlugin, typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en as english } from "@usenarrator/locale-en";
import { zod } from "@usenarrator/plugin-zod";
import { narrate, narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { type AiSdkOptions, type AiSdkPhrases, aiSdk, en } from "../src";

/** Narrates with the AI SDK (and Zod, for schemas) and asserts nothing fell back to raw code. */
const read = (code: string, opts: AiSdkOptions = {}, path = "snippet.ts") => {
	const { text, fallbacks } = narrateWithStats(code, { plugins: [zod(), aiSdk(opts)], path });
	expect(fallbacks).toBe(0);
	return text;
};

const AI = `import { generateText, streamText, generateObject, streamObject, embed, embedMany, generateImage, tool, stepCountIs, hasToolCall, Output, ToolLoopAgent, wrapLanguageModel, extractReasoningMiddleware, defaultSettingsMiddleware, createProviderRegistry, customProvider, smoothStream, convertToModelMessages, cosineSimilarity, createAgentUIStreamResponse } from "ai";
import { openai, createOpenAI } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
`;

describe("model calls", () => {
	test("generateText reads as asking the model, options as bullets", () => {
		const text = read(`${AI}
const { text, usage } = await generateText({
	model: openai("gpt-5"),
	system: "You are a friendly assistant.",
	prompt: "Write a vegetarian lasagna recipe for 4 people.",
	temperature: 0.3,
	maxOutputTokens: 512,
});`);
		expect(text).toBe(
			[
				"Ask OpenAI's gpt-5 model for text, and take its text and token usage:",
				`  • instructions: "You are a friendly assistant."`,
				`  • prompt: "Write a vegetarian lasagna recipe for 4 people."`,
				"  • randomness (temperature): 0.3",
				"  • write at most 512 tokens",
			].join("\n"),
		);
	});

	test("a route handler streams to the chat UI", () => {
		const text = read(`${AI}
const weather = tool({
	description: "Get the weather in a location",
	inputSchema: z.object({ location: z.string() }),
	execute: async ({ location }) => ({ location, temperature: 72 }),
});

export async function POST(req: Request) {
	const { messages } = await req.json();
	const result = streamText({
		model: "anthropic/claude-sonnet-4.5",
		messages: convertToModelMessages(messages),
		tools: { weather },
		stopWhen: stepCountIs(5),
	});
	return result.toUIMessageStreamResponse();
}`);
		expect(text).toBe(
			[
				"Let weather be a tool the model can call to get the weather in a location:",
				"  • its input: an object with location",
				"  • when called (given location):",
				"    Give back an object with location and temperature: 72.",
				"",
				"To post (async), given request (Request):",
				"  From request's JSON, take messages.",
				"  Stream text from the AI Gateway's anthropic/claude-sonnet-4.5 model → result:",
				"    • the conversation so far: messages, converted for the model",
				"    • tools it can use: weather",
				"    • stop after 5 steps",
				"  Give back result, streamed back to the chat UI.",
			].join("\n"),
		);
	});

	test("streaming loops say what arrives", () => {
		const text = read(`${AI}
const result = streamText({ model: openai("gpt-5"), prompt: "Invent a new holiday." });
for await (const textPart of result.textStream) {
	process.stdout.write(textPart);
}
for await (const part of result.fullStream) handle(part);`);
		expect(text).toContain("For each piece of text (text part) as it streams in from result:");
		expect(text).toContain("For each event (part) as it streams in from result:");
	});

	test("generateObject and streamObject describe the shape", () => {
		const text = read(`${AI}
const { object } = await generateObject({
	model: openai("gpt-4.1"),
	schema: z.object({ recipe: z.object({ name: z.string(), steps: z.array(z.string()) }) }),
	prompt: "Generate a lasagna recipe.",
});
const { elementStream } = streamObject({ model: openai("gpt-4.1"), output: "array", schema: z.object({ name: z.string(), class: z.string() }), prompt: "Generate 3 hero descriptions." });
for await (const hero of elementStream) console.log(hero);
const { object: mood } = await generateObject({ model: openai("gpt-4.1"), output: "enum", enum: ["happy", "sad"], prompt });`);
		expect(text).toContain("Ask OpenAI's gpt-4.1 model for structured data, and take its object:\n  • shaped like an object with recipe");
		expect(text).toContain("Stream structured data from OpenAI's gpt-4.1 model, and take its stream of finished list items:");
		expect(text).toContain("  • a list of items shaped like an object with name and class");
		expect(text).toContain("For each finished list item (hero) as it arrives:");
		expect(text).toContain(`take its object (as mood):\n  • one of "happy" or "sad"`);
	});

	test("structured output, tool choice and stop conditions", () => {
		const text = read(`${AI}
const { output } = await generateText({
	model: anthropic("claude-sonnet-4-5"),
	output: Output.object({ schema: z.object({ sentiment: z.enum(["positive", "negative"]) }) }),
	toolChoice: "required",
	stopWhen: [stepCountIs(10), hasToolCall("finalAnswer")],
	prompt,
});`);
		expect(text).toBe(
			[
				"Ask Anthropic's claude-sonnet-4-5 model for text, and take its structured output:",
				"  • answer as an object shaped like an object with sentiment",
				"  • the model must call a tool",
				"  • stop as soon as any of these happens:",
				"    • stop after 10 steps",
				"    • stop once the model calls final answer",
				"  • prompt: prompt",
			].join("\n"),
		);
	});

	test("embeddings, images, transcription and speech", () => {
		const text =
			read(`import { embed, embedMany, generateImage, cosineSimilarity, experimental_transcribe as transcribe, experimental_generateSpeech as generateSpeech } from "ai";
import { openai } from "@ai-sdk/openai";
const { embedding } = await embed({ model: openai.embedding("text-embedding-3-small"), value: "sunny day at the beach" });
const { embeddings } = await embedMany({ model: openai.embedding("text-embedding-3-small"), values: docs, maxParallelCalls: 2 });
const score = cosineSimilarity(a, b);
const { images } = await generateImage({ model: openai.image("dall-e-3"), prompt: "Santa Claus driving a Cadillac", n: 4, size: "1024x1024" });
const transcript = await transcribe({ model: openai.transcription("whisper-1"), audio });
const { audio: speech } = await generateSpeech({ model: openai.speech("tts-1"), text: "Hello, world!", voice: "alloy" });`);
		expect(text).toContain(`Turn "sunny day at the beach" into an embedding with OpenAI's text-embedding-3-small embedding model, and take its embedding.`);
		expect(text).toContain(
			"Turn each of docs into an embedding with OpenAI's text-embedding-3-small embedding model, and take its embeddings:\n  • at most 2 requests at a time",
		);
		expect(text).toContain("Let score be how similar a and b are (cosine similarity).");
		expect(text).toContain(
			`Generate 4 images with OpenAI's dall-e-3 image model, and take its images:\n  • prompt: "Santa Claus driving a Cadillac"\n  • size "1024x1024"`,
		);
		expect(text).toContain("Transcribe audio with OpenAI's whisper-1 transcription model, and call the result transcript.");
		expect(text).toContain(`Turn "Hello, world!" into speech with OpenAI's tts-1 speech model, and take its audio (as speech):\n  • voice "alloy"`);
	});

	test("callbacks name what they're given", () => {
		const text = read(`${AI}
const result = streamText({
	model: openai("gpt-5"),
	prompt,
	experimental_transform: smoothStream(),
	onError({ error }) { console.error(error); },
	onFinish: ({ text, usage }) => save(text, usage),
});`);
		expect(text).toContain("  • smooth out the text as it streams");
		expect(text).toContain("  • if something goes wrong (given error):\n    Log an error (with error).");
		expect(text).toContain("  • when it's done (given text and token usage):\n    Save (text and usage).");
	});
});

describe("tools and agents", () => {
	test("inline tools are bullets under the tools they can use", () => {
		const text = read(`${AI}
const weatherAgent = new ToolLoopAgent({
	model: "openai/gpt-5",
	instructions: "You are a helpful weather assistant.",
	tools: {
		weather: tool({
			description: "Get the weather in a location (in Fahrenheit)",
			inputSchema: z.object({ location: z.string() }),
			needsApproval: true,
			execute: async ({ location }) => getWeather(location),
		}),
		search,
	},
});
const result = await weatherAgent.generate({ prompt: "What is the weather in San Francisco?" });
const stream = await weatherAgent.stream({ prompt: "Hi" });
for await (const chunk of stream.textStream) console.log(chunk);
export async function POST(req: Request) {
	const { messages } = await req.json();
	return createAgentUIStreamResponse({ agent: weatherAgent, uiMessages: messages });
}`);
		expect(text).toContain(
			[
				"Let weather agent be an agent running the AI Gateway's openai/gpt-5 model:",
				`  • instructions: "You are a helpful weather assistant."`,
				"  • tools it can use:",
				"    • weather: a tool the model can call to get the weather in a location (in Fahrenheit):",
				"      • its input: an object with location",
				"      • asks for approval before running",
				"      • when called (given location):",
				"        Get weather (location).",
				"    • search",
				"  • stops after 20 steps unless told otherwise",
			].join("\n"),
		);
		expect(text).toContain(`Ask weather agent "What is the weather in San Francisco?" → result.`);
		expect(text).toContain(`Stream weather agent's answer to "Hi", and call the result stream.`);
		expect(text).toContain("For each piece of text (chunk) as it streams in from stream:");
		expect(text).toContain("Give back weather agent's reply to messages, streamed back to the chat UI.");
	});

	test("descriptions that aren't instructions are quoted as-is", () => {
		const text = read(`${AI}
const a = tool({ description: "Returns the current time", execute: async () => new Date() });
const b = tool({ description: describe("x"), inputSchema: schema, execute });`);
		expect(text).toContain("Let a be a tool the model can call: Returns the current time:");
		expect(text).toContain("Let b be a tool the model can call, described by describe (");
	});
});

describe("providers and middleware", () => {
	test("custom providers, registries and middleware", () => {
		const text = read(`${AI}
const model = wrapLanguageModel({
	model: anthropic("claude-3-7-sonnet"),
	middleware: [extractReasoningMiddleware({ tagName: "think" }), defaultSettingsMiddleware({ settings: { temperature: 0.5 } })],
});
const groq = createOpenAI({ baseURL: "https://api.groq.com/openai/v1", apiKey: process.env.GROQ_API_KEY });
const registry = createProviderRegistry({ anthropic, openai: groq });
const r = await generateText({ model: registry.languageModel("openai:llama-3.1-70b"), prompt: "Hi" });
const s = streamText({ model: groq("llama-3.1-70b-versatile"), prompt: "Hi" });
const myProvider = customProvider({ languageModels: { fast: openai("gpt-5-mini") }, fallbackProvider: openai });`);
		expect(text).toBe(
			[
				"Let model be Anthropic's claude-3-7-sonnet model, wrapped with:",
				"  • pull the model's reasoning out of <think> tags",
				"  • default settings:",
				"    • randomness (temperature): 0.5",
				"",
				"Let groq be the OpenAI provider, set up with:",
				`  • base URL: "https://api.groq.com/openai/v1"`,
				"  • API key: the GROQ_API_KEY environment variable",
				"",
				"Let registry be a model registry with the providers anthropic and openai.",
				"",
				"Ask the openai:llama-3.1-70b model from registry for text, and call the result r:",
				`  • prompt: "Hi"`,
				"",
				"Stream text from groq's llama-3.1-70b-versatile model, and call the result s:",
				`  • prompt: "Hi"`,
				"",
				"Let my provider be a custom provider with:",
				"  • fast means OpenAI's gpt-5-mini model",
				"  • any other model comes from openai",
			].join("\n"),
		);
	});
});

describe("UI hooks", () => {
	test("useChat and the functions it hands back", () => {
		const text = read(
			`import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
export default function Chat() {
	const { messages, sendMessage, status, stop } = useChat({
		transport: new DefaultChatTransport({ api: "/api/chat" }),
		sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
		onError: (error) => console.error(error),
	});
	const send = () => {
		sendMessage({ text: input });
	};
	return <button onClick={() => stop()}>Stop</button>;
}`,
			{},
			"chat.tsx",
		);
		expect(text).toContain(
			[
				`  Connect to the chat at "/api/chat", and take its messages, send message, status, and stop:`,
				"    • send automatically when every tool call in the last reply has a result",
				"    • if the request fails (given error):",
				"      Log an error (with error).",
			].join("\n"),
		);
		expect(text).toContain("    Send input to the chat.");
		expect(text).toContain("on click: stop the reply that's streaming in");
	});

	test("useCompletion and useObject", () => {
		const text = read(
			`import { useCompletion, experimental_useObject as useObject } from "@ai-sdk/react";
function Page() {
	const { completion, complete } = useCompletion({ api: "/api/completion" });
	const { object, submit } = useObject({ api: "/api/notifications", schema: notificationSchema });
	const go = async () => {
		await complete("Why is the sky blue?");
		submit("Messages during finals week.");
	};
}`,
			{},
			"page.tsx",
		);
		expect(text).toContain(`Connect to the text completion endpoint at "/api/completion", and take its completion and complete.`);
		expect(text).toContain(
			`Connect to the structured data endpoint at "/api/notifications", and take its object and submit:\n    • shaped like notification schema`,
		);
		expect(text).toContain(`Ask the server to complete "Why is the sky blue?".`);
		expect(text).toContain(`Ask the server for structured data, sending "Messages during finals week.".`);
	});
});

describe("versions", () => {
	const code = `import { generateText, streamText } from "ai";
import { openai } from "@ai-sdk/openai";
const { usage, toolCalls } = await generateText({ model: openai("gpt-5"), tools: { weather }, prompt });
const result = streamText({ model: openai("gpt-5"), prompt, onChunk: ({ chunk }) => handle(chunk) });
for await (const part of result.stream) handle(part);`;

	test("auto mode doesn't guess which steps a result covers", () => {
		const text = read(code);
		expect(text).toContain("take its token usage and tool calls:");
		expect(text).toContain("for each chunk as it streams in (given chunk)");
		expect(text).toContain("For each event (part) as it streams in from result:");
	});

	test("v6: usage and tool calls are the final step's; `.stream` isn't the event stream", () => {
		const text = narrate(code, { plugins: [aiSdk({ version: 6 })] });
		expect(text).toContain("take its token usage from the final step and tool calls from the final step:");
		expect(text).toContain("for each chunk of text, reasoning, source, or tool activity as it streams in");
		expect(text).not.toContain("For each event (part)");
	});

	test("v7: usage and tool calls cover every step; onChunk sees every event", () => {
		const text = read(code, { version: 7 });
		expect(text).toContain("take its token usage from every step and tool calls from every step:");
		expect(text).toContain("for every stream event, including starts, ends, and errors");
		expect(text).toContain("For each event (part) as it streams in from result:");
	});

	test("pinning a version reads the other's names generically", () => {
		const v6 = `import { generateText, isStepCount } from "ai";\nconst r = await generateText({ model, onEnd: done, stopWhen: isStepCount(2) });`;
		expect(read(v6, { version: 7 })).toContain("stop after 2 steps");
		expect(narrate(v6, { plugins: [aiSdk({ version: 6 })] })).not.toContain("stop after 2 steps");
		expect(narrate(v6, { plugins: [aiSdk({ version: 6 })] })).toContain("on end: done");
		const legacy = `import { generateText } from "ai";\nconst r = await generateText({ model, maxSteps: 5, maxTokens: 100 });`;
		expect(read(legacy)).toContain("allow up to 5 steps");
		expect(read(legacy, { version: 7 })).toContain("max steps: 5");
	});
});

describe("guards", () => {
	test("nothing fires in files that don't import the AI SDK", () => {
		const code = `const r = await generateText({ model: openai("gpt-5"), prompt: "hi" });
const t = tool({ description: "Get the weather" });
for await (const x of r.textStream) log(x);
return r.toUIMessageStreamResponse();`;
		const text = narrate(code, { plugins: [aiSdk()] });
		expect(text).toBe(narrate(code));
	});

	test("same-named calls from other libraries are left alone", () => {
		const code = `import { generateText } from "ai";
import OpenAI from "openai";
import { tool } from "./my-tools";
const t = tool({ description: "Get the weather" });
const s = await db.stream({ prompt: "x" });
const g = await game.generate({ prompt: "x" });
for await (const row of cursor.stream) handle(row);
sendMessage({ text: "hi" });
stop();`;
		const without = narrate(code);
		expect(narrate(code, { plugins: [aiSdk()] })).toBe(without);
	});
});

describe("phrasebook", () => {
	test("rules take every word from the phrasebook", () => {
		const shouted: AiSdkPhrases = {
			...en,
			calls: { ...en.calls, generateText: { ...en.calls.generateText, act: ({ model }) => `PREGUNTAR A ${model} POR TEXTO` } },
			models: { ...en.models, model: ({ provider, id }) => `EL MODELO ${id} DE ${provider}` },
		};
		const text = narrate(`import { generateText } from "ai";\nimport { openai } from "@ai-sdk/openai";\nawait generateText({ model: openai("gpt-5") });`, {
			plugins: [aiSdk()],
			locale: { ...english, plugins: { "ai-sdk": shouted } },
		});
		expect(text).toBe("PREGUNTAR A EL MODELO gpt-5 DE OpenAI POR TEXTO.");
	});

	test("a complete translation has no gaps", () => {
		expect(phrasebookGaps(en, { ...en })).toEqual({ missing: [], extra: [] });
	});

	test("the plugin declares the library it reads", () => {
		expect(aiSdk().library).toEqual({ name: "ai", versions: ">=6 <8" });
	});
});

/** Narrates `code` as a file of a package declaring `dependencies`, the way a host with package.json access would. */
function inPackage({ code, plugins, dependencies }: { code: string; plugins: TsPlugin[]; dependencies: Record<string, string> }) {
	const narrator = createNarrator({ languages: [typescript({ parser: oxcParser, plugins, dependencies: () => dependencies })], locale: english });
	return renderText(narrator.narrate(code, "snippet.ts").lines);
}

describe("results and packages", () => {
	test("fields of a model call's result read as what they hold", () => {
		const text = read(`${AI}const result = await generateText({ model: openai("gpt-5"), prompt });\nlog(result.usage, result.text);`, { version: 6 });
		expect(text).toContain("Log (result's token usage from the final step and result's text).");
	});

	test("the package's AI SDK major sets the version", () => {
		const code =
			'import { generateText } from "ai";\nimport { openai } from "@ai-sdk/openai";\nconst { text, usage } = await generateText({ model: openai("gpt-5"), prompt });';
		const plugins = [zod(), aiSdk()];
		expect(inPackage({ code, plugins, dependencies: { ai: "^6.0.0" } })).toBe(read(code, { version: 6 }));
		expect(inPackage({ code, plugins, dependencies: { ai: "^7.0.0" } })).toBe(read(code, { version: 7 }));
		expect(read(code, { version: 6 })).not.toBe(read(code, { version: 7 }));
	});
});
