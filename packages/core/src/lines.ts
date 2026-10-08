import { plain } from "./markup";

export type LineKind = "head" | "stmt" | "note" | "bullet" | "raw" | "blank";

/** One rendered sentence. `d` is indent depth; `start`/`end` are source offsets (-1 when synthetic). */
export type Line = { d: number; text: string; start: number; end: number; kind: LineKind };

/** A phrase `t` that may carry nested lines (`kids`) when it introduces a block. */
export type Doc = { t: string; kids: Line[] };

/** Block intros never carry their colon in `t`; it is added when emitted, so docs embed mid-sentence cleanly. */
export const D = (t: string, kids: Line[] = []): Doc => ({ t: kids.length ? t.replace(/:\s*$/, "") : t, kids });

const firstTextIndex = (s: string) => (s.startsWith("\uE000") ? s.indexOf("\uE001", s.indexOf("\uE001") + 1) + 1 : 0);

export const lowerFirst = (s: string): string => {
	const i = firstTextIndex(s);
	return s.slice(0, i) + s.charAt(i).toLowerCase() + s.slice(i + 1);
};

export const capFirst = (s: string): string => {
	const i = firstTextIndex(s);
	return s.slice(0, i) + s.charAt(i).toUpperCase() + s.slice(i + 1);
};

export const renderText = (lines: Line[], fmt: (s: string) => string = plain) =>
	lines.map((l) => (l.kind === "blank" ? "" : "  ".repeat(l.d) + fmt(l.text))).join("\n");
