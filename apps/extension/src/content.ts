import { type Child, h, render } from "./dom";
import inlineCss from "./inline.css" with { type: "text" };
import { githubify, parseMarkup, splitDetails } from "./markup";
import { type ContentMessage, type DiffReport, type DiffRequest, PORT_CONTENT } from "./protocol";
import { getSettings, onSettingsChanged, saveSettings } from "./settings";

type FileJson = DiffReport["files"][number];
type UnitJson = FileJson["units"][number];
type RowJson = UnitJson["rows"][number];
type CellJson = NonNullable<RowJson["left"]>;

const LEGACY_PREF_KEY = "plainEnglish.enabled";
let enabled = true;

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
	progress: "",
	loading: false,
};

function loadReport(req: DiffRequest) {
	const key = JSON.stringify(req);
	if (state.key === key && (state.report || state.loading || state.error)) return;
	Object.assign(state, { key, report: null, error: null, progress: "", loading: true });
	const port = chrome.runtime.connect({ name: PORT_CONTENT });
	port.onMessage.addListener((msg: ContentMessage) => {
		if (state.key !== key) return;
		if (msg.type === "progress") {
			state.progress = msg.text;
			return renderFlash();
		}
		port.disconnect();
		state.loading = false;
		if (msg.ok) {
			state.report = msg.report;
			const { api, raw } = msg.report.requests;
			console.info(`[Narrator] ${api} GitHub API + ${raw} raw requests; plugins: ${msg.report.plugins.join(", ")}`);
		} else state.error = msg.error;
		apply();
	});
	port.onDisconnect.addListener(() => {
		if (state.key !== key || !state.loading) return;
		state.loading = false;
		state.error = "the extension's background stopped. Reload the page to try again.";
		apply();
	});
	port.postMessage(req);
}

/* ---------- rendering into GitHub's own diff markup ---------- */

const cls = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

function lineNode(c: CellJson): HTMLElement {
	let nodes = githubify(parseMarkup(c.html));
	let details: Child = null;
	if (c.kind === "head") {
		const { before, after } = splitDetails(nodes);
		if (after) {
			nodes = before;
			details = h("span", { class: "pe-sig" }, render(after));
		}
	}
	return h("span", { class: `pe-line pe-${c.kind}`, style: `--pe-d:${c.d}` }, render(nodes), details);
}

type Side = "addition" | "deletion" | "context";

/** Cell builders for one of GitHub's two diff UIs: the classic server-rendered table or the React one. */
type Flavor = {
	row: (cells: Child[]) => HTMLTableRowElement;
	num: (side: Side, n: number | null | undefined) => HTMLElement;
	code: (side: Side, c: CellJson | null, pos?: "left" | "right") => HTMLElement;
	blank: () => HTMLElement[];
	hunk: (split: boolean, content: Child, rowClass?: string) => HTMLTableRowElement;
	fold: (split: boolean, content: Child) => HTMLTableRowElement;
};

const marker = (side: Side) => (side === "addition" ? "+" : side === "deletion" ? "-" : " ");

