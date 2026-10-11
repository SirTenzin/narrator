import { D, type Doc } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "../engine";
import type { CallRule, CondRule } from "../plugin";
import type { StdPhrases } from "./phrases";

type Calls = Record<string, CallRule<StdPhrases>>;
type Ctx = Parameters<CallRule<StdPhrases>>[0];

const MODULES = { path: /^(node:)?path(\/posix)?$/, fs: /^(node:)?fs(\/promises)?$/, os: /^(node:)?os$/ };

/** Whether this call's function came from a Node module: `join(…)` imported from "path", or `path.join(…)` on its namespace. */
function fromModule(e: Engine, node: N, mod: keyof typeof MODULES): boolean {
	const c = unwrap(node.callee);
	const local = c.type === "Identifier" ? c.name : c.type === "MemberExpression" && unwrap(c.object).type === "Identifier" ? unwrap(c.object).name : null;
	const from = local ? e.imports.get(local)?.from : undefined;
	if (from) return MODULES[mod].test(from);
	return c.type === "MemberExpression" && unwrap(c.object).name === mod;
}

const node =
	(mod: keyof typeof MODULES, render: (ctx: Ctx) => Doc | null): CallRule<StdPhrases> =>
	(ctx) =>
		fromModule(ctx.e, ctx.node, mod) ? render(ctx) : null;

const text = (e: Engine, args: N[], i: number) => (args[i] ? e.text(args[i]) : "");

const pathRules: Calls = {
	join: node("path", ({ args, e, say }) => D(say.node.path({ parts: args.map((a) => e.text(a)) }))),
	resolve: node("path", ({ args, e, say }) => D(say.node.fullPath({ parts: args.map((a) => e.text(a)) }))),
	dirname: node("path", ({ args, e, say }) => D(say.node.folderOf({ path: text(e, args, 0) }))),
	basename: node("path", ({ args, e, say }) => D(say.node.fileNameOf({ path: text(e, args, 0) }))),
	extname: node("path", ({ args, e, say }) => D(say.node.extensionOf({ path: text(e, args, 0) }))),
	tmpdir: node("os", ({ say }) => D(say.node.tmpdir)),
	homedir: node("os", ({ say }) => D(say.node.homedir)),
};

const fsRules: Calls = {
	readFileSync: node("fs", ({ args, e, say }) => D(say.node.readFile({ path: text(e, args, 0) }))),
	readFile: node("fs", ({ args, e, say }) => D(say.node.readFile({ path: text(e, args, 0) }))),
	writeFileSync: node("fs", ({ args, e, say }) => D(say.node.writeFile({ path: text(e, args, 0), data: text(e, args, 1) }))),
	writeFile: node("fs", ({ args, e, say }) => D(say.node.writeFile({ path: text(e, args, 0), data: text(e, args, 1) }))),
	appendFileSync: node("fs", ({ args, e, say }) => D(say.node.appendFile({ path: text(e, args, 0), data: text(e, args, 1) }))),
	appendFile: node("fs", ({ args, e, say }) => D(say.node.appendFile({ path: text(e, args, 0), data: text(e, args, 1) }))),
	mkdirSync: node("fs", ({ args, e, say }) => D(say.node.mkdir({ path: text(e, args, 0) }))),
	mkdir: node("fs", ({ args, e, say }) => D(say.node.mkdir({ path: text(e, args, 0) }))),
	mkdtempSync: node("fs", ({ args, e, say }) => D(say.node.mkdtemp({ prefix: text(e, args, 0) }))),
	mkdtemp: node("fs", ({ args, e, say }) => D(say.node.mkdtemp({ prefix: text(e, args, 0) }))),
	rmSync: node("fs", ({ args, e, say }) => D(say.node.remove({ path: text(e, args, 0) }))),
	rm: node("fs", ({ args, e, say }) => D(say.node.remove({ path: text(e, args, 0) }))),
	unlinkSync: node("fs", ({ args, e, say }) => D(say.node.remove({ path: text(e, args, 0) }))),
	unlink: node("fs", ({ args, e, say }) => D(say.node.remove({ path: text(e, args, 0) }))),
	readdirSync: node("fs", ({ args, e, say }) => D(say.node.readdir({ path: text(e, args, 0) }))),
	readdir: node("fs", ({ args, e, say }) => D(say.node.readdir({ path: text(e, args, 0) }))),
	statSync: node("fs", ({ args, e, say }) => D(say.node.stat({ path: text(e, args, 0) }))),
	stat: node("fs", ({ args, e, say }) => D(say.node.stat({ path: text(e, args, 0) }))),
	renameSync: node("fs", ({ args, e, say }) => D(say.node.rename({ from: text(e, args, 0), to: text(e, args, 1) }))),
	rename: node("fs", ({ args, e, say }) => D(say.node.rename({ from: text(e, args, 0), to: text(e, args, 1) }))),
	copyFileSync: node("fs", ({ args, e, say }) => D(say.node.copy({ from: text(e, args, 0), to: text(e, args, 1) }))),
	copyFile: node("fs", ({ args, e, say }) => D(say.node.copy({ from: text(e, args, 0), to: text(e, args, 1) }))),
};

/** `existsSync(p)` as a yes/no condition. */
export const nodeConditions: Record<string, CondRule<StdPhrases>> = {
	existsSync: (ctx) => (fromModule(ctx.e, ctx.node, "fs") ? D(ctx.say.node.exists({ path: text(ctx.e, ctx.args, 0), neg: ctx.neg })) : null),
};

/** Node's path, fs and os helpers; each rule is keyed both bare (`join`) and on its namespace (`*.join`). */
export const nodeRules: Calls = Object.fromEntries(
	Object.entries({
		...pathRules,
		...fsRules,
		existsSync: (ctx: Ctx) => {
			if (!fromModule(ctx.e, ctx.node, "fs")) return null;
			return D(ctx.say.whether({ cond: ctx.say.node.exists({ path: text(ctx.e, ctx.args, 0), neg: false }) }));
		},
	}).flatMap(([k, r]) => [
		[k, r],
		[`*.${k}`, r],
	]),
);
