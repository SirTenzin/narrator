import type { DependencyIndex } from "./dependencies";
import type { FileNarration, FileNarrator, SourceLanguage } from "./language";
import type { Locale } from "./locale";
import { buildDiffReport, type ChangedFile, type FileJson, type Resolver } from "./report";

export type Narrator = {
	locale: Locale;
	canNarrate(path: string): boolean;
	narrate(src: string, path: string): FileNarration;
	fileNarrator(path: string): FileNarrator;
	diff(files: ChangedFile[], opts?: { resolve?: Resolver }): FileJson[];
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
	return {
		locale,
		canNarrate: (path) => !!languageFor(path),
		narrate: (src, path) => fileNarrator(path).narrate(src, path),
		fileNarrator,
		diff: (files, opts) =>
			buildDiffReport({ files: files.filter((f) => languageFor(f.path)), narratorFor: fileNarrator, resolve: opts?.resolve ?? (() => null) }),
	};
}
