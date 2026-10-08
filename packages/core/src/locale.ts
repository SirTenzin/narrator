/** Language-specific word mechanics: everything a renderer needs besides fixed phrases. */
export interface Grammar {
	/** "a, b, and c" / "a or b". */
	list(items: string[], conj?: "and" | "or"): string;
	formatNumber(n: number): string;
}

/** Every phrase the built-in TS/JS narration can produce. Arguments are already-rendered markup strings. */
export interface CorePhrases {
	ops: Record<"+" | "-" | "*" | "/" | "%" | "**" | "<<" | ">>" | "&" | "|", string>;
	fallback(p: { value: string; fallback: string }): string;
	fallbackBlock(p: { value: string; fallback: string }): string;
	fallbackInline(p: { value: string; fallback: string }): string;
}

/** An output (human) language. Add one by implementing this interface; see `@narrate/locale-en`. */
export interface Locale {
	/** BCP 47 tag, e.g. "en", "es", "pt-BR". Plugins look up their own phrasebooks by this id. */
	id: string;
	grammar: Grammar;
	phrases: CorePhrases;
}
