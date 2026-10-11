import type { DependencyIndex } from "./dependencies";
import type { FileNarration, FileNarrator, NarrationProblem, SourceLanguage } from "./language";
import type { Locale } from "./locale";
import { buildDiffReport, type ChangedFile, type DiffOptions, diffFiles, type FileDiff, type FileJson, type Resolver } from "./report";

/** A file's narration with everything that went wrong in it; a file that couldn't be narrated has no lines and one `narrator` problem. */
export type Narration = FileNarration & { problems: NarrationProblem[] };

export type Narrator = {
	locale: Locale;
	canNarrate(path: string): boolean;
	/** Never throws for bad code or a failing plugin: check `problems`. Throws only when no language handles `path`. */
	narrate(src: string, path: string): Narration;
	fileNarrator(path: string): FileNarrator;
	/** HTML-ready rows for a change set; `resolve` turns names into links. */
	diff(files: ChangedFile[], opts?: { resolve?: Resolver } & DiffOptions): FileJson[];
	/** The same change set as structured units with their `Line`s; render with `renderDiffText`. */
	diffFiles(files: ChangedFile[], opts?: DiffOptions): FileDiff[];
};

export function createNarrator({
	languages,
	locale,
	dependencies,
}: {
	languages: SourceLanguage[];
	locale: Locale;
	/** Manifests found in the repo (see `createDependencyIndex`), so plugins know what each file's package uses. */
	dependencies?: DependencyIndex;
}): Narrator {
	const languageFor = (path: string) => languages.find((l) => l.handles(path));
	const fileNarrator = (path: string) => {
		const language = languageFor(path);
		if (!language) throw new Error(`No source language handles ${path}`);
		if (!dependencies) return language.create(locale);
		const ecosystems = language.ecosystems ?? [];
		return language.create(locale, { dependencies: (p) => Object.assign({}, ...ecosystems.map((eco) => dependencies.forFile(p, eco))) });
	};
	// A file renamed from a type we can't read (say `.d.ts` to `.ts`) reads as newly added.
	const narratable = (files: ChangedFile[]) =>
		files.filter((f) => languageFor(f.path)).map((f) => (f.oldPath && !languageFor(f.oldPath) ? { ...f, oldSrc: "" } : f));
	return {
		locale,
		canNarrate: (path) => !!languageFor(path),
		narrate: (src, path) => {
			if (!languageFor(path)) throw new Error(`No source language handles ${path}`);
			try {
				const result = fileNarrator(path).narrate(src, path);
				return { ...result, problems: result.problems ?? [] };
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				return {
					lines: [],
					errors: 0,
					stats: { nodes: 0, fallbacks: 0, fallbackTypes: {} },
					problems: [{ path, message, severity: "error", source: "narrator" }],
				};
			}
		},
		fileNarrator,
		diff: (files, opts) =>
			buildDiffReport({
				files: narratable(files),
				narratorFor: fileNarrator,
				resolve: opts?.resolve ?? (() => null),
				includeGenerated: opts?.includeGenerated,
			}),
		diffFiles: (files, opts) => diffFiles({ files: narratable(files), narratorFor: fileNarrator, includeGenerated: opts?.includeGenerated }),
	};
}
