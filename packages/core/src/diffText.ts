import type { Row, UnitDiff } from "./diff";
import type { Line } from "./lines";
import { plain } from "./markup";
import type { FileDiff } from "./report";

const UNIT_MARK: Record<UnitDiff["status"], string> = {
	added: "+",
	removed: "-",
	modified: "~",
	unchanged: " ",
	moved: ">",
	renamed: ">",
	"moved-away": "<",
};

/** Renders structured diffs as indented plain text (`-`/`+` per English line); pass `toAnsi` for color. */
export function renderDiffText({ files, format = plain }: { files: FileDiff[]; format?: (s: string) => string }): string {
	const out: string[] = [];
	const line = (mark: string, l: Line) => out.push(`    ${mark} ${"  ".repeat(l.d)}${format(l.text)}`.trimEnd());
	const row = (r: Row) => {
		if (r.kind === "fold") return out.push(`      … ${r.count} unchanged`);
		if (r.left && r.kind !== "same") line("-", r.left.line);
		if (r.right) line(r.kind === "same" ? " " : "+", r.right.line);
	};
	for (const f of files) {
		const from = f.oldPath && f.oldPath !== f.path ? ` (from ${f.oldPath})` : "";
		out.push(`${f.path}${from} [${f.status}, +${f.adds} -${f.dels}]`);
		for (const u of f.units) {
			if (u.status === "unchanged") continue;
			const other = u.other ? ` (${u.status === "renamed" ? u.other.title : u.other.path})` : "";
			out.push(`  ${UNIT_MARK[u.status]} ${format(u.title)} [${u.status}]${format(other)}`);
			for (const r of u.rows) row(r);
		}
	}
	return out.join("\n");
}
