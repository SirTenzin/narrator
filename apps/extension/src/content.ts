import type { DiffReport, DiffRequest } from "./background";
import css from "./inline.css" with { type: "text" };

type FileJson = DiffReport["files"][number];
type UnitJson = FileJson["units"][number];
type RowJson = UnitJson["rows"][number];
type CellJson = NonNullable<RowJson["left"]>;

const PREF_KEY = "plainEnglish.enabled";
const isEnabled = () => localStorage.getItem(PREF_KEY) !== "0";
const setEnabled = (on: boolean) => localStorage.setItem(PREF_KEY, on ? "1" : "0");

const esc = (s: unknown) =>
	String(s ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

/* ---------- which page are we on ---------- */

function requestForPage(): DiffRequest | null {
	const p = location.pathname;
	const prCommit = /^\/([^/]+)\/([^/]+)\/pull\/\d+\/commits\/([0-9a-f]{7,40})/.exec(p);
	if (prCommit) return { kind: "commit", owner: prCommit[1]!, repo: prCommit[2]!, sha: prCommit[3]! };
	const pull = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(files|changes)/.exec(p);
	if (pull) return { kind: "pull", owner: pull[1]!, repo: pull[2]!, number: pull[3]! };
	const commit = /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{7,40})/.exec(p);
	if (commit) return { kind: "commit", owner: commit[1]!, repo: commit[2]!, sha: commit[3]! };
	return null;
}

/* ---------- report loading ---------- */

const state = {
	key: "",
	report: null as DiffReport | null,
	error: null as string | null,
	loading: false,
};

function loadReport(req: DiffRequest) {
	const key = JSON.stringify(req);
	if (state.key === key && (state.report || state.loading || state.error)) return;
	state.key = key;
	state.report = null;
	state.error = null;
	state.loading = true;
	const port = chrome.runtime.connect({ name: "plain-english" });
	port.onMessage.addListener((msg: any) => {
		if (state.key !== key || msg.type === "progress") return;
		port.disconnect();
		state.loading = false;
		if (msg.ok) state.report = msg.report;
		else state.error = msg.error;
		apply();
	});
	port.postMessage(req);
}

/* ---------- rendering into GitHub's own diff markup ---------- */

