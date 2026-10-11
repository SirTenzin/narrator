import { createNarrator, type Locale, renderText } from "@usenarrator/core";
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

/** Narrates a TS/JS snippet to plain text: the main assertion helper for plugin tests. */
export function narrate(code: string, opts: SnippetOptions = {}): string {
	return renderText(snippetNarrator(opts).narrate(code, opts.path ?? "snippet.ts").lines);
}

/** Narrates and also reports how much fell back to raw code, so tests can assert full coverage. */
export function narrateWithStats(code: string, opts: SnippetOptions = {}) {
	const { lines, stats } = snippetNarrator(opts).narrate(code, opts.path ?? "snippet.ts");
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
