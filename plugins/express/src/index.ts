import { D, type Doc } from "@usenarrator/core";
import { type CallRule, type CondRule, definePlugin, type Engine, type MemberRule, type StmtRule, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { appCall, builtinDoc, createDoc } from "./app";
import { en } from "./en";
import { APP_METHODS, factsReader, SOURCES } from "./facts";
import { nextDoc, RESPONSE_METHODS, requestCall, requestIs, requestMembers, responseDoc } from "./http";
import type { ExpressPhrases as __PluginPhrases, ExpressPhrases } from "./phrases";
import type { Ctx } from "./shared";

export { en } from "./en";
export type { Builtin, ExpressPhrases, Source } from "./phrases";

type Rule = CallRule<ExpressPhrases>;

/** Rules that share a key (`*.get` is a route, a setting and `req.get`) are tried in order. */
function add(calls: Record<string, Rule>, key: string, r: Rule) {
	const prev = calls[key];
	calls[key] = prev ? (p) => prev(p) ?? r(p) : r;
}

/** Express (expressjs.com) 4 and 5: apps and routers, routes, middleware, the request and response, error handlers and `listen`. */
export const express = (): TsPlugin<ExpressPhrases> => {
	const read = factsReader();
	const ctx = (e: Engine, say: ExpressPhrases): Ctx => ({ e, say, facts: read(e) });
	const calls: Record<string, Rule> = {};

	for (const m of APP_METHODS) add(calls, `*.${m}`, ({ e, say, node, obj, args }) => appCall(ctx(e, say), m, node, obj, args));
	for (const m of RESPONSE_METHODS)
		add(calls, `*.${m}`, ({ e, say, node, stmt }) => {
			const r = responseDoc(ctx(e, say), node);
			if (!r) return null;
			return stmt || !r.reply ? r.actions : r.reply;
		});
	for (const m of ["get", "header", "accepts"]) add(calls, `*.${m}`, ({ e, say, obj, args }) => requestCall(ctx(e, say), m, obj, args));
	for (const m of ["json", "urlencoded", "raw", "text", "static", "Router"])
		add(calls, `*.${m}`, ({ e, say, node }) => builtinDoc(ctx(e, say), node) ?? createDoc(ctx(e, say), node));
	for (const name of [
		"express",
		"Router",
		"cors",
		"helmet",
		"morgan",
		"cookieParser",
		"compression",
		"rateLimit",
		"session",
		"methodOverride",
		"favicon",
		"json",
		"urlencoded",
	])
		add(calls, name, ({ e, say, node }) => createDoc(ctx(e, say), node) ?? builtinDoc(ctx(e, say), node));
	add(calls, "next", ({ e, say, node }) => nextDoc(ctx(e, say), node));

	const conditions: Record<string, CondRule<ExpressPhrases>> = {
		"*.is": ({ e, say, obj, args, neg }) => requestIs(ctx(e, say), obj, args, neg),
	};

	const members: Record<string, MemberRule<ExpressPhrases>> = {};
	for (const [m, f] of Object.entries(requestMembers())) members[`*.${m}`] = ({ e, say, obj }) => f(ctx(e, say), obj);
	members["*.locals"] = ({ e, say, obj }) => {
		const c = ctx(e, say);
		return c.facts.active && /^(res|response)$/.test(unwrap(obj)?.name ?? "") ? D(say.response.locals) : null;
	};

	/** `return res.status(404).json(…)` and `return next(err)` read as the action, not "give back". */
	const returnStatement: StmtRule<ExpressPhrases> = ({ node, e, d, say }) => {
		if (node.type !== "ReturnStatement" || !node.argument) return false;
		const c = ctx(e, say);
		if (!c.facts.active) return false;
		let arg = unwrap(node.argument);
		if (arg?.type === "UnaryExpression" && arg.operator === "void") arg = unwrap(arg.argument);
		const doc: Doc | null = responseDoc(c, arg)?.actions ?? nextDoc(c, arg);
		if (!doc) return false;
		e.emitDoc(d, doc, node);
		return true;
	};

	/** `const express = require("express")` is an import, which the narration leaves out like ESM ones. */
	const requireStatement: StmtRule<ExpressPhrases> = ({ node }) => {
		if (node.type !== "VariableDeclaration" || node.declarations.length !== 1) return false;
		const init = unwrap(node.declarations[0].init);
		const from = init?.type === "CallExpression" && unwrap(init.callee)?.name === "require" ? init.arguments[0]?.value : null;
		return typeof from === "string" && (from === "express" || from === "body-parser" || from in SOURCES);
	};

	return definePlugin<ExpressPhrases>({
		name: "express",
		library: { name: "express", versions: ">=4 <6" },
		phrases: { en },
		calls,
		conditions,
		members,
		statements: [requireStatement, returnStatement],
	});
};

declare module "@usenarrator/core" {
	interface PluginPhrases {
		express: __PluginPhrases;
	}
}
