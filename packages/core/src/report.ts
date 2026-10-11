import { type Cell, detectMoves, diffUnits, type Merged, type Unit, type UnitDiff } from "./diff";
import { type SkipReason, skipReason } from "./generated";
import type { FileNarrator, NarrationProblem } from "./language";
import { toHtml } from "./markup";

export type ChangedFile = {
	path: string;
	oldPath: string | null;
	status: "added" | "deleted" | "renamed" | "modified";
	oldSrc: string;
	newSrc: string;
	/** Set when the caller already knows the file isn't hand-written (e.g. from `.gitattributes`); its sources may then be empty. */
	skipped?: SkipReason;
};

export type DiffOptions = {
	/** Narrate generated, vendored, minified and build files too. Off by default: they are skipped and listed with `skipped`. */
	includeGenerated?: boolean;
};

export type Resolver = (payload: string, kind: string) => string | null;

export type CellJson = { d: number; kind: string; html: string; from: number | null; to: number | null };
export type RowJson = { kind: string; count?: number; left: CellJson | null; right: CellJson | null; merged?: string; hidden?: RowJson[] };
export type UnitJson = { key: string; title: string; status: string; other?: { path: string; title: string }; adds: number; dels: number; rows: RowJson[] };
export type FileJson = {
	path: string;
	oldPath: string | null;
	status: string;
	adds: number;
	dels: number;
	units: UnitJson[];
	skipped?: SkipReason;
	problems: NarrationProblem[];
};

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

/** A changed file's declarations, diffed as English lines. `skipped` files have no units; `problems` lists what couldn't be read. */
export type FileDiff = {
	path: string;
	oldPath: string | null;
	status: ChangedFile["status"];
	adds: number;
	dels: number;
	units: UnitDiff[];
	skipped?: SkipReason;
	problems: NarrationProblem[];
};

const isReported = (f: { status: string; units: { status: string }[]; skipped?: string; problems: unknown[] }) =>
	f.status === "renamed" || !!f.skipped || f.problems.length > 0 || f.units.some((u) => u.status !== "unchanged");

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One side's units; a narrator that throws costs this file its units, never the whole change set. */
function unitsOf({ narratorFor, src, path }: { narratorFor: (path: string) => FileNarrator; src: string; path: string }): {
	units: Unit[];
	problems: NarrationProblem[];
} {
	if (!src) return { units: [], problems: [] };
	try {
		const narrator = narratorFor(path);
		const units = narrator.units(src, path);
		return { units, problems: narrator.problems?.() ?? [] };
	} catch (e) {
		return { units: [], problems: [{ path, message: errorMessage(e), severity: "error", source: "narrator" }] };
	}
}

const hasSyntaxError = (side: { problems: NarrationProblem[] }) => side.problems.some((p) => p.source === "parser");

function diffChangedFiles({ files, narratorFor, includeGenerated }: { files: ChangedFile[]; narratorFor: (path: string) => FileNarrator } & DiffOptions) {
	const computed = files.map((f) => {
		const skipped = includeGenerated ? undefined : (f.skipped ?? skipReason({ path: f.path, src: f.newSrc || f.oldSrc }) ?? undefined);
		if (skipped) return { f, skipped, units: [] as UnitDiff[], problems: [] as NarrationProblem[] };
		const before = unitsOf({ narratorFor, src: f.oldSrc, path: f.oldPath ?? f.path });
		const after = unitsOf({ narratorFor, src: f.newSrc, path: f.path });
		const problems = [...before.problems, ...after.problems];
		if (problems.some((p) => p.source === "narrator")) return { f, skipped, units: [] as UnitDiff[], problems };
		// Declarations past a syntax error in the new code are missing, which would otherwise read as removals.
		const units = diffUnits(before.units, after.units).filter((u) => !(u.status === "removed" && hasSyntaxError(after)));
		return { f, skipped, units, problems };
	});
	detectMoves(computed.map((c) => ({ path: c.f.path, units: c.units })));
	return computed;
}

const fileSummary = ({ f, units, skipped, problems }: ReturnType<typeof diffChangedFiles>[number]) => ({
	path: f.path,
	oldPath: f.oldPath,
	status: f.status,
	adds: units.reduce((n, u) => n + u.adds, 0),
	dels: units.reduce((n, u) => n + u.dels, 0),
	...(skipped ? { skipped } : {}),
	problems,
});

/** Narrates both sides of every changed file, diffs them and detects moves: structured units with their `Line`s. */
export function diffFiles({
	files,
	narratorFor,
	includeGenerated,
}: { files: ChangedFile[]; narratorFor: (path: string) => FileNarrator } & DiffOptions): FileDiff[] {
	return diffChangedFiles({ files, narratorFor, includeGenerated })
		.map((c): FileDiff => ({ ...fileSummary(c), units: c.units }))
		.filter(isReported);
}

/** Like `diffFiles`, rendered as HTML-ready rows with source line numbers. */
export function buildDiffReport({
	files,
	narratorFor,
	resolve,
	includeGenerated,
}: {
	files: ChangedFile[];
	narratorFor: (path: string) => FileNarrator;
	resolve: Resolver;
} & DiffOptions): FileJson[] {
	const computed = diffChangedFiles({ files, narratorFor, includeGenerated }).map((c) => ({
		...c,
		oldStarts: lineStartsOf(c.f.oldSrc),
		newStarts: lineStartsOf(c.f.newSrc),
	}));
	const oldStartsByPath = new Map(computed.map((c) => [c.f.path, c.oldStarts]));

	const mergedHtml = (m: Merged) =>
		m
			.map((t) =>
				t.op === "del"
					? `<del class="wd">${toHtml(t.text, resolve)}</del>`
					: t.op === "add"
						? `<ins class="wi">${toHtml(t.text, resolve)}</ins>`
						: toHtml(t.text, resolve),
			)
			.join("");

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
				const chunk = ts
					.slice(i, j)
					.map((t) => toHtml(t.text, resolve))
					.join("");
				html += ts[i]!.changed ? `<mark class="chg">${chunk}</mark>` : chunk;
				i = j;
			}
		}
		return {
			d: l.d,
			kind: l.kind,
			html,
			from: l.start >= 0 ? lineAt(starts, l.start) : null,
			to: l.end >= 0 ? lineAt(starts, Math.max(l.start, l.end - 1)) : null,
		};
	};

	const result = computed.map(
		(c): FileJson => ({
			...fileSummary(c),
			units: c.units.map((u) => {
				const { oldStarts, newStarts } = c;
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
		}),
	);
	return result.filter(isReported);
}
