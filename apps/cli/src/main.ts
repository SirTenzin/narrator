import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createNarrator, type DependencyIndex, type Locale } from "@usenarrator/core";
import { autumn } from "@usenarrator/example-autumn";
import { type TsPlugin, typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en } from "@usenarrator/locale-en";
import { findRepoRoot, loadDependencyIndex } from "@usenarrator/node";
import { type CliArgs, parseArgs, USAGE } from "./args";
import { changedFiles, displayPath, expandTargets } from "./inputs";
import { renderDiff, renderFiles } from "./output";
import { detectPlugins, loadPlugins, PLUGINS } from "./plugins";

const PRESETS: Record<string, () => TsPlugin[]> = { autumn };

async function loadLocale(id: string): Promise<Locale> {
	if (id === "en") return en;
	const mod = (await import(`@usenarrator/locale-${id}`).catch(() => null)) as Record<string, Locale> | null;
	const locale = mod?.[id.replace(/-/g, "")] ?? mod?.default ?? mod?.locale;
	if (!locale) throw new Error(`Locale "${id}" not found: install @usenarrator/locale-${id}`);
	return locale;
}

/** `--plugins` as given, or every plugin whose library the targets' manifests list (all of them when no manifest lists anything). */
function pluginNames({ args, index, paths }: { args: CliArgs; index: DependencyIndex; paths: string[] }): string[] {
	if (args.plugins?.includes("all")) return Object.keys(PLUGINS);
	if (args.plugins) return args.plugins.filter((p) => p !== "none");
	const names = new Set(paths.flatMap((p) => Object.keys(index.forFile(p, "npm"))));
	return names.size ? detectPlugins(names) : Object.keys(PLUGINS);
}

const dedupeByName = (plugins: TsPlugin[]) => plugins.filter((p, i) => plugins.findIndex((q) => q.name === p.name) === i);

function buildNarrator({ args, index, paths, locale }: { args: CliArgs; index: DependencyIndex; paths: string[]; locale: Locale }) {
	const preset = args.preset ? PRESETS[args.preset] : null;
	if (args.preset && !preset) throw new Error(`Unknown preset "${args.preset}". Available: ${Object.keys(PRESETS).join(", ")}`);
	const plugins = dedupeByName([...loadPlugins(pluginNames({ args, index, paths })), ...(preset?.() ?? [])]);
	return createNarrator({ languages: [typescript({ parser: oxcParser, plugins })], locale, dependencies: index });
}

const readStdin = () => readFileSync(0, "utf8");

/** Runs the CLI and returns its output; throws with a message for the user on bad input. */
export async function run({ argv, isTTY }: { argv: string[]; isTTY: boolean }): Promise<string> {
	const args = parseArgs({ argv, isTTY });
	if (args.command === "help") return USAGE;
	const locale = await loadLocale(args.locale);

	if (args.command === "diff") {
		const range = args.targets[0];
		if (!range) throw new Error(`narrator diff needs a range, e.g. main..HEAD\n\n${USAGE}`);
		const root = findRepoRoot(process.cwd());
		const files = changedFiles({ root, range });
		const index = loadDependencyIndex({ root });
		const narrator = buildNarrator({ args, index, paths: files.map((f) => f.path), locale });
		return renderDiff({ structured: () => narrator.diffFiles(files), html: () => narrator.diff(files), format: args.format });
	}

	const root = findRepoRoot(args.targets[0] ? dirname(resolve(args.targets[0])) : process.cwd());
	const index = loadDependencyIndex({ root });
	if (!args.targets.length) {
		const narrator = buildNarrator({ args, index, paths: [resolve("stdin.ts")], locale });
		const { lines, errors } = narrator.narrate(readStdin(), "stdin.ts");
		return renderFiles({ files: [{ path: "stdin", lines, errors }], format: args.format });
	}
	const ts = typescript({ parser: oxcParser });
	const paths = expandTargets({ targets: args.targets, accepts: ts.handles }).map((p) => resolve(p));
	if (!paths.length) throw new Error(`No TS/JS files match ${args.targets.join(" ")}`);
	const narrator = buildNarrator({ args, index, paths, locale });
	const files = paths.map((path) => ({ path: displayPath(path), ...narrator.narrate(readFileSync(path, "utf8"), path) }));
	return renderFiles({ files, format: args.format });
}

/** CLI entry: prints the output, or the error, and returns the exit code. */
export async function main(argv: string[]): Promise<number> {
	try {
		console.log(await run({ argv, isTTY: !!process.stdout.isTTY }));
		return 0;
	} catch (e) {
		console.error(e instanceof Error ? e.message : String(e));
		return 1;
	}
}
