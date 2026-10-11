import type { FileNarrator, SourceLanguage } from "@usenarrator/core";
import { Engine } from "./engine";
import type { Parser } from "./parser";
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
			const e = engine(locale);
			const depsFor = ctx?.dependencies ?? dependencies;
			return {
				narrate: (src, path) => {
					e.dependencies = depsFor?.(path) ?? {};
					setup?.({ engine: e, path });
					return { ...e.narrate(src, path), stats: e.stats };
				},
				units: (src, path) => {
					e.dependencies = depsFor?.(path) ?? {};
					setup?.({ engine: e, path });
					return unitsOf(e, src, path);
				},
			};
		},
	};
}
