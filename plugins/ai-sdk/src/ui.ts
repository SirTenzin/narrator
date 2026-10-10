import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, callbackDoc, fromReact, identName, imported, objectArg, propValue } from "./context";
import type { Render } from "./core";
import { optionDocs, type Spec, type Specs, schemaDoc } from "./options";

/** Hook name -> which phrase family it reads with. */
export const HOOKS: Record<string, "chat" | "completion" | "object"> = {
	useChat: "chat",
	useCompletion: "completion",
	useObject: "object",
	experimental_useObject: "object",
};

export const hookOf = (c: Ctx, call: N): "chat" | "completion" | "object" | null => {
	const local = identName(unwrap(call)?.callee);
	const name = local ? imported(c, local, fromReact) : null;
	return name ? (HOOKS[name] ?? null) : null;
};

const TRANSPORTS = new Set(["DefaultChatTransport", "TextStreamChatTransport"]);

const uiCallback =
	(key: keyof Ctx["say"]["ui"]["callbacks"]): Spec =>
	(c, node) =>
		callbackDoc({ e: c.e, say: c.say, node, intro: c.say.ui.callbacks[key] });

const AUTO_SEND: Record<string, "lastAssistantComplete" | "lastAssistantApproved"> = {
	lastAssistantMessageIsCompleteWithToolCalls: "lastAssistantComplete",
	lastAssistantMessageIsCompleteWithApprovalResponses: "lastAssistantApproved",
};

const hookSpecs = (): Specs => ({
	onFinish: uiCallback("onFinish"),
	onError: uiCallback("onError"),
	onToolCall: uiCallback("onToolCall"),
	onData: uiCallback("onData"),
	sendAutomaticallyWhen: (c, node) => {
		const which = AUTO_SEND[imported(c, identName(node) ?? "") ?? ""];
		if (which) return D(c.say.ui.autoSend({ value: c.say.ui[which] }));
		const v = c.e.noun(node);
		return D(c.say.ui.autoSend({ value: v.t }), v.kids);
	},
	messages: (c, node) => {
		const v = c.e.noun(node);
		return D(c.say.ui.initialMessages({ value: v.t }), v.kids);
	},
	initialMessages: (c, node) => hookSpecs().messages!(c, node),
	body: (c, node) => {
		const v = c.e.noun(node);
		return D(c.say.ui.requestBody({ value: v.t }), v.kids);
	},
	schema: (c, node) => {
		const s = schemaDoc(c, node);
		return D(c.say.options.schema({ value: s.t }), s.kids);
	},
});

/** `new DefaultChatTransport({ api })` whose only option is `api`, so the hook can name the route itself. */
function plainTransportApi(c: Ctx, node: N | null): N | null {
	const u = unwrap(node);
	if (u?.type !== "NewExpression" || !TRANSPORTS.has(imported(c, identName(u.callee) ?? "") ?? "")) return null;
	const o = objectArg(u.arguments[0]);
	return o?.properties.length === 1 ? propValue(o, "api") : null;
}

/** `useChat({ transport: new DefaultChatTransport({ api: '/api/chat' }) })` -> "a chat with the server at "/api/chat"". */
export function hookDoc(c: Ctx, call: N, stmt: boolean): Doc | null {
	const kind = hookOf(c, call);
	if (!kind) return null;
	const { e, say } = c;
	const opts = objectArg(call.arguments[0]);
	const transportApi = plainTransportApi(c, propValue(opts, "transport"));
	const apiNode = propValue(opts, "api") ?? transportApi;
	const api = apiNode ? e.text(apiNode) : null;
	const skip = ["api", ...(transportApi ? ["transport"] : [])];
	const docs = opts ? optionDocs(c, { node: opts, specs: hookSpecs(), skip }) : call.arguments[0] ? optionDocs(c, { node: call.arguments[0], specs: {} }) : [];
	return D(
		say.ui[kind][stmt ? "act" : "noun"]({ api }),
		docs.flatMap((d) => e.bullet(d)),
	);
}

