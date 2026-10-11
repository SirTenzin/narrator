import { D } from "@usenarrator/core";
import { type CallRule, type CondRule, definePlugin, type Engine, type MemberRule, type StmtRule, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { en } from "./en";
import { factsReader, isReply, isRequest, isServer, SERVER_METHODS } from "./facts";
import type { FastifyPhrases as __PluginPhrases, FastifyPhrases } from "./phrases";
import { createDoc, fpDoc, type Rc, REPLY_METHODS, replyDoc, serverCall, type Version } from "./server";
import { codeText } from "./shared";

export { en } from "./en";
export type { FastifyPhrases, Hook, JsonType, Part, Plugin } from "./phrases";

export type FastifyOptions = {
	/** Pin the major for `reply.redirect`, whose arguments swapped in v5 (`(url, code)`, was `(code, url)`). Defaults to the package's declared version; literal status codes settle it either way. */
	version?: 4 | 5;
};

type Rule = CallRule<FastifyPhrases>;

const REQUEST_MEMBERS = ["params", "query", "body", "headers", "ip", "hostname", "url", "method", "id", "log", "cookies"] as const;

function add(calls: Record<string, Rule>, key: string, r: Rule) {
	const prev = calls[key];
	calls[key] = prev ? (p) => prev(p) ?? r(p) : r;
}

/** Fastify (fastify.dev) v4 and v5: servers, routes with JSON Schema validation, replies, hooks, plugins, decorators and `listen`. */
export const fastify = ({ version }: FastifyOptions = {}): TsPlugin<FastifyPhrases> => {
	const read = factsReader();
	const returns = new WeakSet<object>();
	const ctx = (e: Engine, say: FastifyPhrases): Rc => {
		const m = e.libraryMajor("fastify");
		const major: Version = version ?? (m === 4 || m === 5 ? m : m !== null && m < 4 ? 4 : null);
		return { e, say, facts: read(e), major, returns };
	};
	const calls: Record<string, Rule> = {};
	for (const m of SERVER_METHODS) add(calls, `*.${m}`, ({ e, say, obj, args }) => serverCall(ctx(e, say), m, obj, args));
	for (const m of REPLY_METHODS)
		add(calls, `*.${m}`, ({ e, say, node, stmt }) => {
			const r = replyDoc(ctx(e, say), node);
			if (!r) return null;
			return stmt || !r.reply ? r.actions : r.reply;
		});
	for (const name of ["Fastify", "fastify", "require()", "fp", "fastifyPlugin", "plugin"])
		add(calls, name, ({ e, say, node }) => createDoc(ctx(e, say), node) ?? fpDoc(ctx(e, say), node));

	add(calls, "*.jwtVerify", ({ e, say, obj }) => (obj && isRequest(ctx(e, say).facts, obj) ? D(say.request.jwtVerify) : null));

	const conditions: Record<string, CondRule<FastifyPhrases>> = {
		"*.hasDecorator": ({ e, say, obj, args, neg }) =>
			obj && args[0] && isServer(ctx(e, say).facts, obj) ? D(say.decorate.has({ name: codeText(e, args[0]), neg })) : null,
	};

	const members: Record<string, MemberRule<FastifyPhrases>> = {};
	for (const m of REQUEST_MEMBERS) members[`*.${m}`] = ({ e, say, obj }) => (isRequest(ctx(e, say).facts, obj) ? D(say.request[m]) : null);
	members["*.user"] = ({ e, say, obj }) => {
		const f = ctx(e, say).facts;
		const auth = [...f.imports.values()].some((i) => i.from === "@fastify/jwt" || i.from === "@fastify/passport");
		return auth && isRequest(f, obj) ? D(say.request.user) : null;
	};
	members["*.raw"] = ({ e, say, obj }) => (isReply(ctx(e, say).facts, obj) ? D(say.reply.raw) : null);

	/** A handler's own `return x` is its reply; `return reply.code(404).send(…)` reads as the action. */
	const returnStatement: StmtRule<FastifyPhrases> = ({ node, e, d, say }) => {
		if (node.type !== "ReturnStatement") return false;
		const rc = ctx(e, say);
		if (!rc.facts.active) return false;
		const arg = unwrap(node.argument);
		const chain = arg ? replyDoc(rc, arg) : null;
		if (chain) {
			e.emitDoc(d, chain.actions, node);
			return true;
		}
		if (!returns.has(node) || !arg) return false;
		if (isReply(rc.facts, arg)) return true;
		const v = e.noun(arg.type === "AwaitExpression" ? arg.argument : arg);
		e.emitDoc(d, D(say.reply.reply({ response: v.t }), v.kids), node);
		return true;
	};

	/** `const fastify = require("fastify")({ logger: true })` keeps its creation; a bare `require("fastify")` is an import. */
	const requireStatement: StmtRule<FastifyPhrases> = ({ node }) => {
		if (node.type !== "VariableDeclaration" || node.declarations.length !== 1) return false;
		const init = unwrap(node.declarations[0].init);
		const from = init?.type === "CallExpression" && unwrap(init.callee)?.name === "require" ? init.arguments[0]?.value : null;
		return typeof from === "string" && (from === "fastify" || from === "fastify-plugin" || from.startsWith("@fastify/"));
	};

	return definePlugin<FastifyPhrases>({
		name: "fastify",
		library: { name: "fastify", versions: ">=4 <6" },
		phrases: { en },
		calls,
		conditions,
		members,
		statements: [requireStatement, returnStatement],
	});
};

declare module "@usenarrator/core" {
	interface PluginPhrases {
		fastify: __PluginPhrases;
	}
}
