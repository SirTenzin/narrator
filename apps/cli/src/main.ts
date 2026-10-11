import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { contentSkipReason, createNarrator, type DependencyIndex, describeProblem, type Locale } from "@usenarrator/core";
import { type TsPlugin, typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en } from "@usenarrator/locale-en";
import { changedFilesFromGit, findRepoRoot, gitAttributeSkips, loadDependencyIndex } from "@usenarrator/node";
import { type CliArgs, parseArgs, USAGE } from "./args";
import { displayPath, expandTargets } from "./inputs";
import { renderDiff, renderFiles } from "./output";
import { detectPlugins, loadPlugins, PLUGINS } from "./plugins";

export type RunOptions = {
	argv: string[];
	isTTY: boolean;
	/** Plugins added after the selected ones, e.g. a codebase's own rules. */
	extraPlugins?: TsPlugin[];
	/** Receives notes that aren't part of the output (problems, skipped files); the CLI prints them to stderr. */
	warn?: (message: string) => void;
};

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

function buildNarrator({
	args,
	index,
	paths,
	locale,
	extraPlugins = [],
}: {
	args: CliArgs;
	index: DependencyIndex;
	paths: string[];
	locale: Locale;
	extraPlugins?: TsPlugin[];
}) {
	const plugins = dedupeByName([...loadPlugins(pluginNames({ args, index, paths })), ...extraPlugins]);
	return createNarrator({ languages: [typescript({ parser: oxcParser, plugins })], locale, dependencies: index });
}

const skippedNote = (count: number) =>
	`Skipped ${count} file${count === 1 ? " that looks" : "s that look"} generated, vendored or minified; pass --include-generated to narrate ${count === 1 ? "it" : "them"}.`;

const readStdin = () => readFileSync(0, "utf8");

/** Runs the CLI and returns its output; throws with a message for the user on bad input. */
export async function run({ argv, isTTY, extraPlugins, warn = () => {} }: RunOptions): Promise<string> {
	const args = parseArgs({ argv, isTTY });
	if (args.command === "help") return USAGE;
	const locale = await loadLocale(args.locale);
	const accepts = typescript({ parser: oxcParser }).handles;

	if (args.command === "diff") {
		const range = args.targets[0];
		if (!range) throw new Error(`narrator diff needs a range, e.g. main..HEAD\n\n${USAGE}`);
		const root = findRepoRoot(process.cwd());
		const files = changedFilesFromGit({ root, range, includeGenerated: args.includeGenerated, accepts });
		const index = loadDependencyIndex({ root });
		const narrator = buildNarrator({ args, index, paths: files.filter((f) => !f.skipped).map((f) => f.path), locale, extraPlugins });
		const opts = { includeGenerated: args.includeGenerated };
		return renderDiff({ structured: () => narrator.diffFiles(files, opts), html: () => narrator.diff(files, opts), format: args.format });
	}

	const first = args.targets[0] && existsSync(args.targets[0]) ? resolve(args.targets[0]) : process.cwd();
	const root = findRepoRoot(statSync(first).isDirectory() ? first : dirname(first));
	const index = loadDependencyIndex({ root });
	if (!args.targets.length) {
		const narrator = buildNarrator({ args, index, paths: [resolve("stdin.ts")], locale, extraPlugins });
		const result = narrator.narrate(readStdin(), "stdin.ts");
		for (const p of result.problems) warn(`stdin: ${describeProblem(p)}`);
		return renderFiles({ files: [{ ...result, path: "stdin" }], format: args.format });
	}
	const named = new Set(args.targets.filter((t) => existsSync(t) && !statSync(t).isDirectory()).map((t) => resolve(t)));
	const found = expandTargets({ targets: args.targets, accepts, includeGenerated: args.includeGenerated }).map((p) => resolve(p));
	if (!found.length) throw new Error(`No TS/JS files match ${args.targets.join(" ")}`);
	const attributeSkips = args.includeGenerated ? new Map() : gitAttributeSkips({ root, paths: found.map((p) => relative(root, p)) });
	const sources = found
		.map((path) => ({ path, src: readFileSync(path, "utf8") }))
		.filter(({ path, src }) => args.includeGenerated || named.has(path) || !(attributeSkips.has(relative(root, path)) || contentSkipReason(src)));
	if (sources.length < found.length) warn(skippedNote(found.length - sources.length));
	if (!sources.length) throw new Error(`Only generated files match ${args.targets.join(" ")}; pass --include-generated to narrate them`);
	const narrator = buildNarrator({ args, index, paths: sources.map((s) => s.path), locale, extraPlugins });
	const files = sources.map(({ path, src }) => ({ ...narrator.narrate(src, path), path: displayPath(path) }));
	for (const f of files) for (const p of f.problems) warn(`${f.path}: ${describeProblem(p)}`);
	return renderFiles({ files, format: args.format });
}

/** CLI entry: prints the output, or the error, and returns the exit code. */
export async function main(argv: string[], opts: Pick<RunOptions, "extraPlugins"> = {}): Promise<number> {
	try {
		console.log(await run({ argv, isTTY: !!process.stdout.isTTY, warn: (message) => console.error(message), ...opts }));
		return 0;
	} catch (e) {
		console.error(e instanceof Error ? e.message : String(e));
		return 1;
	}
}