const transport: Render = (c, { node }) => {
	if (!TRANSPORTS.has(imported(c, identName(node.callee) ?? "") ?? "")) return null;
	const opts = objectArg(node.arguments[0]);
	const api = propValue(opts, "api");
	const rest = optionDocs(c, { node: opts, specs: { body: hookSpecs().body! }, skip: ["api"] });
	return D(
		c.say.ui.transport({ api: api ? c.e.text(api) : null }),
		rest.flatMap((d) => c.e.bullet(d)),
	);
};

/** A function the hooks hand back, called bare (`sendMessage(...)`) or on the whole result (`chat.sendMessage(...)`). */
const hookFn =
	(fn: string, render: (c: Ctx, args: N[]) => Doc | null, legacy = false): Render =>
	(c, { node, obj, args, stmt }) => {
		// These are actions; as a value (`() => stop()` returned) the engine's own reading fits better.
		if (!stmt || (legacy && c.version !== "auto")) return null;
		const local = identName(unwrap(node.callee));
		const owned = obj ? c.state.chats.has(identName(obj) ?? "") : local !== null && c.state.hookFns.get(local) === fn;
		return owned ? render(c, args) : null;
	};

const send = (c: Ctx, args: N[]): Doc | null => {
	const { e, say } = c;
	if (!args[0]) return null;
	const msg = objectArg(args[0]);
	const text = propValue(msg, "text");
	const m = text && msg.properties.length === 1 ? e.noun(text) : e.noun(args[0]);
	const extra = optionDocs(c, { node: args[1], specs: { body: hookSpecs().body! } });
	if (!extra.length) return D(say.ui.send({ message: m.t }), m.kids);
	return D(say.ui.sendWith({ message: m.t }), [...m.kids, ...extra.flatMap((d) => e.bullet(d))]);
};

const fixed = (pick: (s: Ctx["say"]) => string) => (c: Ctx) => D(pick(c.say));

const addToolOutput = (c: Ctx, args: N[]): Doc | null => {
	const o = objectArg(args[0]);
	const out = propValue(o, "output", "result");
	if (!out) return null;
	const v = c.e.noun(out);
	const tool = propValue(o, "tool");
	const name = tool ? (unwrap(tool)?.type === "Literal" ? c.e.prop(String(unwrap(tool).value)) : c.e.text(tool)) : null;
	return D(c.say.ui.addToolOutput({ output: v.t, tool: name }), v.kids);
};

const valueFn = (pick: (s: Ctx["say"]) => (p: { value: string }) => string) => (c: Ctx, args: N[]) => {
	if (!args[0]) return null;
	const v = c.e.noun(args[0]);
	return D(pick(c.say)({ value: v.t }), v.kids);
};

const hookFns = (): Record<string, [(c: Ctx, args: N[]) => Doc | null, boolean?]> => ({
	sendMessage: [send],
	regenerate: [fixed((s) => s.ui.regenerate)],
	stop: [fixed((s) => s.ui.stop)],
	resumeStream: [fixed((s) => s.ui.resume)],
	clearError: [fixed((s) => s.ui.clearError)],
	addToolOutput: [addToolOutput],
	addToolResult: [addToolOutput],
	addToolApprovalResponse: [
		(c, args) => {
			const approved = propValue(objectArg(args[0]), "approved");
			return approved ? D(c.say.ui.approve({ approved: c.e.text(approved) })) : null;
		},
	],
	complete: [valueFn((s) => s.ui.complete)],
	submit: [valueFn((s) => s.ui.submit)],
	append: [send, true],
	reload: [fixed((s) => s.ui.regenerate), true],
});

export const uiCalls = (): Record<string, Render> => ({
	...Object.fromEntries(Object.keys(HOOKS).map((k) => [k, ((c, { node, stmt }) => hookDoc(c, node, stmt)) as Render])),
	"new DefaultChatTransport": transport,
	"new TextStreamChatTransport": transport,
	...Object.fromEntries(
		Object.entries(hookFns()).flatMap(([fn, [render, legacy]]) => {
			const r = hookFn(fn, render, legacy);
			return [
				[fn, r],
				[`*.${fn}`, r],
			];
		}),
	),
});
