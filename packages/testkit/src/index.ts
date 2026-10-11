import { createNarrator, describeProblem, type Locale, type Narration, renderText } from "@usenarrator/core";
import { type TsPlugin, typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en } from "@usenarrator/locale-en";

export type SnippetOptions = {
	plugins?: (TsPlugin | TsPlugin[])[];
	locale?: Locale;
	path?: string;
	/** The snippet's package dependencies, so plugins activate without an import in the snippet. */
	dependencies?: Record<string, string>;
};

const snippetNarrator = ({ plugins = [], locale = en, dependencies }: SnippetOptions) =>
	createNarrator({ languages: [typescript({ parser: oxcParser, plugins, dependencies: dependencies && (() => dependencies) })], locale });

// A narrator keeps going past a failing rule, but a plugin test should fail loudly instead.
const narrateStrictly = (code: string, opts: SnippetOptions): Narration => {
	const result = snippetNarrator(opts).narrate(code, opts.path ?? "snippet.ts");
	const crashes = result.problems.filter((p) => p.source !== "parser");
	if (crashes.length) throw new Error(crashes.map(describeProblem).join("\n"));
	return result;
};

/** Narrates a TS/JS snippet to plain text: the main assertion helper for plugin tests. Throws when a rule fails. */
export function narrate(code: string, opts: SnippetOptions = {}): string {
	return renderText(narrateStrictly(code, opts).lines);
}

/** Narrates and also reports how much fell back to raw code, so tests can assert full coverage. */
export function narrateWithStats(code: string, opts: SnippetOptions = {}) {
	const { lines, stats } = narrateStrictly(code, opts);
	return { text: renderText(lines), fallbacks: stats.fallbacks };
}

const keyPaths = (o: unknown, prefix = ""): string[] =>
	o && typeof o === "object" && !Array.isArray(o)
		? Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keyPaths(v, `${prefix}${k}.`) : [`${prefix}${k}`]))
		: [];

/** Keys a translation is missing (or has extra) compared to the English phrasebook. */
export function phrasebookGaps(reference: object, translation: object): { missing: string[]; extra: string[] } {
	const want = new Set(keyPaths(reference));
	const have = new Set(keyPaths(translation));
	return { missing: [...want].filter((k) => !have.has(k)), extra: [...have].filter((k) => !want.has(k)) };
}
