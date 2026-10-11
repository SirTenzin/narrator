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

const parserError = (what: string) =>
	new Error(
		`Narrator: typescript({ parser }) ${what}. Pass \`oxcParser\` from "@usenarrator/lang-ts/oxc", or \`await createWasmParser()\` from "@usenarrator/lang-ts/wasm".`,
	);

/** Fails with a readable message when the parser is mis-wired, e.g. `createWasmParser` passed without calling and awaiting it. */
function checkedParser(parser: Parser): Parser {
	if (typeof (parser as any)?.then === "function") throw parserError("got a Promise; await createWasmParser() before creating the narrator");
	if (typeof parser !== "function") throw parserError(`needs a function, but got ${parser === null ? "null" : typeof parser}`);
	return (filename, src) => {
		const out: any = parser(filename, src);
		if (typeof out?.then === "function") {
			out.then(undefined, () => {});
			throw parserError("returned a Promise; pass the result of `await createWasmParser()`, not createWasmParser itself");
		}
		if (!Array.isArray(out?.program?.body)) throw parserError("returned something that is not a parsed program");
		return out;
	};
}

/** The TS/JS source language. Narrates `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` (not `.d.ts`). */
export function typescript({
	parser,
	plugins = [],
	setup,
	dependencies,
}: TypeScriptOptions): SourceLanguage & { engine(locale: Parameters<SourceLanguage["create"]>[0]): Engine } {
	const all = [std, ...plugins.flat()];
	parser = checkedParser(parser);
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
