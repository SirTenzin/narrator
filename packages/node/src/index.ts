import { createNarrator, type DependencyIndex, type Locale, type Narrator } from "@usenarrator/core";
import { type TsPlugin, typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en } from "@usenarrator/locale-en";
import { findRepoRoot, loadDependencyIndex } from "./repo";

export { findRepoRoot, listRepoFiles, loadDependencyIndex } from "./repo";

export type NodeNarratorOptions = {
	plugins?: (TsPlugin | TsPlugin[])[];
	/** Defaults to English. */
	locale?: Locale;
	/** Defaults to the manifests of the git checkout around the working directory (read on first use). Pass `false` to skip. */
	dependencies?: false | DependencyIndex;
};

/** A TS/JS narrator for Node and Bun with the native oxc parser and the repo's dependency manifests wired in. */
export function createNodeNarrator({ plugins = [], locale = en, dependencies }: NodeNarratorOptions = {}): Narrator {
	const index = dependencies === false ? undefined : (dependencies ?? loadDependencyIndex({ root: findRepoRoot(process.cwd()) }));
	return createNarrator({ languages: [typescript({ parser: oxcParser, plugins })], locale, dependencies: index });
}
