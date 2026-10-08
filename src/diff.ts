import { parse as parseSync } from "./parser";
import { type Engine, type Line, unwrap } from "./engine";
import { plain } from "./markup";

/** A top-level declaration (or statement) and the English lines that describe it. */
export type Unit = { key: string; title: string; start: number; end: number; lines: Line[] };

export type Cell = { line: Line; tokens?: { text: string; changed: boolean }[] } | null;
export type Merged = { text: string; op: "same" | "del" | "add" }[];
export type Row = { kind: "same" | "del" | "add" | "mod" | "fold"; left: Cell; right: Cell; count?: number; hidden?: Row[]; merged?: Merged };
export type UnitStatus = "added" | "removed" | "modified" | "unchanged" | "moved" | "renamed" | "moved-away";
export type UnitDiff = {
	key: string;
	title: string;
	status: UnitStatus;
	rows: Row[];
	adds: number;
	dels: number;
	/** For moved/renamed: where it came from. For moved-away: where it went. */
	other?: { path: string; title: string };
};

const declName = (s: N): string | null => {
	if (s.id?.name) return s.id.name;
	if (s.type === "VariableDeclaration") return s.declarations.map((d: N) => d.id?.name ?? "").filter(Boolean).join(",") || null;
	return null;
};
type N = any;

/** Splits a narrated file into units keyed by declaration name, so old and new can be matched. */
export function unitsOf(e: Engine, src: string, filename: string): Unit[] {
	const { lines } = e.narrate(src, filename);
	const { program } = parseSync(filename.replace(/\.(m|c)?js$/, ".ts"), src) as any;
	const seen = new Map<string, number>();
	const units: Unit[] = [];
	for (const st of program.body) {
		if (st.type === "ImportDeclaration") continue;
		const s = (st.type === "ExportNamedDeclaration" || st.type === "ExportDefaultDeclaration") && st.declaration ? st.declaration : st;
		let base = declName(s);
		if (!base && st.type === "ExportDefaultDeclaration") base = "default";
		if (!base) {
			const ex = s.type === "ExpressionStatement" ? unwrap(s.expression) : s;
			const callee = ex?.type === "CallExpression" ? src.slice(ex.callee.start, ex.callee.end) : s.type;
			base = `${callee}(${ex?.arguments?.[0]?.type === "Literal" ? ex.arguments[0].value : ""})`;
		}
		const n = (seen.get(base) ?? 0) + 1;
		seen.set(base, n);
		const key = n > 1 ? `${base}#${n}` : base;
		const members = s.type === "ClassDeclaration" ? s.body.body.filter((m: N) => m.key) : [];
		if (!members.length) {
			units.push({ key, title: base, start: st.start, end: st.end, lines: [] });
			continue;
		}
		// Classes split per member so one changed method doesn't drag the whole class into the diff.
		units.push({ key, title: base, start: st.start, end: members[0].start - 1, lines: [] });
		for (const m of members) {
			const name = m.key.name ?? src.slice(m.key.start, m.key.end);
			units.push({ key: `${key}.${name}`, title: `${base} › ${name}`, start: m.start, end: m.end, lines: [] });
		}
	}
	// Each line belongs to the first unit ending at or after it; leading comments attach to the next unit.
	let ui = 0;
	for (const l of lines) {
		if (l.kind === "blank") continue;
		if (l.start >= 0) while (ui < units.length - 1 && units[ui]!.end < l.start) ui++;
		units[ui]?.lines.push(l);
	}
	for (const u of units) {
		const head = u.lines.find((l) => l.kind === "head");
		if (head && !u.title.includes(" › ")) u.title = plain(head.text).split(" — ")[0]!.replace(/:$/, "");
	}
	return units.filter((u) => u.lines.length);
}

const lineKey = (l: Line) => `${l.d}|${plain(l.text)}`;

/** Classic LCS over line keys; units are small so O(n·m) is fine. */
function lcs(a: string[], b: string[]): [number, number][] {
	const n = a.length;
	const m = b.length;
	const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
	const pairs: [number, number][] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			pairs.push([i, j]);
			i++;
			j++;
		} else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
		else j++;
	}
	return pairs;
}

