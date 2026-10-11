import type { Dependencies } from "./dependencies";
import type { Unit } from "./diff";
import type { Line } from "./lines";
import type { Locale } from "./locale";

/** A plugin rule that threw or returned something unusable; narration fell back to the next rule. `count` is how often it happened. */
export type RuleError = { plugin: string; rule: string; message: string; count: number };

export type NarrationStats = { nodes: number; fallbacks: number; fallbackTypes: Record<string, number>; ruleErrors?: RuleError[] };

export type FileNarration = { lines: Line[]; errors: number; stats: NarrationStats };

/** Narrates one file. Created fresh per file, so implementations may keep per-file state. */
export interface FileNarrator {
	narrate(src: string, path: string): FileNarration;
	/** Top-level declarations with their lines, keyed so old and new versions can be matched. */
	units(src: string, path: string): Unit[];
}

/** A programming language the SDK can read. See `@usenarrator/lang-ts` for the TS/JS implementation. */
export interface SourceLanguage {
	id: string;
	handles(path: string): boolean;
	/** Dependency ecosystems this language's code imports from, e.g. ["npm"]; picks which manifests apply. */
	ecosystems?: string[];
	create(locale: Locale, ctx?: { dependencies?: (path: string) => Dependencies }): FileNarrator;
}