const classic: Flavor = {
	row: (cells) => h("tr", {}, cells),
	num: (side, n) => (n ? h("td", { class: `blob-num blob-num-${side}`, "data-line-number": n }) : h("td", { class: `blob-num blob-num-${side} empty-cell` })),
	code: (side, c) =>
		c
			? h(
					"td",
					{ class: `blob-code blob-code-${side}` },
					h("span", { class: "blob-code-inner blob-code-marker", "data-code-marker": marker(side) }, lineNode(c)),
				)
			: h("td", { class: `blob-code blob-code-${side} empty-cell` }),
	blank: () => [h("td", { class: "blob-num empty-cell" }), h("td", { class: "blob-code empty-cell" })],
	hunk: (split, content, rowClass = "pe-hunk") =>
		h(
			"tr",
			{ class: rowClass },
			h("td", { class: "blob-num blob-num-hunk", colspan: !split && 2 }),
			h("td", { class: "blob-code blob-code-inner blob-code-hunk", colspan: split && 3 }, content),
		),
	fold: (split, content) =>
		h(
			"tr",
			{ class: "pe-fold" },
			h("td", { class: "blob-num blob-num-expandable", colspan: !split && 2 }, h("span", { class: "pe-expander" }, "⋯")),
			h("td", { class: "blob-code blob-code-inner blob-code-hunk", colspan: split && 3 }, content),
		),
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

const reactHunk = (split: boolean, content: Child, rowClass: string) =>
	h(
		"tr",
		{ class: `diff-line-row ${rowClass}` },
		h(
			"td",
			{ colspan: split ? 4 : 3, class: "diff-hunk-cell", style: "background-color: var(--bgColor-accent-muted, var(--color-accent-subtle))" },
			h("code", { class: "diff-text-cell hunk" }, h("div", { class: "diff-text-inner color-fg-muted" }, content)),
		),
	);

const react: Flavor = {
	row: (cells) => h("tr", { class: "diff-line-row" }, cells),
	num: (side, n) =>
		h(
			"td",
			{
				class: cls("new-diff-line-number", side === "context" && "diff-line-number-neutral", !n && "empty-diff-line"),
				"data-line-number": n || null,
				style: `background-color: ${reactBg[side][0]}`,
			},
			n ? String(n) : "",
		),
	code: (side, c, pos) =>
		h(
			"td",
			{ class: cls("diff-text-cell v-align-top", pos && `${pos}-side-diff-cell`), style: `background-color: ${reactBg[side][1]}; padding-right: 24px` },
			c &&
				h(
					"code",
					{ class: cls("diff-text syntax-highlighted-line", side !== "context" && side) },
					side !== "context" && h("span", { class: "diff-text-marker" }, marker(side)),
					h("div", { class: "diff-text-inner" }, lineNode(c)),
				),
		),
	blank: () => [h("td", { class: "empty-diff-line left-side" }), h("td", { class: "empty-diff-line left-side" })],
	hunk: (split, content, rowClass = "pe-hunk") => reactHunk(split, content, rowClass),
	fold: (split, content) => reactHunk(split, [h("span", { class: "pe-expander-inline" }, "⋯"), " ", content], "pe-fold"),
};

/** Continuation lines of one source statement share its line number; show it once. */
type Seen = { l: number | null; r: number | null };
const once = (seen: Seen, side: "l" | "r", n: number | null | undefined) => {
	if (!n || seen[side] === n) return null;
	seen[side] = n;
	return n;
};

function rowNodes(fl: Flavor, r: RowJson, split: boolean, seen: Seen = { l: null, r: null }): HTMLTableRowElement[] {
	if (r.kind === "fold") return [];
	if (split) {
		const left: Side = r.kind === "del" || r.kind === "mod" ? "deletion" : "context";
		const right: Side = r.kind === "add" || r.kind === "mod" ? "addition" : "context";
		const l = r.left ? [fl.num(left, once(seen, "l", r.left.from)), fl.code(left, r.left, "left")] : fl.blank();
		const rt = r.right ? [fl.num(right, once(seen, "r", r.right.from)), fl.code(right, r.right, "right")] : fl.blank();
		return [fl.row([l, rt])];
	}
	if (r.kind === "same")
		return [fl.row([fl.num("context", once(seen, "l", r.left?.from)), fl.num("context", once(seen, "r", r.right?.from)), fl.code("context", r.right)])];
	const out: HTMLTableRowElement[] = [];
	if (r.left) out.push(fl.row([fl.num("deletion", once(seen, "l", r.left.from)), fl.num("deletion", null), fl.code("deletion", r.left)]));
	if (r.right) out.push(fl.row([fl.num("addition", null), fl.num("addition", once(seen, "r", r.right.from)), fl.code("addition", r.right)]));
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

const fileName = (path: string) => path.split("/").pop() ?? path;

function unitTitle(u: UnitJson): Child[] {
	let origin = "";
	if (u.other && u.status === "renamed") origin = ` (was ${u.other.title})`;
	else if (u.other && u.status === "moved") origin = ` (from ${fileName(u.other.path)}${u.other.title !== u.title ? `, was ${u.other.title}` : ""})`;
	return [h("span", { class: "pe-unit-title" }, u.title), " ", h("span", { class: `pe-unit-status pe-${u.status}` }, statusWord[u.status] ?? u.status), origin];
}

/** Lists every unchanged unit; past a handful the rest sit behind an "and N more" toggle. */
function unchangedNote(units: UnitJson[]): HTMLElement {
	const names = units.map((u) => u.title);
	const SHOWN = 5;
	if (names.length <= SHOWN + 1) return h("span", { class: "pe-note" }, `${names.length} unchanged: ${names.join(", ")}`);
	const rest = h("span", { class: "pe-more-names", hidden: "" }, `, ${names.slice(SHOWN).join(", ")}`);
	const more = h("button", { type: "button", class: "btn-link pe-more", "aria-expanded": "false" }, `and ${names.length - SHOWN} more`);
	const glue = document.createTextNode(", ");
	more.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		rest.hidden = false;
		glue.remove();
		more.remove();
	});
	return h("span", { class: "pe-note" }, `${names.length} unchanged: ${names.slice(0, SHOWN).join(", ")}`, rest, glue, more);
}

