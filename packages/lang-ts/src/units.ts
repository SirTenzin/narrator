import { plain, type Unit } from "@usenarrator/core";
import { type Engine, unwrap } from "./engine";

const declName = (s: N): string | null => {
	if (s.id?.name) return s.id.name;
	if (s.type === "VariableDeclaration")
		return (
			s.declarations
				.map((d: N) => d.id?.name ?? "")
				.filter(Boolean)
				.join(",") || null
		);
	return null;
};
type N = any;

/** Splits a narrated file into units keyed by declaration name, so old and new can be matched. */
export function unitsOf(e: Engine, src: string, filename: string): Unit[] {
	const { lines } = e.narrate(src, filename);
	const program = e.program;
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
		if (head && !u.title.includes(" › ")) u.title = plain(e.headTitles.get(head.text) ?? head.text.replace(/:$/, ""));
	}
	return units.filter((u) => u.lines.length);
}
