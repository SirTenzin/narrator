import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { bullets, type Ctx, callbackDoc, findProp, isPluginModule, keyOf, objectArg, optionDoc } from "./shared";

type PluginRender = (c: Ctx, opts: N | null) => Doc;

/** Options rendered as "name: value" bullets under `title`, skipping keys the title already covers. */
function withOptions(c: Ctx, { title, opts, skip = [], extra = [] }: { title: string; opts: N | null; skip?: string[]; extra?: Doc[] }): Doc {
	const rest = (opts?.properties ?? [])
		.filter((p: N) => !skip.includes(keyOf(p) ?? ""))
		.map((p: N) => optionDoc({ e: c.e, prop: p, phrase: c.say.plugins.option }));
	const items = [...extra, ...rest];
	return D(title, bullets(c.e, items));
}

const docs =
	(pick: (c: Ctx) => string): PluginRender =>
	(c, opts) => {
		const path = findProp(opts, "path");
		const title = path ? c.say.plugins.docsAt({ docs: pick(c), path: c.e.text(path.value) }) : pick(c);
		return withOptions(c, { title, opts, skip: ["path"] });
	};

/** Official plugins by package (`@elysiajs/<pkg>`) and export name. */
const PLUGINS: Record<string, { pkg: string; render: PluginRender }> = {
	cors: { pkg: "cors", render: (c, opts) => withOptions(c, { title: c.say.plugins.cors, opts }) },
	swagger: { pkg: "swagger", render: docs((c) => c.say.plugins.swagger) },
	openapi: { pkg: "openapi", render: docs((c) => c.say.plugins.openapi) },
	jwt: {
		pkg: "jwt",
		render: (c, opts) => {
			const p = c.say.plugins;
			const name = findProp(opts, "name");
			const secret = findProp(opts, "secret");
			const exp = findProp(opts, "exp");
			const extra = [
				...(secret ? [D(p.jwtSecret({ secret: c.e.text(secret.value) }))] : []),
				...(exp ? [D(p.jwtExpires({ duration: c.e.text(exp.value) }))] : []),
			];
			const title = p.jwt({ name: name ? c.e.text(name.value) : c.e.prop("jwt") });
			return withOptions(c, { title, opts, skip: ["name", "secret", "exp"], extra });
		},
	},
	staticPlugin: {
		pkg: "static",
		render: (c, opts) => {
			const p = c.say.plugins;
			const assets = findProp(opts, "assets");
			const prefix = findProp(opts, "prefix");
			const title = p.staticFiles({ folder: assets ? c.e.text(assets.value) : null, prefix: prefix ? c.e.text(prefix.value) : null });
			return withOptions(c, { title, opts, skip: ["assets", "prefix"] });
		},
	},
	html: { pkg: "html", render: (c, opts) => withOptions(c, { title: c.say.plugins.html, opts }) },
	bearer: { pkg: "bearer", render: (c, opts) => withOptions(c, { title: c.say.plugins.bearer, opts }) },
	serverTiming: { pkg: "server-timing", render: (c, opts) => withOptions(c, { title: c.say.plugins.serverTiming, opts }) },
	opentelemetry: { pkg: "opentelemetry", render: (c, opts) => withOptions(c, { title: c.say.plugins.opentelemetry, opts }) },
	cron: {
		pkg: "cron",
		render: (c, opts) => {
			const p = c.say.plugins;
			const name = findProp(opts, "name");
			const pattern = findProp(opts, "pattern");
			const run = findProp(opts, "run");
			const title = p.cron({ name: name ? c.e.text(name.value) : "", pattern: pattern ? c.e.text(pattern.value) : "" });
			const extra = run ? [callbackDoc({ e: c.e, say: c.say, node: run.value, intro: p.cronRun })] : [];
			return withOptions(c, { title, opts, skip: ["name", "pattern", "run"], extra });
		},
	},
};

/** `cors()`, `swagger({...})`, … when imported from the official `@elysiajs/*` (or `@elysia/*`) package. */
export function pluginDoc(c: Ctx, node: N): Doc | null {
	const u = unwrap(node);
	if (u?.type !== "CallExpression" || unwrap(u.callee)?.type !== "Identifier") return null;
	const name = unwrap(u.callee).name;
	const plugin = Object.hasOwn(PLUGINS, name) ? PLUGINS[name]! : null;
	if (!plugin || !isPluginModule(c.state.imports.get(name), plugin.pkg)) return null;
	return plugin.render(c, objectArg(u.arguments[0]));
}

export const PLUGIN_NAMES = Object.keys(PLUGINS);
