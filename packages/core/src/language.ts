import type { Dependencies } from "./dependencies";
import type { Unit } from "./diff";
import type { Line } from "./lines";
import type { Locale } from "./locale";

export type NarrationStats = { nodes: number; fallbacks: number; fallbackTypes: Record<string, number> };

/** Something that went wrong in one file. Narration carries on around it: other statements and other files still read. */
export type NarrationProblem = {
	path: string;
	message: string;
	/** `error`: some of the file is missing from the output. `warning`: a plugin rule failed and a fallback was used. */
	severity: "error" | "warning";
	/** `parser`: a syntax error. `plugin`: a plugin rule threw. `narrator`: the file couldn't be narrated at all. */
	source: "parser" | "plugin" | "narrator";
	/** 1-based source line, when known. */
	line?: number;
	plugin?: string;
	rule?: string;
};

export type FileNarration = { lines: Line[]; errors: number; stats: NarrationStats; problems?: NarrationProblem[] };

/** Narrates one file. Created fresh per file, so implementations may keep per-file state. */
export interface FileNarrator {
	narrate(src: string, path: string): FileNarration;
	/** Top-level declarations with their lines, keyed so old and new versions can be matched. */
	units(src: string, path: string): Unit[];
	/** Problems from the latest `units` call (syntax errors, failed plugin rules); `narrate` returns its own. */
	problems?(): NarrationProblem[];
}

/** A programming language the SDK can read. See `@usenarrator/lang-ts` for the TS/JS implementation. */
export interface SourceLanguage {
	id: string;
	handles(path: string): boolean;
	/** Dependency ecosystems this language's code imports from, e.g. ["npm"]; picks which manifests apply. */
	ecosystems?: string[];
	create(locale: Locale, ctx?: { dependencies?: (path: string) => Dependencies }): FileNarrator;
}
