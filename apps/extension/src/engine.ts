import { buildDiffReport, createDependencyIndex, createNarrator, type FileNarrator, type Locale } from "@usenarrator/core";
import type { TsPlugin } from "@usenarrator/lang-ts";
import { looksLikeSqlSource, type PluginId, type PluginVersions, selectPlugins, versionsFor } from "./deps";
import type { NarrateJob, NarrateResult } from "./protocol";

type SqlParser = import("@usenarrator/plugin-sql").SqlParser;

/** Each plugin module is its own chunk, fetched only when the change's packages use that library. */
const LOADERS: Record<PluginId, (v: PluginVersions) => Promise<TsPlugin[]>> = {
	zod: async () => [(await import("@usenarrator/plugin-zod")).zod()],
	testing: async () => [(await import("@usenarrator/plugin-testing")).testing()],
	drizzle: async () => [(await import("@usenarrator/plugin-drizzle")).drizzle()],
	betterAuth: async () => [(await import("@usenarrator/plugin-better-auth")).betterAuth()],
	effect: async (v) => {
		const [core, platform, sql] = await Promise.all([
			import("@usenarrator/plugin-effect"),
			import("@usenarrator/plugin-effect/platform"),
			import("@usenarrator/plugin-effect/sql"),
		]);
		return [core.effect({ version: v.effect }), platform.effectPlatform(), sql.effectSql()];
	},
	effectTesting: async () => [(await import("@usenarrator/plugin-effect/testing")).effectTesting()],
	hono: async () => [(await import("@usenarrator/plugin-hono")).hono()],
	elysia: async (v) => [(await import("@usenarrator/plugin-elysia")).elysia({ version: v.elysia })],
	aiSdk: async (v) => [(await import("@usenarrator/plugin-ai-sdk")).aiSdk({ version: v.aiSdk })],
	decimal: async () => [(await import("@usenarrator/plugin-decimal")).decimal()],
	autumn: async () => (await import("@usenarrator/example-autumn")).autumn(),
	react: async () => [(await import("@usenarrator/plugin-react")).react()],
	nextjs: async () => (await import("@usenarrator/plugin-nextjs")).nextjs(),
	tanstackQuery: async () => [(await import("@usenarrator/plugin-tanstack-query")).tanstackQuery()],
	trpc: async () => [(await import("@usenarrator/plugin-trpc")).trpc()],
	express: async () => [(await import("@usenarrator/plugin-express")).express()],
	fastify: async () => [(await import("@usenarrator/plugin-fastify")).fastify()],
	bullmq: async () => [(await import("@usenarrator/plugin-bullmq")).bullmq()],
	inngest: async () => [(await import("@usenarrator/plugin-inngest")).inngest()],
	triggerDev: async () => [(await import("@usenarrator/plugin-trigger-dev")).triggerDev()],
	temporal: async () => [(await import("@usenarrator/plugin-temporal")).temporal()],
	stripe: async () => [(await import("@usenarrator/plugin-stripe")).stripe()],
	autumnJs: async () => [(await import("@usenarrator/plugin-autumn-js")).autumnJs()],
	prisma: async () => [(await import("@usenarrator/plugin-prisma")).prisma()],
	kysely: async () => [(await import("@usenarrator/plugin-kysely")).kysely()],
	valibot: async () => [(await import("@usenarrator/plugin-valibot")).valibot()],
	arktype: async () => [(await import("@usenarrator/plugin-arktype")).arktype()],
};

/** Later plugins win, so this is the CLI's order; the Autumn preset already bundles drizzle and decimal. */
const ORDER: PluginId[] = [
	"zod",
	"testing",
	"effect",
	"effectTesting",
	"betterAuth",
	"hono",
	"elysia",
	"aiSdk",
	"react",
	"nextjs",
	"tanstackQuery",
	"trpc",
	"express",
	"fastify",
	"bullmq",
	"inngest",
	"triggerDev",
	"temporal",
	"stripe",
	"autumnJs",
	"prisma",
	"kysely",
	"valibot",
	"arktype",
	"drizzle",
	"decimal",
	"autumn",
];
const pluginIds = (selected: Set<PluginId>) => ORDER.filter((id) => selected.has(id) && !(selected.has("autumn") && (id === "drizzle" || id === "decimal")));

let sqlParser: SqlParser | null = null;
let base: Promise<{
	locale: Locale;
	typescript: typeof import("@usenarrator/lang-ts").typescript;
	parser: import("@usenarrator/lang-ts").Parser;
	sql: TsPlugin;
}> | null = null;

const loadBase = (wasmUrl: string) =>
	(base ??= (async () => {
		const [lang, wasm, locale, sql] = await Promise.all([
			import("@usenarrator/lang-ts"),
			import("@usenarrator/lang-ts/wasm"),
			import("@usenarrator/locale-en"),
			import("@usenarrator/plugin-sql"),
		]);
		const parser = await wasm.createWasmParser({ wasm: wasmUrl });
		return { locale: locale.en, typescript: lang.typescript, parser, sql: sql.sql({ parser: () => sqlParser }) };
	})());

const versionKey = (v: PluginVersions) => `${v.effect ?? ""}|${v.elysia ?? ""}|${v.aiSdk ?? ""}`;

/** Narrates a fetched change: loads the parser, the plugins this change needs, and the SQL parser if any file holds SQL. */
export async function narrate({ owner, files, manifests, wasmUrl }: NarrateJob, progress: (t: string) => void = () => {}): Promise<NarrateResult> {
	const paths = files.flatMap((f) => (f.oldPath && f.oldPath !== f.path ? [f.path, f.oldPath] : [f.path]));
	const index = createDependencyIndex({ manifests: new Map(manifests) });
	const npmDeps = (p: string) => index.forFile(p, "npm");
	const union = manifests.length ? Object.assign({}, ...paths.map(npmDeps)) : null;
	const ids = pluginIds(selectPlugins({ union, paths, owner }));
	const needsSql = files.some((f) => looksLikeSqlSource(f.oldSrc) || looksLikeSqlSource(f.newSrc));
	progress(`Loading the parser and ${ids.length + 1} plugin${ids.length ? "s" : ""}…`);
	const [b] = await Promise.all([
		loadBase(wasmUrl),
		needsSql && !sqlParser ? import("@usenarrator/plugin-sql/pgsql").then((m) => (sqlParser = m.pgsqlParser)) : null,
	]);

	const narrators = new Map<string, Promise<(path: string) => FileNarrator>>();
	const narratorFor = (v: PluginVersions) => {
		const key = versionKey(v);
		if (!narrators.has(key))
			narrators.set(
				key,
				Promise.all(ids.map((id) => LOADERS[id](v))).then(
					(loaded) =>
						createNarrator({
							languages: [b.typescript({ parser: b.parser, plugins: [...loaded.flat(), b.sql] })],
							locale: b.locale,
							dependencies: index,
						}).fileNarrator,
				),
			);
		return narrators.get(key)!;
	};
	const byPath = new Map<string, FileNarrator>();
	await Promise.all(paths.map(async (p) => byPath.set(p, (await narratorFor(versionsFor(npmDeps(p))))(p))));
	progress("Narrating both sides…");
	const out = buildDiffReport({ files, narratorFor: (p) => byPath.get(p) ?? byPath.get(files[0]!.path)!, resolve: () => null });
	return { files: out, plugins: [...ids, ...(needsSql ? ["sql (pgsql parser)"] : ["sql"])] };
}
