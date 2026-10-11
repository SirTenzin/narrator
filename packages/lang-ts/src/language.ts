import type { FileNarrator, NarrationProblem, RuleError, SourceLanguage } from "@usenarrator/core";
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

const lineOf = (src: string, offset: number) => {
	let line = 1;
	for (let i = src.indexOf("\n"); i !== -1 && i < offset; i = src.indexOf("\n", i + 1)) line++;
	return line;
};

const syntaxProblems = ({ errors, src, path }: { errors: ParseOutput["errors"]; src: string; path: string }): NarrationProblem[] =>
	errors.map((e: any) => {
		const offset = e?.labels?.[0]?.start ?? e?.start;
		return {
			path,
			message: typeof e === "string" ? e : String(e?.message ?? e),
			severity: "error",
			source: "parser",
			...(typeof offset === "number" ? { line: lineOf(src, offset) } : {}),
		};
	});

const ruleProblems = ({ errors, path }: { errors: RuleError[]; path: string }): NarrationProblem[] =>
	errors.map(({ plugin, rule, message, line }) => ({ path, message, severity: "warning", source: "plugin", plugin, rule, ...(line ? { line } : {}) }));

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
			const depsFor = ctx?.dependencies ?? dependencies;
			let problems: NarrationProblem[] = [];
			const e = engine(locale);
			const prepare = (path: string) => {
				problems = [];
				e.parseErrors = [];
				e.stats.ruleErrors = [];
				e.dependencies = depsFor?.(path) ?? {};
				setup?.({ engine: e, path });
			};
			// Syntax errors come from the first parse; recovery re-parses blanked text, which would repeat or hide them.
			const collect = (src: string, path: string) => {
				problems = [...syntaxProblems({ errors: e.parseErrors, src, path }), ...ruleProblems({ errors: e.stats.ruleErrors, path })];
			};
			return {
				narrate: (src, path) => {
					prepare(path);
					const result = e.narrate(src, path);
					collect(src, path);
					return { ...result, stats: e.stats, problems };
				},
				units: (src, path) => {
					prepare(path);
					const units = unitsOf(e, src, path);
					collect(src, path);
					return units;
				},
				problems: () => problems,
			};
		},
	};
}
