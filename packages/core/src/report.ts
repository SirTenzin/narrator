import { type Cell, detectMoves, diffUnits, type Merged } from "./diff";
import type { FileNarrator } from "./language";
import { toHtml } from "./markup";

export type ChangedFile = { path: string; oldPath: string | null; status: "added" | "deleted" | "renamed" | "modified"; oldSrc: string; newSrc: string };

export type Resolver = (payload: string, kind: string) => string | null;

export type CellJson = { d: number; kind: string; html: string; from: number | null; to: number | null };
export type RowJson = { kind: string; count?: number; left: CellJson | null; right: CellJson | null; merged?: string; hidden?: RowJson[] };
export type UnitJson = { key: string; title: string; status: string; other?: { path: string; title: string }; adds: number; dels: number; rows: RowJson[] };
export type FileJson = { path: string; oldPath: string | null; status: string; adds: number; dels: number; units: UnitJson[] };

const lineStartsOf = (src: string) => {
	const starts = [0];
	for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
	return starts;
};

const lineAt = (starts: number[], off: number) => {
	let lo = 0;
	let hi = starts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (starts[mid]! <= off) lo = mid;
		else hi = mid - 1;
	}
	return lo + 1;
};

/** Narrates both sides of every changed file, diffs them, detects moves, and renders HTML rows. */
export function buildDiffReport({
	files,
	narratorFor,
	resolve,
}: {
	files: ChangedFile[];
	narratorFor: (path: string) => FileNarrator;
	resolve: Resolver;
}): FileJson[] {
	const safeUnits = (src: string, path: string) => {
		if (!src) return [];
		try {
			return narratorFor(path).units(src, path);
		} catch {
			return [];
		}
	};
	const computed = files.map((f) => {
		const units = diffUnits(safeUnits(f.oldSrc, f.oldPath ?? f.path), safeUnits(f.newSrc, f.path));
		return { f, units, oldStarts: lineStartsOf(f.oldSrc), newStarts: lineStartsOf(f.newSrc) };
	});
	detectMoves(computed.map((c) => ({ path: c.f.path, units: c.units })));
	const oldStartsByPath = new Map(computed.map((c) => [c.f.path, c.oldStarts]));

	const mergedHtml = (m: Merged) =>
		m.map((t) => (t.op === "del" ? `<del class="wd">${toHtml(t.text, resolve)}</del>` : t.op === "add" ? `<ins class="wi">${toHtml(t.text, resolve)}</ins>` : toHtml(t.text, resolve))).join("");

	const cell = (c: Cell, starts: number[]): CellJson | null => {
		if (!c) return null;
		const l = c.line;
		let html = toHtml(l.text, resolve);
		if (c.tokens) {
			const ts = c.tokens.map((t, i, a) => ({ ...t, changed: t.changed || (!t.text.trim() && !!a[i - 1]?.changed && !!a[i + 1]?.changed) }));
			html = "";
			for (let i = 0; i < ts.length; ) {
				let j = i;
				while (j < ts.length && ts[j]!.changed === ts[i]!.changed) j++;
				const chunk = ts.slice(i, j).map((t) => toHtml(t.text, resolve)).join("");
				html += ts[i]!.changed ? `<mark class="chg">${chunk}</mark>` : chunk;
				i = j;
			}
		}
		return { d: l.d, kind: l.kind, html, from: l.start >= 0 ? lineAt(starts, l.start) : null, to: l.end >= 0 ? lineAt(starts, Math.max(l.start, l.end - 1)) : null };
	};

	const result = computed.map(({ f, units, oldStarts, newStarts }): FileJson => ({
		path: f.path,
		oldPath: f.oldPath,
		status: f.status,
		adds: units.reduce((n, u) => n + u.adds, 0),
		dels: units.reduce((n, u) => n + u.dels, 0),
		units: units.map((u) => {
			const leftStarts = u.status === "moved" && u.other ? (oldStartsByPath.get(u.other.path) ?? oldStarts) : oldStarts;
			return {
				key: u.key,
				title: u.title,
				status: u.status,
				other: u.other,
				adds: u.adds,
				dels: u.dels,
				rows: u.rows.map((r) => ({
					kind: r.kind,
					count: r.count,
					left: cell(r.left, leftStarts),
					right: cell(r.right, newStarts),
					merged: r.merged ? mergedHtml(r.merged) : undefined,
					hidden: r.hidden?.map((h) => ({ kind: h.kind, left: cell(h.left, leftStarts), right: cell(h.right, newStarts) })),
				})),
			};
		}),
	}));
	return result.filter((f) => f.status === "renamed" || f.units.some((u) => u.status !== "unchanged"));
}