/** Our inline markup kinds mapped onto GitHub's syntax-highlight classes. */
function githubify(html: string): string {
	return html
		.replace(/<mark class="chg">/g, '<span class="x x-first x-last">')
		.replace(/<\/mark>/g, "</span>")
		.replace(/<span class="f"/g, '<span class="pl-en"')
		.replace(/<span class="t"/g, '<span class="pl-smi pe-type"')
		.replace(/<span class="c"/g, '<span class="pl-c1"')
		.replace(/<span class="l">("|&quot;)/g, '<span class="pl-s">$1')
		.replace(/<span class="l"/g, '<span class="pl-c1"');
}

function lineHtml(c: CellJson): string {
	let html = githubify(c.html);
	if (c.kind === "head") {
		const [title, details] = html.split('<wbr data-details="">');
		if (details !== undefined) html = `${title}<span class="pe-sig">${details}</span>`;
	}
	return `<span class="pe-line pe-${c.kind}" style="--pe-d:${c.d}">${html}</span>`;
}

type Side = "addition" | "deletion" | "context";

/** Cell builders for one of GitHub's two diff UIs: the classic server-rendered table or the React one. */
type Flavor = {
	num: (side: Side, n: number | null | undefined) => string;
	code: (side: Side, c: CellJson | null, pos?: "left" | "right") => string;
	blank: () => string;
	hunk: (split: boolean, html: string, attrs?: string) => string;
	fold: (split: boolean, html: string, attrs: string) => string;
};

const marker = (side: Side) => (side === "addition" ? "+" : side === "deletion" ? "-" : " ");

const classic: Flavor = {
	num: (side, n) => (n ? `<td class="blob-num blob-num-${side}" data-line-number="${n}"></td>` : `<td class="blob-num blob-num-${side} empty-cell"></td>`),
	code: (side, c) =>
		c
			? `<td class="blob-code blob-code-${side}"><span class="blob-code-inner blob-code-marker" data-code-marker="${marker(side)}">${lineHtml(c)}</span></td>`
			: `<td class="blob-code blob-code-${side} empty-cell"></td>`,
	blank: () => `<td class="blob-num empty-cell"></td><td class="blob-code empty-cell"></td>`,
	hunk: (split, html, attrs = "") =>
		`<tr class="pe-hunk" ${attrs}><td class="blob-num blob-num-hunk" ${split ? "" : 'colspan="2"'}></td><td class="blob-code blob-code-inner blob-code-hunk" ${split ? 'colspan="3"' : ""}>${html}</td></tr>`,
	fold: (split, html, attrs) =>
		`<tr class="pe-fold" ${attrs}><td class="blob-num blob-num-expandable" ${split ? "" : 'colspan="2"'}><span class="pe-expander">⋯</span></td><td class="blob-code blob-code-inner blob-code-hunk" ${split ? 'colspan="3"' : ""}>${html}</td></tr>`,
};

const reactBg: Record<Side, [string, string]> = {
	addition: [
		"var(--diffBlob-additionNum-bgColor, var(--diffBlob-addition-bgColor-num))",
		"var(--diffBlob-additionLine-bgColor, var(--diffBlob-addition-bgColor-line))",
	],
	deletion: [
		"var(--diffBlob-deletionNum-bgColor, var(--diffBlob-deletion-bgColor-num))",
		"var(--diffBlob-deletionLine-bgColor, var(--diffBlob-deletion-bgColor-line))",
	],
	context: ["var(--bgColor-default)", "var(--bgColor-default)"],
};
const reactHunk = (split: boolean, html: string, attrs: string, cls: string) =>
	`<tr class="diff-line-row ${cls}" ${attrs}><td colspan="${split ? 4 : 3}" class="diff-hunk-cell" style="background-color: var(--bgColor-accent-muted, var(--color-accent-subtle))"><code class="diff-text-cell hunk"><div class="diff-text-inner color-fg-muted">${html}</div></code></td></tr>`;

const react: Flavor = {
	num: (side, n) =>
		`<td class="new-diff-line-number ${side === "context" ? "diff-line-number-neutral" : ""} ${n ? "" : "empty-diff-line"}" ${n ? `data-line-number="${n}"` : ""} style="background-color: ${reactBg[side][0]}">${n ?? ""}</td>`,
	code: (side, c, pos) =>
		`<td class="diff-text-cell v-align-top ${pos ? `${pos}-side-diff-cell` : ""}" style="background-color: ${reactBg[side][1]}; padding-right: 24px">${
			c
				? `<code class="diff-text syntax-highlighted-line ${side === "context" ? "" : side}">${side === "context" ? "" : `<span class="diff-text-marker">${marker(side)}</span>`}<div class="diff-text-inner">${lineHtml(c)}</div></code>`
				: ""
		}</td>`,
	blank: () => `<td class="empty-diff-line left-side"></td><td class="empty-diff-line left-side"></td>`,
	hunk: (split, html, attrs = "") => reactHunk(split, html, attrs, "pe-hunk"),
	fold: (split, html, attrs) => reactHunk(split, `<span class="pe-expander-inline">⋯</span> ${html}`, attrs, "pe-fold"),
};

/** Continuation lines of one source statement share its line number; show it once. */
type Seen = { l: number | null; r: number | null };
const once = (seen: Seen, side: "l" | "r", n: number | null | undefined) => {
	if (!n || seen[side] === n) return null;
	seen[side] = n;
	return n;
};

function rowHtml(fl: Flavor, r: RowJson, split: boolean, seen: Seen = { l: null, r: null }): string {
	if (r.kind === "fold") return "";
	const tr = (cells: string) => `<tr${fl === react ? ' class="diff-line-row"' : ""}>${cells}</tr>`;
	if (split) {
		const left: Side = r.kind === "del" || r.kind === "mod" ? "deletion" : "context";
		const right: Side = r.kind === "add" || r.kind === "mod" ? "addition" : "context";
		const l = r.left ? fl.num(left, once(seen, "l", r.left.from)) + fl.code(left, r.left, "left") : fl.blank();
		const rt = r.right ? fl.num(right, once(seen, "r", r.right.from)) + fl.code(right, r.right, "right") : fl.blank();
		return tr(l + rt);
	}
	if (r.kind === "same")
		return tr(fl.num("context", once(seen, "l", r.left?.from)) + fl.num("context", once(seen, "r", r.right?.from)) + fl.code("context", r.right));
	let out = "";
	if (r.left) out += tr(fl.num("deletion", once(seen, "l", r.left.from)) + fl.num("deletion", null) + fl.code("deletion", r.left));
	if (r.right) out += tr(fl.num("addition", null) + fl.num("addition", once(seen, "r", r.right.from)) + fl.code("addition", r.right));
	return out;
}

const statusWord: Record<string, string> = {
	modified: "changed",
	added: "added",
	removed: "removed",
	moved: "moved",
	renamed: "renamed",
	"moved-away": "moved away",
};

function unitTitle(u: UnitJson): string {
	let origin = "";
	if (u.other && u.status === "renamed") origin = ` (was ${esc(u.other.title)})`;
	else if (u.other && u.status === "moved")
		origin = ` (from ${esc(u.other.path.split("/").pop())}${u.other.title !== u.title ? `, was ${esc(u.other.title)}` : ""})`;
	return `<span class="pe-unit-title">${esc(u.title)}</span> <span class="pe-unit-status pe-${esc(u.status)}">${statusWord[u.status] ?? esc(u.status)}</span>${origin}`;
}

function buildTable(fl: Flavor, f: FileJson | null, split: boolean, original: HTMLTableElement): HTMLTableElement {
	const table = document.createElement("table");
	table.className = `${original.className} pe-table`;
	table.dataset.tabSize = original.dataset.tabSize ?? "4";
	const style = original.getAttribute("style");
	if (style) table.setAttribute("style", style);
	const colgroup = original.querySelector("colgroup")?.outerHTML ?? "";
	let body = "";
	if (!f) {
		body += fl.hunk(
			split,
			`<span class="pe-note">Plain English: the English for this file didn't change, so the code is shown below (the edit is in imports, types, formatting or string contents).</span>`,
		);
		table.innerHTML = `${colgroup}<tbody>${body}</tbody>`;
		return table;
	}
	const changed = f.units.filter((u) => u.status !== "unchanged");
	const unchanged = f.units.filter((u) => u.status === "unchanged");
	if (!changed.length && f.status === "renamed") body += fl.hunk(split, `<span class="pe-note">Renamed with no logic changes.</span>`);
	changed.forEach((u, ui) => {
		if (u.status === "moved-away") {
			body += fl.hunk(
				split,
				`${unitTitle(u)} to <b>${esc(u.other!.path.split("/").pop())}</b>${u.other!.title !== u.title ? ` as <b>${esc(u.other!.title)}</b>` : ""}`,
			);
			return;
		}
		body += fl.hunk(split, unitTitle(u));
		const seen: Seen = { l: null, r: null };
		u.rows.forEach((r, ri) => {
			if (r.kind === "fold") body += fl.fold(split, `${r.count} unchanged line${r.count === 1 ? "" : "s"}`, `data-unit="${ui}" data-row="${ri}"`);
			else body += rowHtml(fl, r, split, seen);
		});
	});
	if (unchanged.length) {
		const names = unchanged
			.slice(0, 5)
			.map((u) => esc(u.title))
			.join(", ");
		body += fl.hunk(
			split,
			`<span class="pe-note">${unchanged.length} unchanged: ${names}${unchanged.length > 5 ? `, and ${unchanged.length - 5} more` : ""}</span>`,
		);
	}
	table.innerHTML = `${colgroup}<tbody>${body}</tbody>`;
	table.addEventListener("click", (e) => {
		const t = e.target as HTMLElement;
		const fold = t.closest<HTMLElement>("tr.pe-fold");
		if (fold) {
			const r = changed[Number(fold.dataset.unit)]!.rows[Number(fold.dataset.row)]!;
			fold.outerHTML = (r.hidden ?? []).map((h) => rowHtml(fl, h, split)).join("");
			return;
		}
		if (t.closest(".pe-show-code")) {
			e.preventDefault();
			original.classList.remove("pe-hidden");
			original.removeAttribute("data-pe-hidden");
			table.remove();
			original.dataset.peKeep = "1";
		}
	});
	return table;
}

/* ---------- applying to the page ---------- */

type Target = { container: HTMLElement; path: string; original: HTMLTableElement; split: boolean; flavor: Flavor };

const clean = (s: string) => s.replace(/[\u200e\u200f]/g, "").trim();
const narratable = (p: string) => /\.(m|c)?[tj]sx?$/.test(p) && !/\.d\.ts$/.test(p);

function targets(): Target[] {
	const out: Target[] = [];
	for (const file of document.querySelectorAll<HTMLElement>("div.file")) {
		const original = file.querySelector<HTMLTableElement>("table.diff-table:not(.pe-table)");
		const path = file.querySelector<HTMLElement>(".file-header[data-path]")?.dataset.path ?? file.dataset.tagsearchPath;
		if (original && path) out.push({ container: file, path, original, split: original.classList.contains("file-diff-split"), flavor: classic });
	}
	for (const original of document.querySelectorAll<HTMLTableElement>('table[aria-label^="Diff for:"]:not(.pe-table)')) {
		const container = original.parentElement;
		if (!container) continue;
		const region = original.closest<HTMLElement>('[role="region"]');
		let path = clean(original.getAttribute("aria-label")!.slice("Diff for:".length));
		if (path.includes(" → ")) path = clean(path.split(" → ").pop()!);
		const named = region?.querySelector<HTMLElement>("[data-file-path]")?.dataset.filePath;
		if (named) path = named;
		out.push({ container, path, original, split: original.querySelectorAll("colgroup col").length >= 4, flavor: react });
	}
	return out;
}

const hide = (t: HTMLTableElement) => (t.classList.add("pe-hidden"), t.setAttribute("data-pe-hidden", ""));

function restoreAll() {
	for (const t of document.querySelectorAll(".pe-table")) t.remove();
	for (const t of document.querySelectorAll("table.pe-hidden, table[data-pe-hidden]")) {
		t.classList.remove("pe-hidden");
		t.removeAttribute("data-pe-hidden");
	}
	document.querySelector(".pe-flash")?.remove();
}

function apply() {
	const req = requestForPage();
	if (!req || !isEnabled()) return restoreAll();
	loadReport(req);
	renderFlash();
	if (!state.report) return;
	const byPath = new Map(state.report.files.map((f) => [f.path, f]));
	for (const { container, path, original, split, flavor } of targets()) {
		if (!narratable(path) || original.dataset.peKeep) continue;
		const report = byPath.get(path) ?? null;
		const signature = `${state.key}|${split}`;
		const existing = container.querySelector<HTMLTableElement>("table.pe-table");
		if (existing?.dataset.peSig === signature) {
			if (report) hide(original);
			continue;
		}
		existing?.remove();
		const table = buildTable(flavor, report, split, original);
		table.dataset.peSig = signature;
		if (report) {
			hide(original);
			original.after(table);
		} else original.before(table);
	}
}

function renderFlash() {
	const files = document.querySelector("#files, .js-diff-progressive-container, #diff-content-parent");
	let flash = document.querySelector<HTMLElement>(".pe-flash");
	const msg = state.error ? `Plain English couldn't read this change: ${esc(state.error)}` : state.loading ? "Plain English is reading this change…" : "";
	if (!msg) return flash?.remove();
	if (!flash) {
		flash = document.createElement("div");
		flash.className = `flash pe-flash mb-3 ${state.error ? "flash-warn" : ""}`;
		(files?.parentElement ?? document.body).insertBefore(flash, files ?? null);
	}
	flash.className = `flash pe-flash mb-3 ${state.error ? "flash-warn" : ""}`;
	flash.innerHTML = msg;
}

/* ---------- the toggle in GitHub's diff settings menu ---------- */

function injectToggle() {
	// Classic diff settings popover: add a row under "Hide whitespace".
	for (const ws of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="w"]')) {
		const row = ws.closest("div");
		if (!row || row.parentElement?.querySelector(".pe-toggle-row")) continue;
		const mine = row.cloneNode(true) as HTMLElement;
		mine.classList.add("pe-toggle-row");
		for (const hidden of mine.querySelectorAll('input[type="hidden"]')) hidden.remove();
		const box = mine.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
		const label = mine.querySelector("label")!;
		box.id = `pe-toggle-${Math.random().toString(36).slice(2)}`;
		box.removeAttribute("name");
		box.checked = isEnabled();
		label.htmlFor = box.id;
		label.textContent = "Plain English";
		box.addEventListener("change", () => {
			setEnabled(box.checked);
			apply();
		});
		row.after(mine);
	}
	// New React diff settings menu: clone the "Minimize comments" item.
	for (const item of document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"], [role="menuitemradio"], li[role="menuitem"]')) {
		if (!/Minimize comments/i.test(item.textContent ?? "") || item.parentElement?.querySelector(".pe-toggle-item")) continue;
		const mine = item.cloneNode(true) as HTMLElement;
		mine.classList.add("pe-toggle-item");
		mine.removeAttribute("id");
		for (const el of mine.querySelectorAll("[id]")) el.removeAttribute("id");
		const textNode = [...mine.querySelectorAll("*")].find((el) => el.children.length === 0 && /Minimize comments/i.test(el.textContent ?? ""));
		if (textNode) textNode.textContent = "Plain English";
		for (const kbd of mine.querySelectorAll("kbd, [class*='TrailingVisual']")) kbd.remove();
		const sync = () => mine.setAttribute("aria-checked", String(isEnabled()));
		sync();
		mine.addEventListener(
			"click",
			(e) => {
				e.preventDefault();
				e.stopPropagation();
				setEnabled(!isEnabled());
				sync();
				apply();
			},
			true,
		);
		item.after(mine);
	}
}

/* ---------- wiring ---------- */

const style = document.createElement("style");
style.textContent = css;
document.documentElement.append(style);

let scheduled = false;
const schedule = () => {
	if (scheduled) return;
	scheduled = true;
	requestAnimationFrame(() => {
		scheduled = false;
		injectToggle();
		apply();
	});
};

new MutationObserver((muts) => {
	if (
		muts.every((m) => [...m.addedNodes, ...m.removedNodes].every((n) => n instanceof Element && (n.classList.contains("pe-table") || n.closest?.(".pe-table"))))
	)
		return;
	schedule();
}).observe(document.documentElement, { childList: true, subtree: true });

let lastPath = location.pathname;
setInterval(() => {
	if (location.pathname !== lastPath) {
		lastPath = location.pathname;
		schedule();
	}
}, 500);
document.addEventListener("turbo:load", schedule);
schedule();