function buildTable(fl: Flavor, f: FileJson | null, split: boolean, original: HTMLTableElement): HTMLTableElement {
	const table = h("table", {
		class: `${original.className} pe-table`,
		"data-tab-size": original.dataset.tabSize ?? "4",
		style: original.getAttribute("style"),
	});
	const colgroup = original.querySelector("colgroup")?.cloneNode(true) ?? null;
	const body = h("tbody");
	table.append(...(colgroup ? [colgroup] : []), body);
	if (!f) {
		body.append(
			fl.hunk(
				split,
				h(
					"span",
					{ class: "pe-note" },
					"Plain English: the English for this file didn't change, so the code is shown below (the edit is in imports, types, formatting or string contents).",
				),
			),
		);
		return table;
	}
	const changed = f.units.filter((u) => u.status !== "unchanged");
	const unchanged = f.units.filter((u) => u.status === "unchanged");
	if (!changed.length && f.status === "renamed") body.append(fl.hunk(split, h("span", { class: "pe-note" }, "Renamed with no logic changes.")));
	for (const u of changed) {
		if (u.status === "moved-away") {
			const other = u.other!;
			body.append(fl.hunk(split, [unitTitle(u), " to ", h("b", {}, fileName(other.path)), other.title !== u.title && [" as ", h("b", {}, other.title)]]));
			continue;
		}
		body.append(fl.hunk(split, unitTitle(u)));
		const seen: Seen = { l: null, r: null };
		for (const r of u.rows) {
			if (r.kind !== "fold") {
				body.append(...rowNodes(fl, r, split, seen));
				continue;
			}
			const count = r.count ?? r.hidden?.length ?? 0;
			const fold = fl.fold(split, `${count} unchanged line${count === 1 ? "" : "s"}`);
			fold.addEventListener("click", () => fold.replaceWith(...(r.hidden ?? []).flatMap((hidden) => rowNodes(fl, hidden, split))));
			body.append(fold);
		}
	}
	if (unchanged.length) body.append(fl.hunk(split, unchangedNote(unchanged)));
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
	if (!req || !enabled) return restoreAll();
	loadReport(req);
	renderFlash();
	if (!state.report) return;
	const byPath = new Map(state.report.files.map((f) => [f.path, f]));
	for (const { container, path, original, split, flavor } of targets()) {
		if (!narratable(path)) continue;
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
	const msg = state.error
		? `Plain English couldn't read this change: ${state.error}`
		: state.loading
			? `Plain English is reading this change…${state.progress ? ` ${state.progress}` : ""}`
			: "";
	if (!msg) return flash?.remove();
	if (!flash) {
		flash = h("div");
		(files?.parentElement ?? document.body).insertBefore(flash, files ?? null);
	}
	flash.className = cls("flash pe-flash mb-3", state.error && "flash-warn");
	flash.textContent = msg;
}

/* ---------- the toggle in GitHub's diff settings menu ---------- */

function setEnabled(on: boolean) {
	enabled = on;
	void saveSettings({ enabled: on });
	apply();
}

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
		box.checked = enabled;
		label.htmlFor = box.id;
		label.textContent = "Plain English";
		box.addEventListener("change", () => setEnabled(box.checked));
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
		mine.setAttribute("aria-checked", String(enabled));
		mine.addEventListener(
			"click",
			(e) => {
				e.preventDefault();
				e.stopPropagation();
				setEnabled(!enabled);
				mine.setAttribute("aria-checked", String(enabled));
			},
			true,
		);
		item.after(mine);
	}
}

/* ---------- wiring ---------- */

document.documentElement.append(h("style", {}, inlineCss));

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

const ours = (n: Node) => n instanceof Element && (n.classList.contains("pe-table") || n.classList.contains("pe-flash") || !!n.closest?.(".pe-table"));

async function start() {
	const settings = await getSettings();
	enabled = settings.enabled;
	// Before chrome.storage, the toggle lived in github.com's localStorage.
	if (localStorage.getItem(LEGACY_PREF_KEY) !== null) {
		if (localStorage.getItem(LEGACY_PREF_KEY) === "0" && enabled) setEnabled(false);
		localStorage.removeItem(LEGACY_PREF_KEY);
	}
	onSettingsChanged((patch) => {
		if (patch.enabled !== undefined && patch.enabled !== enabled) {
			enabled = patch.enabled;
			for (const item of document.querySelectorAll(".pe-toggle-item")) item.setAttribute("aria-checked", String(enabled));
			for (const box of document.querySelectorAll<HTMLInputElement>(".pe-toggle-row input[type=checkbox]")) box.checked = enabled;
		}
		if (patch.githubToken !== undefined && state.error) state.key = "";
		schedule();
	});

	new MutationObserver((muts) => {
		if (muts.every((m) => [...m.addedNodes, ...m.removedNodes].every(ours))) return;
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
}

void start();
