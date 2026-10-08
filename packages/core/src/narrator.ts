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

export function createNarrator({ languages, locale }: { languages: SourceLanguage[]; locale: Locale }): Narrator {
	const languageFor = (path: string) => languages.find((l) => l.handles(path));
	const fileNarrator = (path: string) => {
		const language = languageFor(path);
		if (!language) throw new Error(`No source language handles ${path}`);
		return language.create(locale);
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
