import { D, type Doc, plain } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, callbackDoc, keyOf, literal, objectArg, propValue, strLit } from "./context";
import { optionDocs, type Specs, schemaDoc } from "./options";

const flag =
	(pick: (s: Ctx["say"]) => (p: { neg: boolean }) => string, cond?: (s: Ctx["say"]) => string) =>
	(c: Ctx, node: N): Doc | null => {
		const v = literal(node);
		if (typeof v === "boolean") return D(pick(c.say)({ neg: !v }));
		return cond ? callbackDoc({ e: c.e, say: c.say, node, intro: cond(c.say) }) : null;
	};

const shape =
	(pick: (s: Ctx["say"]) => (p: { value: string }) => string) =>
	(c: Ctx, node: N): Doc => {
		const s = schemaDoc(c, node);
		return D(pick(c.say)({ value: s.t }), s.kids);
	};

const toolSpecs: Specs = {
	inputSchema: shape((s) => s.tools.input),
	parameters: shape((s) => s.tools.input),
	outputSchema: shape((s) => s.tools.outputShape),
	contextSchema: shape((s) => s.tools.context),
	execute: (c, node) => callbackDoc({ e: c.e, say: c.say, node, intro: c.say.tools.run }),
	needsApproval: flag(
		(s) => s.tools.approval,
		(s) => s.tools.approvalIf,
	),
	strict: flag((s) => s.tools.strict),
	toModelOutput: (c, node) => callbackDoc({ e: c.e, say: c.say, node, intro: c.say.tools.toModelOutput }),
};

/** `tool({ description, inputSchema, execute })` as "a tool the model can call to …" with its details beneath. */
export function toolDoc(c: Ctx, call: N, dynamic: boolean): Doc {
	const { e, say } = c;
	const opts = objectArg(call.arguments[0]);
	const descNode = propValue(opts, "description");
	const desc = strLit(descNode);
	const kids = optionDocs(c, { node: opts ?? call.arguments[0], specs: toolSpecs, skip: ["description", "type"] }).flatMap((d) => e.bullet(d));
	if (descNode && desc === null) {
		const v = e.noun(descNode);
		return D(say.tools.describedBy({ value: v.t }), [...v.kids, ...kids]);
	}
	const description = desc === null ? null : plain(desc).trim();
	return D(dynamic ? say.tools.dynamic({ description }) : say.tools.tool({ description }), kids);
}

/** The `tools` option: names when the tools are defined elsewhere, a bullet per tool when inline. */
export function toolsDoc(c: Ctx, node: N): Doc {
	const { e, say } = c;
	const o = objectArg(node);
	if (!o) {
		const v = e.noun(node);
		return D(say.tools.list({ items: v.t }), v.kids);
	}
	const entries = o.properties.map((p: N) => {
		if (p.type === "SpreadElement") {
			const v = e.noun(p.argument);
			return { inline: false, doc: D(say.options.everythingIn({ value: v.t }), v.kids) };
		}
		const name = e.prop(keyOf(p) ?? e.code(p.key));
		const value = unwrap(p.value);
		if (p.shorthand || value?.type === "Identifier") return { inline: false, doc: D(name) };
		const v = e.noun(p.value);
		return { inline: true, doc: D(say.tools.named({ name, tool: v.t }), v.kids) };
	});
	if (!entries.some((x: { inline: boolean }) => x.inline))
		return D(
			say.tools.list({ items: e.g.list(entries.map((x: { doc: Doc }) => x.doc.t)) }),
			entries.flatMap((x: { doc: Doc }) => x.doc.kids),
		);
	return D(
		say.tools.title,
		entries.flatMap((x: { doc: Doc }) => e.bullet(x.doc)),
	);
}

/** `openai.tools.webSearch()`: a tool the provider runs on its side. */
export function providerToolDoc(c: Ctx, call: N, provider: string): Doc {
	const callee = unwrap(call.callee);
	const name = c.e.lex.humanize(callee.property.name);
	const opts = optionDocs(c, { node: call.arguments[0], specs: {} });
	return D(
		c.say.tools.providerTool({ provider, name }),
		opts.flatMap((d) => c.e.bullet(d)),
	);
}
