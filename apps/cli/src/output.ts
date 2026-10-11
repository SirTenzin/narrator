import {
	describeProblem,
	type FileDiff,
	type FileJson,
	type Line,
	type NarrationProblem,
	plain,
	type Row,
	renderDiffText,
	renderText,
	toAnsi,
	toHtml,
} from "@usenarrator/core";
import type { Format } from "./args";

export type FileOutput = { path: string; lines: Line[]; errors: number; problems: NarrationProblem[] };

const lineJson = (l: Line) => ({ depth: l.d, kind: l.kind, text: plain(l.text), start: l.start, end: l.end });

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const page = (body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Narrator</title><style>
body{font:15px/1.6 system-ui,sans-serif;max-width:72rem;margin:2rem auto;padding:0 1rem;color:#111}
h2{font:600 14px ui-monospace,monospace;border-bottom:1px solid #ddd;padding-bottom:.25rem}
.v{color:#0b6e99}.f{color:#8a5a00;font-weight:600}.t{color:#777}.l{color:#1a7f37}.c{font-family:ui-monospace,monospace;color:#8250df}
.row{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.row>div{white-space:pre-wrap}
.problem{color:#b42318}.del .left,.mod .left{background:#ffebe9}.add .right,.mod .right{background:#dafbe1}.fold{color:#777}
</style></head><body>
${body}
</body></html>`;

const noLinks = () => null;
const indented = (d: number, html: string) => `<div style="padding-left:${d * 1.5}rem">${html}</div>`;

export function renderFiles({ files, format }: { files: FileOutput[]; format: Format }): string {
	if (format === "json")
		return JSON.stringify(
			files.map((f) => ({ path: f.path, errors: f.errors, problems: f.problems, lines: f.lines.map(lineJson) })),
			null,
			2,
		);
	if (format === "html")
		return page(
			files.map((f) => `<section><h2>${esc(f.path)}</h2>\n${f.lines.map((l) => indented(l.d, toHtml(l.text, noLinks))).join("\n")}</section>`).join("\n"),
		);
	const fmt = format === "ansi" ? toAnsi : plain;
	if (files.length === 1) return renderText(files[0]!.lines, fmt);
	const header = (path: string) => (format === "ansi" ? `\x1b[1m${path}\x1b[0m` : path);
	return files.map((f) => `${header(f.path)}\n${renderText(f.lines, fmt).replace(/^(?=.)/gm, "  ")}`).join("\n\n");
}

const rowJson = (r: Row): unknown => ({
	kind: r.kind,
	count: r.count,
	left: r.left ? lineJson(r.left.line) : null,
	right: r.right ? lineJson(r.right.line) : null,
});

const diffJson = (files: FileDiff[]) => files.map((f) => ({ ...f, units: f.units.map((u) => ({ ...u, title: plain(u.title), rows: u.rows.map(rowJson) })) }));

const cellHtml = (c: FileJson["units"][number]["rows"][number]["left"]) => (c ? `<span style="padding-left:${c.d * 1.5}rem">${c.html}</span>` : "");

const problemsHtml = (problems: NarrationProblem[]) => problems.map((p) => `<p class="problem">${esc(describeProblem(p))}</p>\n`).join("");

const diffHtml = (files: FileJson[]) =>
	files
		.map((f) =>
			f.skipped
				? `<section><h2>${esc(f.path)} (${f.status}, skipped: ${f.skipped})</h2></section>`
				: `<section><h2>${esc(f.path)} (${f.status}, +${f.adds} -${f.dels})</h2>
${problemsHtml(f.problems)}${f.units
	.filter((u) => u.status !== "unchanged")
	.map(
		(u) => `<h3>${toHtml(u.title, noLinks)} <small>${u.status}${u.other ? ` ${esc(u.other.path)}` : ""}</small></h3>
${u.rows
	.map((r) =>
		r.kind === "fold"
			? `<div class="row fold"><div>… ${r.count}</div></div>`
			: `<div class="row ${r.kind}"><div class="left">${cellHtml(r.left)}</div><div class="right">${cellHtml(r.right)}</div></div>`,
	)
	.join("\n")}`,
	)
	.join("\n")}</section>`,
		)
		.join("\n");

export function renderDiff({ structured, html, format }: { structured: () => FileDiff[]; html: () => FileJson[]; format: Format }): string {
	if (format === "json") return JSON.stringify(diffJson(structured()), null, 2);
	if (format === "html") return page(diffHtml(html()));
	return renderDiffText({ files: structured(), format: format === "ansi" ? toAnsi : plain });
}
