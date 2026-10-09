import type { Unit } from "./diff";
import type { Line } from "./lines";
import type { Locale } from "./locale";

export type NarrationStats = { nodes: number; fallbacks: number; fallbackTypes: Record<string, number> };

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
	create(locale: Locale): FileNarrator;
}
