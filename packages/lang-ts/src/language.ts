import type { FileNarrator, NarrationProblem, SourceLanguage } from "@usenarrator/core";
import { Engine } from "./engine";
import type { ParseOutput, Parser } from "./parser";
import type { TsPlugin } from "./plugin";
import { std } from "./std";
import { unitsOf } from "./units";

export type TypeScriptOptions = {
	parser: Parser;
	/** Library and codebase plugins. Later plugins win when two rules match the same call. */
	plugins?: (TsPlugin | TsPlugin[])[];
	/** Runs before each file is narrated, e.g. to install cross-file hooks like `typeOfCall`. */
	setup?: (ctx: { engine: Engine; path: string }) => void;
	/** Override for a file's package dependencies; normally the narrator supplies them from `createDependencyIndex`. */
	dependencies?: (path: string) => Record<string, string> | undefined;
};

const TS_FILE = /\.(m|c)?[tj]sx?$/;

const lineOf = (src: string, offset: number) => {
	let line = 1;
	for (let i = src.indexOf("\n"); i !== -1 && i < offset; i = src.indexOf("\n", i + 1)) line++;
	return line;
};

const syntaxProblems = ({ errors, src, path }: { errors: ParseOutput["errors"]; src: string; path: string }): NarrationProblem[] =>
	errors.map((e: any) => {
		const offset = e?.labels?.[0]?.start;
		return {
			path,
			message: typeof e === "string" ? e : String(e?.message ?? e),
			severity: "error",
			source: "parser",
			...(typeof offset === "number" ? { line: lineOf(src, offset) } : {}),
		};
	});

/** The TS/JS source language. Narrates `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` (not `.d.ts`). */
export function typescript({
	parser,
	plugins = [],
	setup,
	dependencies,
}: TypeScriptOptions): SourceLanguage & { engine(locale: Parameters<SourceLanguage["create"]>[0]): Engine } {
	const all = [std, ...plugins.flat()];
	const engine: (locale: Parameters<SourceLanguage["create"]>[0]) => Engine = (locale) => {
		return new Engine({ parser, plugins: all, locale });
	};
	return {
		id: "typescript",
		handles: (path) => TS_FILE.test(path) && !path.endsWith(".d.ts"),
		ecosystems: ["npm"],
		engine,
		create(locale, ctx): FileNarrator {
			const depsFor = ctx?.dependencies ?? dependencies;
			let problems: NarrationProblem[] = [];
			let current = "";
			const recordingParser: Parser = (filename, src) => {
				const out = parser(filename, src);
				problems = syntaxProblems({ errors: out.errors ?? [], src, path: current });
				return out;
			};
			const e = new Engine({ parser: recordingParser, plugins: all, locale });
			const prepare = (path: string) => {
				current = path;
				problems = [];
				e.dependencies = depsFor?.(path) ?? {};
				setup?.({ engine: e, path });
			};
			return {
				narrate: (src, path) => {
					prepare(path);
					const result = e.narrate(src, path);
					return { ...result, stats: e.stats, problems };
				},
				units: (src, path) => {
					prepare(path);
					return unitsOf(e, src, path);
				},
				problems: () => problems,
			};
		},
	};
}
