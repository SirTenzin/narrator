import { D, mk } from "@usenarrator/core";
import { type CallRule, definePlugin, type Engine, type N, type StmtRule, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { en } from "./en";
import { functionCalls, functionParts, triggersText } from "./functions";
import type { InngestPhrases as __PluginPhrases, InngestPhrases } from "./phrases";
import { type Ctx, codeText, factsReader, framed, importedAs, objectArg, propOf, type Rule, usesInngest } from "./shared";
import { isStepCall, serveDoc, stepCalls, stepDoc } from "./steps";

export { en } from "./en";
export type { CronDays, InngestPhrases, TimePhrases, TimeUnit } from "./phrases";

/** Inngest (inngest.com, TypeScript SDK v3 and v4): clients, functions with their triggers and flow control, durable steps, events, and `serve`. */
export const inngest = (): TsPlugin<InngestPhrases> => {
	const read = factsReader();
	const ctx = (e: Engine, say: InngestPhrases): Ctx => ({ e, say, facts: read(e) });

	const newClient: Rule = (c, { node, args }) =>
		importedAs(c, node.callee)?.name === "Inngest" ? D(c.say.client.noun({ id: c.e.text(propOf(objectArg(args[0]), "id")) })) : null;
	const cronHelper: Rule = (c, { node, args }) => (importedAs(c, node.callee)?.name === "cron" && args[0] ? D(triggersText(c, node)) : null);

	const rules: Record<string, Rule> = { ...functionCalls(), ...stepCalls(), "new Inngest": newClient, cron: cronHelper };
	const calls: Record<string, CallRule<InngestPhrases>> = {};
	for (const [k, r] of Object.entries(rules)) calls[k] = ({ e, say, node, args, obj, stmt }) => r(ctx(e, say), { node, args, obj, stmt });

	const single = (node: N): { id: N; init: N } | null => {
		if (node.type !== "VariableDeclaration" || node.declarations.length !== 1) return null;
		const v = node.declarations[0];
		return v.id.type === "Identifier" && v.init ? { id: v.id, init: unwrap(v.init) } : null;
	};

	/** `const inngest = new Inngest({ id })` and `export const fn = inngest.createFunction(…)`. */
	const define: StmtRule<InngestPhrases> = ({ node, e, d, say }) => {
		const s = single(node);
		if (!s || !usesInngest(e)) return false;
		const c = ctx(e, say);
		const as = e.ref(s.id.name);
		if (s.init.type === "NewExpression" && importedAs(c, s.init.callee)?.name === "Inngest") {
			e.emitDoc(d, D(say.client.create({ id: e.text(propOf(objectArg(s.init.arguments[0]), "id")), as })), node);
			return true;
		}
		const callee = s.init.type === "CallExpression" ? unwrap(s.init.callee) : null;
		if (callee?.type !== "MemberExpression" || callee.property?.name !== "createFunction") return false;
		const f = functionParts(c, s.init.arguments);
		if (!f) return false;
		e.emitDoc(d, D(say.fn.define({ ...f, as }), f.lines), node);
		return true;
	};

	/** `const user = await step.run(…)` / `return step.invoke(…)`: the step, then what happens to its result. */
	const stepResult: StmtRule<InngestPhrases> = ({ node, e, d, say }) => {
		const s = single(node);
		const ret = node.type === "ReturnStatement" ? unwrap(node.argument) : null;
		const call = s?.init ?? ret;
		const which = call ? isStepCall(call) : null;
		if (!which || which === "sleep" || which === "sleepUntil") return false;
		const c = ctx(e, say);
		const named = s && (which === "waitForEvent" || which === "waitForSignal") ? e.ref(s.id.name) : null;
		const doc = stepDoc(c, call, named);
		if (!doc) return false;
		if (named) e.emitDoc(d, doc, node);
		else if (s) e.emitDoc(d, D(e.say.declarations.callAs({ call: doc.t, name: e.ref(s.id.name) }), doc.kids), node);
		else e.emitDoc(d, D(e.say.statements.returnCall({ call: doc.t }), doc.kids), node);
		return true;
	};

	/** `export default serve(…)` and `export const { GET, POST, PUT } = serve(…)`. */
	const serveStatement: StmtRule<InngestPhrases> = ({ node, e, d, say }) => {
		const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
		const v = decl?.type === "VariableDeclaration" && decl.declarations.length === 1 ? decl.declarations[0] : null;
		const call = unwrap(node.type === "ExportDefaultDeclaration" ? node.declaration : v?.id.type === "ObjectPattern" ? v.init : null);
		if (call?.type !== "CallExpression") return false;
		const c = ctx(e, say);
		const names = v ? v.id.properties.map((p: N) => (p.value?.type === "Identifier" ? p.value.name : e.code(p))) : [];
		const doc = serveDoc(c, call, names.length ? e.g.list(names.map((n: string) => mk("c", n))) : null);
		if (!doc) return false;
		e.emitDoc(d, doc, node);
		return true;
	};

	return definePlugin<InngestPhrases>({
		name: "inngest",
		library: { name: "inngest", versions: ">=3 <5" },
		phrases: { en },
		errors: ["NonRetriableError", "RetryAfterError", "StepError"],
		calls,
		statements: [framed(serveStatement), framed(define), framed(stepResult)],
	});
};

declare module "@usenarrator/core" {
	interface PluginPhrases {
		inngest: __PluginPhrases;
	}
}
