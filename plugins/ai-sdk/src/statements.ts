import { D, type Doc } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, identName, keyOf, stepScope } from "./context";
import { MODEL_CALL_NAMES, sdkName } from "./core";
import { resultNames } from "./options";
import { hookDoc, hookOf } from "./ui";

/** Variable names that say nothing beyond "the result", so the binding reads as an arrow instead. */
const GENERIC_NAMES = new Set(["result", "res", "response", "output", "out"]);

const STREAM_CALLS = new Set(["streamText", "streamObject"]);

/** `agent.generate(...)` / `agent.stream(...)` on a known agent. */
const agentRunOf = (c: Ctx, call: N): "generate" | "stream" | null => {
	const callee = unwrap(call.callee);
	if (callee?.type !== "MemberExpression" || callee.computed || !c.state.agents.has(identName(callee.object) ?? "")) return null;
	const m = callee.property.name;
	return m === "generate" || m === "stream" ? m : null;
};

function bind({ c, d, node, id, call }: { c: Ctx; d: number; node: N; id: N; call: Doc }) {
	const { e } = c;
	const dc = e.say.declarations;
	if (id.type === "Identifier") {
		const name = e.ref(id.name);
		const phrase = GENERIC_NAMES.has(id.name) ? dc.callInto : dc.callAs;
		e.emitDoc(d, D(phrase({ call: call.t, name }), call.kids), node);
		return;
	}
	const names = id.type === "ObjectPattern" ? resultNames(c, id, stepScope(c)) : e.patternNames(id);
	e.emitDoc(d, D(dc.callTake({ call: call.t, names: e.g.list(names) }), call.kids), node);
}

/** `const { text, usage } = await generateText(...)`, `const result = streamText(...)`, `const { messages, sendMessage } = useChat(...)`. */
export function declaration(c: Ctx, node: N, d: number): boolean {
	if (node.type !== "VariableDeclaration" || node.declarations.length !== 1) return false;
	const { id, init } = node.declarations[0];
	const call = unwrap(init);
	if (call?.type !== "CallExpression" || (id.type !== "Identifier" && id.type !== "ObjectPattern")) return false;
	const hook = hookOf(c, call);
	if (hook) {
		if (id.type === "Identifier") c.state.chats.add(id.name);
		else
			for (const p of id.properties) {
				const key = p.type === "Property" ? keyOf(p) : null;
				const local = p.type === "Property" ? identName(p.value.type === "AssignmentPattern" ? p.value.left : p.value) : null;
				if (key && local) c.state.hookFns.set(local, key);
			}
		const doc = hookDoc(c, call, true);
		if (!doc) return false;
		const names = id.type === "ObjectPattern" ? c.e.patternNames(id) : [];
		const dc = c.e.say.declarations;
		const text = id.type === "Identifier" ? dc.callAs({ call: doc.t, name: c.e.ref(id.name) }) : dc.callTake({ call: doc.t, names: c.e.g.list(names) });
		c.e.emitDoc(d, D(text, doc.kids), node);
		return true;
	}
	const name = sdkName(c, call);
	const run = agentRunOf(c, call);
	if (!(name && MODEL_CALL_NAMES.has(name)) && !run) return false;
	if ((name && STREAM_CALLS.has(name)) || run === "stream") {
		if (id.type === "Identifier") c.state.streams.add(id.name);
		else
			for (const p of id.properties) {
				const key = p.type === "Property" ? keyOf(p) : null;
				const local = p.type === "Property" ? identName(p.value) : null;
				if (key && local && key in STREAMS) c.state.streamParts.set(local, key);
			}
	}
	bind({ c, d, node, id, call: c.e.call(call, true) });
	return true;
}

/** Stream properties a `for await` can walk, and how the loop head reads. */
const STREAMS: Record<string, "text" | "events" | "partialObject" | "element"> = {
	textStream: "text",
	fullStream: "events",
	stream: "events",
	partialObjectStream: "partialObject",
	partialOutputStream: "partialObject",
	elementStream: "element",
};

/** `for await (const part of result.textStream)` -> "For each piece of text (part) as it streams in from result:". */
export function streamLoop(c: Ctx, node: N, d: number): boolean {
	if (node.type !== "ForOfStatement" || !c.state.imports.size) return false;
	const right = unwrap(node.right);
	const part = right?.type === "Identifier" ? c.state.streamParts.get(right.name) : undefined;
	if (part) return loop(c, node, d, STREAMS[part]!, null);
	if (right?.type !== "MemberExpression" || right.computed) return false;
	const prop: string = right.property.name;
	const kind = STREAMS[prop];
	if (!kind) return false;
	const tracked = c.state.streams.has(identName(right.object) ?? "");
	// `.stream` is the full event stream only from v7, and too common a name to trust untracked.
	if (prop === "stream" && (!tracked || c.version === 6)) return false;
	return loop(c, node, d, kind, right.object);
}

function loop(c: Ctx, node: N, d: number, kind: (typeof STREAMS)[string], source: N | null): boolean {
	const e: Engine = c.e;
	const src = source ? e.noun(source) : null;
	const pat = node.left.declarations?.[0]?.id ?? node.left;
	const item = e.g.list(e.patternNames(pat));
	e.emitDoc(d, D(`${c.say.streams[kind]({ item, source: src ? src.t : null })}:`, src?.kids ?? []), node);
	e.block(node.body, d + 1);
	return true;
}