/** Markup-aware tokens: a linked name stays one token, plain text splits into words and punctuation. */
function tokenize(text: string): string[] {
	return text.match(/\uE000[^\uE002]*\uE002|\s+|[A-Za-z0-9_'’-]+|[^\sA-Za-z0-9_\uE000]/g) ?? [];
}

function wordDiff(a: string, b: string): { left: { text: string; changed: boolean }[]; right: { text: string; changed: boolean }[]; merged: Merged; similarity: number } {
	const ta = tokenize(a);
	const tb = tokenize(b);
	const norm = (t: string) => plain(t);
	const pairs = lcs(ta.map(norm), tb.map(norm));
	const keepA = new Set(pairs.map((p) => p[0]));
	const keepB = new Set(pairs.map((p) => p[1]));
	const words = (ts: string[]) => ts.filter((t) => t.trim()).length || 1;
	const shared = pairs.filter(([i]) => ta[i]!.trim()).length;
	const merged: Merged = [];
	let i = 0;
	let j = 0;
	for (const [pi, pj] of [...pairs, [ta.length, tb.length] as [number, number]]) {
		for (; i < pi; i++) merged.push({ text: ta[i]!, op: "del" });
		for (; j < pj; j++) merged.push({ text: tb[j]!, op: "add" });
		if (pi < ta.length) merged.push({ text: tb[pj]!, op: "same" });
		i = pi + 1;
		j = pj + 1;
	}
	return {
		merged: tidyMerged(merged),
		left: ta.map((t, i) => ({ text: t, changed: !keepA.has(i) && !!t.trim() })),
		right: tb.map((t, i) => ({ text: t, changed: !keepB.has(i) && !!t.trim() })),
		similarity: (2 * shared) / (words(ta) + words(tb)),
	};
}

/** Groups a word-level edit so it reads as phrases: whitespace between two edits joins them, and all deletions precede insertions within a run. */
function tidyMerged(m: Merged): Merged {
	const out: Merged = [];
	let k = 0;
	while (k < m.length) {
		if (m[k]!.op === "same") {
			const isBridge = !m[k]!.text.trim() && m[k - 1] && m[k - 1]!.op !== "same" && m[k + 1] && m[k + 1]!.op !== "same";
			if (!isBridge) {
				out.push(m[k]!);
				k++;
				continue;
			}
		}
		let dels = "";
		let adds = "";
		while (k < m.length) {
			const t = m[k]!;
			const bridge = t.op === "same" && !t.text.trim() && m[k + 1] && m[k + 1]!.op !== "same";
			if (t.op === "same" && !bridge) break;
			if (t.op === "del") dels += t.text;
			else if (t.op === "add") adds += t.text;
			else {
				dels += t.text;
				adds += t.text;
			}
			k++;
		}
		if (dels.trim()) out.push({ text: dels, op: "del" });
		if (adds.trim()) out.push({ text: adds, op: "add" });
		if (!dels.trim() && !adds.trim()) out.push({ text: dels || adds, op: "same" });
	}
	return out;
}

/** Aligns two line lists into split-view rows, pairing similar removed/added lines as modifications. */
export function diffLines(a: Line[], b: Line[], context = 3): Row[] {
	const pairs = lcs(a.map(lineKey), b.map(lineKey));
	const rows: Row[] = [];
	let i = 0;
	let j = 0;
	const flushGap = (iEnd: number, jEnd: number) => {
		const dels = a.slice(i, iEnd);
		const adds = b.slice(j, jEnd);
		const usedAdds = new Set<number>();
		const pairedAt = new Map<number, { k: number; wd: ReturnType<typeof wordDiff> }>();
		let cursor = 0;
		dels.forEach((dl, di) => {
			for (let k = cursor; k < adds.length; k++) {
				const wd = wordDiff(dl.text, adds[k]!.text);
				if (wd.similarity >= 0.45) {
					pairedAt.set(di, { k, wd });
					usedAdds.add(k);
					cursor = k + 1;
					return;
				}
			}
		});
		let k = 0;
		dels.forEach((dl, di) => {
			const p = pairedAt.get(di);
			if (p) {
				for (; k < p.k; k++) if (!usedAdds.has(k)) rows.push({ kind: "add", left: null, right: { line: adds[k]! } });
				rows.push({ kind: "mod", left: { line: dl, tokens: p.wd.left }, right: { line: adds[p.k]!, tokens: p.wd.right }, merged: p.wd.merged });
				k = p.k + 1;
			} else rows.push({ kind: "del", left: { line: dl }, right: null });
		});
		for (; k < adds.length; k++) if (!usedAdds.has(k)) rows.push({ kind: "add", left: null, right: { line: adds[k]! } });
		i = iEnd;
		j = jEnd;
	};
	for (const [pi, pj] of pairs) {
		flushGap(pi, pj);
		rows.push({ kind: "same", left: { line: a[pi]! }, right: { line: b[pj]! } });
		i = pi + 1;
		j = pj + 1;
	}
	flushGap(a.length, b.length);
	return foldUnchanged(rows, context);
}

function foldUnchanged(rows: Row[], context: number): Row[] {
	const changed = rows.map((r) => r.kind !== "same");
	const near = rows.map((_, idx) => {
		for (let d = -context; d <= context; d++) if (changed[idx + d]) return true;
		return false;
	});
	const out: Row[] = [];
	let run: Row[] = [];
	const flush = () => {
		if (run.length > 1) out.push({ kind: "fold", left: null, right: null, count: run.length, hidden: run });
		else out.push(...run);
		run = [];
	};
	rows.forEach((r, idx) => {
		if (r.kind === "same" && !near[idx] && idx > 0) run.push(r);
		else {
			flush();
			out.push(r);
		}
	});
	flush();
	return out;
}

export function diffUnits(before: Unit[], after: Unit[]): UnitDiff[] {
	const oldIndex = new Map(before.map((u, i) => [u.key, i]));
	const newKeys = new Set(after.map((u) => u.key));
	const emitted = new Set<number>();
	const out: UnitDiff[] = [];
	const count = (rows: Row[]) => ({
		adds: rows.filter((r) => r.kind === "add" || r.kind === "mod").length,
		dels: rows.filter((r) => r.kind === "del" || r.kind === "mod").length,
	});
	const emitRemovedBefore = (limit: number) => {
		for (let i = 0; i < limit; i++) {
			const r = before[i]!;
			if (emitted.has(i) || newKeys.has(r.key)) continue;
			emitted.add(i);
			const rows = r.lines.map((l): Row => ({ kind: "del", left: { line: l }, right: null }));
			out.push({ key: r.key, title: r.title, status: "removed", rows, ...count(rows) });
		}
	};
	for (const u of after) {
		const oi = oldIndex.get(u.key);
		if (oi === undefined) {
			const rows = u.lines.map((l): Row => ({ kind: "add", left: null, right: { line: l } }));
			out.push({ key: u.key, title: u.title, status: "added", rows, ...count(rows) });
			continue;
		}
		emitRemovedBefore(oi);
		const old = before[oi]!;
		const same = old.lines.length === u.lines.length && old.lines.every((l, i) => lineKey(l) === lineKey(u.lines[i]!));
		if (same) {
			out.push({ key: u.key, title: u.title, status: "unchanged", rows: [], adds: 0, dels: 0 });
			continue;
		}
		const rows = diffLines(old.lines, u.lines);
		out.push({ key: u.key, title: u.title, status: "modified", rows, ...count(rows) });
	}
	emitRemovedBefore(before.length);
	return out;
}

const bodyKeys = (lines: Line[]) => lines.filter((l) => l.kind !== "head").map(lineKey);
const linesOf = (u: UnitDiff, side: "left" | "right") => u.rows.flatMap((r) => (r[side] ? [r[side]!.line] : []));

/** How much of two declarations' English (ignoring their headings) is the same, 0..1. */
export function bodySimilarity(a: Line[], b: Line[]): number {
	const ka = bodyKeys(a);
	const kb = bodyKeys(b);
	if (!ka.length && !kb.length) return a.length && b.length && lineKey(a[0]!) === lineKey(b[0]!) ? 1 : 0;
	return (2 * lcs(ka, kb).length) / (ka.length + kb.length);
}

const baseName = (key: string) => key.replace(/#\d+$/, "");

/** Pairs removed and added declarations across a whole change set into moves and renames. */
export function detectMoves(files: { path: string; units: UnitDiff[] }[]) {
	const removed = files.flatMap((f) => f.units.filter((u) => u.status === "removed").map((u) => ({ f, u, lines: linesOf(u, "left") })));
	const added = files.flatMap((f) => f.units.filter((u) => u.status === "added").map((u) => ({ f, u, lines: linesOf(u, "right") })));
	const candidates: { score: number; r: (typeof removed)[number]; a: (typeof added)[number] }[] = [];
	for (const a of added)
		for (const r of removed) {
			const sameName = baseName(r.u.key) === baseName(a.u.key);
			if (sameName && r.f === a.f) continue;
			const sim = bodySimilarity(r.lines, a.lines);
			const big = Math.min(bodyKeys(r.lines).length, bodyKeys(a.lines).length) >= 2;
			if (sameName ? sim >= 0.3 || !big : big && sim >= 0.6) candidates.push({ score: sim + (sameName ? 1 : 0), r, a });
		}
	candidates.sort((x, y) => y.score - x.score);
	const usedR = new Set<UnitDiff>();
	const usedA = new Set<UnitDiff>();
	for (const { r, a } of candidates) {
		if (usedR.has(r.u) || usedA.has(a.u)) continue;
		usedR.add(r.u);
		usedA.add(a.u);
		const crossFile = r.f !== a.f;
		const renamed = baseName(r.u.key) !== baseName(a.u.key);
		const rows = diffLines(r.lines, a.lines);
		a.u.status = crossFile ? "moved" : "renamed";
		if (crossFile && renamed) a.u.title = `${a.u.title}`;
		a.u.other = { path: r.f.path, title: r.u.title };
		a.u.rows = rows;
		a.u.adds = rows.filter((x) => x.kind === "add" || x.kind === "mod").length;
		a.u.dels = rows.filter((x) => x.kind === "del" || x.kind === "mod").length;
		r.u.status = "moved-away";
		r.u.other = { path: a.f.path, title: a.u.title };
		r.u.rows = [];
		r.u.adds = 0;
		r.u.dels = 0;
		if (!crossFile) {
			const idx = r.f.units.indexOf(r.u);
			if (idx >= 0) r.f.units.splice(idx, 1);
		}
	}
}
