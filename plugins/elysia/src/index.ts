import { D, type Doc } from "@usenarrator/core";
import { type CallRule, definePlugin, type Engine, type N, type StmtRule, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { appChainDoc, INSTANCE_METHODS, isNewElysia, serverDoc } from "./app";
import { jwtCall, problemCall, redirectCall, setAssignment, statusCall } from "./context";
import { clientDoc, EDEN_METHODS, edenCallDoc } from "./eden";
import { en } from "./en";
import type { ElysiaPhrases } from "./phrases";
import { PLUGIN_NAMES, pluginDoc } from "./plugins";
import { typeText } from "./schema";
import { type Ctx, isContextCall, newState, REPLY_CALLS, refresh, type Version } from "./shared";

export { en } from "./en";
export type { BaseType, ElysiaPhrases, HookScope, LifecycleEvent, RequestPart, StringFormat } from "./phrases";

export type ElysiaOptions = {
	/** Pin the Elysia major for APIs whose meaning changed in 2.0 (route argument order, `.error`, `.derive`). Defaults to reading both. */
	version?: 1 | 2;
};

type Rule = CallRule<ElysiaPhrases>;

const TYPEBOX_BUILDERS = [
	"Object",
	"String",
	"Number",
	"Integer",
	"Boolean",
	"Null",
	"Undefined",
	"Void",
	"Any",
	"Unknown",
	"Never",
	"Date",
	"BigInt",
	"Symbol",
	"Uint8Array",
	"Numeric",
	"BooleanString",
	"ObjectString",
	"ArrayString",
	"File",
	"Files",
	"Array",
	"Optional",
	"Union",
	"UnionEnum",
	"Literal",
	"Nullable",
	"MaybeEmpty",
	"Record",
	"Tuple",
	"Enum",
	"KeyOf",
	"Ref",
	"Partial",
	"Required",
	"Pick",
	"Omit",
	"Intersect",
	"Composite",
	"Not",
	"Cookie",
	"Form",
	"NoValidate",
];

/** Elysia (elysiajs.com) 1.x and the 2.0 beta: apps, routes, hooks, lifecycle, TypeBox schemas, official plugins, and the Eden treaty client. */
export const elysia = ({ version }: ElysiaOptions = {}): TsPlugin<ElysiaPhrases> => {
	const state = newState();
	/** A pinned version wins; otherwise the file's package decides, and both readings apply when it's unknown. */
	const versionOf = (e: Engine): Version => {
		if (version) return version;
		const major = e.libraryMajor("elysia");
		return major === 1 || major === 2 ? major : "auto";
	};
	const ctx = (e: Engine, say: ElysiaPhrases): Ctx => {
		const c = { e, say, version: versionOf(e), state };
		refresh(c);
		return c;
	};

	const chainRule =
		(eden: boolean): Rule =>
		({ node, e, say, stmt }) => {
			const c = ctx(e, say);
			return appChainDoc(c, node) ?? (eden ? edenCallDoc(c, { node, stmt }) : null);
		};

	const calls: Record<string, Rule> = {};
	for (const m of new Set([...INSTANCE_METHODS, ...EDEN_METHODS])) calls[`*.${m}`] = chainRule(EDEN_METHODS.includes(m));
	calls["new Elysia"] = ({ node, e, say }) => {
		const c = ctx(e, say);
		return isNewElysia(c, node) ? serverDoc(c, node) : null;
	};
	const schemaRule: Rule = ({ node, e, say }) => {
		const t = typeText(ctx(e, say), node);
		return t ? D(say.schema.of({ type: t })) : null;
	};
	for (const b of TYPEBOX_BUILDERS) calls[`*.${b}`] = schemaRule;
	const contextCall =
		(name: string, render: (c: Ctx, args: N[]) => Doc | null, skip?: Version): Rule =>
		({ args, e, say }) => {
			const c = ctx(e, say);
			return c.version !== skip && isContextCall(c, name) ? render(c, args) : null;
		};
	calls.status = contextCall("status", statusCall);
	calls.error = contextCall("error", statusCall, 2);
	calls.problem = contextCall("problem", problemCall, 1);
	calls.redirect = contextCall("redirect", redirectCall);
	calls["*.sign"] = ({ obj, args, e, say }) => jwtCall(ctx(e, say), { obj, args, verify: false });
	calls["*.verify"] = ({ obj, args, e, say }) => jwtCall(ctx(e, say), { obj, args, verify: true });
	for (const name of ["treaty", "edenTreaty"]) calls[name] = ({ node, e, say }) => clientDoc(ctx(e, say), node);
	for (const name of PLUGIN_NAMES) calls[name] = ({ node, e, say }) => pluginDoc(ctx(e, say), node);

	/** `return status(404, …)` / `return redirect(url)` read as "reply with …". */
	const replyStatement: StmtRule<ElysiaPhrases> = ({ node, e, d, say }) => {
		if (node.type !== "ReturnStatement" && node.type !== "ThrowStatement") return false;
		const arg = unwrap(node.argument);
		if (arg?.type !== "CallExpression" || unwrap(arg.callee)?.type !== "Identifier") return false;
		const rule = calls[unwrap(arg.callee).name];
		if (!rule || !REPLY_CALLS.has(unwrap(arg.callee).name)) return false;
		const r = rule({ node: arg, args: arg.arguments, obj: null, e, stmt: false, say }) as Doc | null;
		if (!r) return false;
		e.emitDoc(d, D(say.responses.reply({ response: r.t }), r.kids), node);
		return true;
	};
	const setStatement: StmtRule<ElysiaPhrases> = ({ node, e, d, say }) => {
		if (node.type !== "ExpressionStatement") return false;
		const r = setAssignment(ctx(e, say), node.expression);
		if (!r) return false;
		e.emitDoc(d, r, node);
		return true;
	};

	return definePlugin<ElysiaPhrases>({
		name: "elysia",
		library: { name: "elysia", versions: ">=1.0.0 <2.0.0 || >=2.0.0-0 <3.0.0" },
		phrases: { en },
		calls,
		statements: [replyStatement, setStatement],
		describeSchema: (e, n: N, say) => typeText(ctx(e, say), n),
	});
};

declare module "@usenarrator/core" {
	interface PluginPhrases {
		elysia: ElysiaPhrases;
	}
}
