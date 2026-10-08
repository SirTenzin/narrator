const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const prefs = {
	source: localStorage.getItem("pe.source") !== "0",
	comments: localStorage.getItem("pe.comments") !== "0",
	sourceWidth: localStorage.getItem("pe.sourceWidth"),
	diffLayout: localStorage.getItem("pe.diffLayout") ?? "split",
};
const state = { files: [], file: null, recent: JSON.parse(localStorage.getItem("pe.recent") ?? "[]") };

const cache = new Map();
const api = (path) => {
	if (!cache.has(path)) cache.set(path, fetch(path).then((r) => r.json()).catch((e) => ({ error: String(e) })));
	return cache.get(path);
};

/* ---------- rendering ---------- */

function buildTree(lines) {
	const root = { children: [] };
	const stack = [{ d: -1, node: root }];
	for (const line of lines) {
		if (line.kind === "blank") continue;
		const node = { line, children: [] };
		while (stack.length > 1 && stack.at(-1).d >= line.d) stack.pop();
		stack.at(-1).node.children.push(node);
		stack.push({ d: line.d, node });
	}
	return root.children;
}

function lineEl(line, hasKids) {
	const el = document.createElement("div");
	el.className = `ln ${line.kind}`;
	if (line.from) {
		el.dataset.from = line.from;
		el.dataset.to = line.to ?? line.from;
	}
	let html = line.html;
	if (line.kind === "head") {
		const i = html.indexOf(" — ");
		if (i > 0 && html.lastIndexOf("<", i) <= html.lastIndexOf(">", i)) {
			const sig = html.slice(i + 3).replace(/:$/, "");
			html = `${html.slice(0, i)}<span class="sig">${sig.charAt(0).toUpperCase()}${sig.slice(1)}</span>`;
		}
	}
	el.innerHTML = (hasKids ? `<button class="fold" aria-label="Fold" tabindex="-1"><svg viewBox="0 0 10 10" width="9" height="9"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>` : "") + html;
	return el;
}

function renderNodes(nodes, parent) {
	for (const node of nodes) {
		const blk = document.createElement("div");
		blk.className = "blk";
		blk.append(lineEl(node.line, node.children.length > 0));
		if (node.children.length) {
			const kids = document.createElement("div");
			kids.className = "kids";
			renderNodes(node.children, kids);
			blk.append(kids);
		}
		parent.append(blk);
	}
}

/** Top-level: each declaration (with the comment above it) becomes a card. */
function renderDocument(lines) {
	const doc = $("#doc");
	doc.textContent = "";
	const nodes = buildTree(lines);
	let pendingNotes = [];
	const flushNotes = () => {
		for (const n of pendingNotes) {
			const card = document.createElement("div");
			card.className = "blk top plain";
			card.append(lineEl(n.line, false));
			doc.append(card);
		}
		pendingNotes = [];
	};
	for (const node of nodes) {
		if (node.line.kind === "note" && !node.children.length) {
			pendingNotes.push(node);
			continue;
		}
		const isDecl = node.line.kind === "head" || node.children.length > 0;
		const card = document.createElement("div");
		card.className = `blk top${isDecl ? "" : " plain"}`;
		if (isDecl) {
			for (const n of pendingNotes) {
				const noteEl = lineEl(n.line, false);
				noteEl.classList.add("doc-comment");
				card.append(noteEl);
			}
			pendingNotes = [];
		} else flushNotes();
		const inner = document.createElement("div");
		renderNodes([node], inner);
		card.append(...inner.firstChild.childNodes);
		doc.append(card);
	}
	flushNotes();
	applyPrefs();
}

function renderOutline() {
	const ol = $("#outline");
	const heads = $$("#doc > .blk.top > .ln.head");
	if (!heads.length) {
		ol.innerHTML = `<li class="empty">No declarations</li>`;
		return;
	}
	ol.innerHTML = "";
	for (const h of heads) {
		const li = document.createElement("li");
		const label = (h.querySelector(".f")?.textContent ?? h.textContent).replace(/^To /, "");
		const kind = /\(component\)/.test(h.textContent) ? "◇" : /\?$/.test(label) ? "?" : /→/.test(label) ? "→" : "ƒ";
		li.innerHTML = `<button><span class="kind">${kind}</span>${esc(label)}</button>`;
		li.firstChild.addEventListener("click", () => {
			h.scrollIntoView({ block: "start", behavior: "smooth" });
			flash(h);
		});
		ol.append(li);
	}
}

function renderRecent() {
	const ol = $("#recent");
	const items = state.recent.filter((f) => f !== state.file).slice(0, 8);
	if (!items.length) {
		ol.innerHTML = `<li class="empty">Files you open show up here</li>`;
		return;
	}
	ol.innerHTML = items
		.map((f) => {
			const name = f.split("/").pop();
			return `<li><button data-recent="${esc(f)}" title="${esc(f)}"><b>${esc(name)}</b></button></li>`;
		})
		.join("");
}

function renderCrumbs(file) {
	const parts = file.split("/");
	$("#crumbs").innerHTML = parts
		.map((p, i) => {
			const dir = parts.slice(0, i + 1).join("/");
			return i === parts.length - 1 ? `<span class="file">${esc(p)}</span>` : `<button data-dir="${esc(dir)}/">${esc(p)}</button><span class="sep">/</span>`;
		})
		.join("");
	$("#crumbs").scrollLeft = 1e6;
}

/* ---------- source pane with light highlighting ---------- */

const KW = new Set("const let var function return if else for of in while do switch case default break continue throw try catch finally new class extends import export from as async await yield type interface enum typeof instanceof void delete this super null undefined true false satisfies keyof readonly implements".split(" "));

function highlight(src) {
	const re = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
	const out = [];
	let last = 0;
	for (const m of src.matchAll(re)) {
		if (m.index > last) out.push(["", src.slice(last, m.index)]);
		const cls = m[1] ? "com" : m[2] ? "str" : m[3] ? "num" : KW.has(m[4]) ? "kw" : "";
		out.push([cls, m[0]]);
		last = m.index + m[0].length;
	}
	out.push(["", src.slice(last)]);
	const lines = [[]];
	for (const [cls, text] of out) {
		const parts = text.split("\n");
		parts.forEach((p, i) => {
			if (i > 0) lines.push([]);
			if (p) lines.at(-1).push(cls ? `<span class="${cls}">${esc(p)}</span>` : esc(p));
		});
	}
	return lines.map((l, i) => `<span class="sl" id="L${i + 1}" data-n="${i + 1}">${l.join("") || " "}</span>`).join("");
}

function renderSource(file, src) {
	$("#code").innerHTML = highlight(src);
	$("#source-name").textContent = file.split("/").pop();
	$("#source-meta").textContent = `${src.split("\n").length} lines`;
}

/* ---------- navigation ---------- */

async function openFile(file, { line = null, push = true } = {}) {
	if (!file) return;
	setMode("file");
	if (push) history.pushState({ file, line }, "", `?file=${encodeURIComponent(file)}${line ? `&line=${line}` : ""}`);
	if (state.file !== file || state.renderedDiff) {
		state.renderedDiff = null;
		$("#doc").innerHTML = `<div class="loading">Reading ${esc(file)}…</div>`;
		const res = await api(`/api/narrate?file=${encodeURIComponent(file)}`);
		if (res.error) {
			$("#doc").innerHTML = `<div class="error">${esc(res.error)}</div>`;
			return;
		}
		state.file = file;
		document.title = `${file.split("/").pop()} · Plain English`;
		renderCrumbs(file);
		renderDocument(res.lines);
		renderSource(file, res.src);
		renderOutline();
		state.recent = [file, ...state.recent.filter((f) => f !== file)].slice(0, 20);
		localStorage.setItem("pe.recent", JSON.stringify(state.recent));
		renderRecent();
		$("#reader").scrollTop = 0;
		$("#code").scrollTop = 0;
	}
	if (line) revealLine(line);
}

function revealLine(line) {
	const target = $$("#doc .ln[data-from]").find((el) => Number(el.dataset.from) >= line);
	if (target) {
		target.scrollIntoView({ block: "center" });
		flash(target);
	}
	highlightSource(line, line, true);
}

function flash(el) {
	el.classList.add("hl-strong");
	setTimeout(() => el.classList.remove("hl-strong"), 1200);
}

/* ---------- hover sync ---------- */

function highlightSource(from, to, scroll) {
	$$(".sl.hl").forEach((e) => e.classList.remove("hl"));
	if (!from) return;
	for (let i = from; i <= to; i++) document.getElementById(`L${i}`)?.classList.add("hl");
	if (!scroll || !prefs.source) return;
	const el = document.getElementById(`L${from}`);
	const pane = $("#code");
	if (el && (el.offsetTop < pane.scrollTop + 20 || el.offsetTop > pane.scrollTop + pane.clientHeight - 60)) pane.scrollTo({ top: el.offsetTop - pane.clientHeight / 3, behavior: "smooth" });
}

$("#doc").addEventListener("mouseover", (e) => {
	const ln = e.target.closest(".ln");
	if (!ln || ln.closest(".expand")) return;
	highlightSource(Number(ln.dataset.from), Number(ln.dataset.to), true);
});

$("#code").addEventListener("mouseover", (e) => {
	const sl = e.target.closest(".sl");
	if (!sl) return;
	const n = Number(sl.dataset.n);
	$$("#doc .ln.hl").forEach((x) => x.classList.remove("hl"));
	let best = null;
	for (const ln of $$("#doc .ln[data-from]")) {
		if (ln.closest(".expand")) continue;
		const f = Number(ln.dataset.from);
		const t = Number(ln.dataset.to);
		if (f <= n && n <= t && (!best || t - f <= best.span)) best = { ln, span: t - f };
	}
	best?.ln.classList.add("hl");
});

$("#code").addEventListener("click", (e) => {
	const sl = e.target.closest(".sl");
	const hit = $("#doc .ln.hl");
	if (sl && hit) hit.scrollIntoView({ block: "center", behavior: "smooth" });
});

/* ---------- clicks: fold, expand, highlight ---------- */

$("#doc").addEventListener("click", async (e) => {
	hidePopover();
	const fold = e.target.closest(".fold");
	if (fold) {
		const blk = fold.closest(".blk");
		const folded = !blk.classList.contains("folded");
		const scope = e.altKey ? $$(":scope > .blk", blk.parentElement) : [blk];
		for (const b of scope) if (b.querySelector(":scope > .kids")) b.classList.toggle("folded", folded);
		return;
	}
	const close = e.target.closest("[data-close]");
	if (close) return close.closest(".expand").remove();
	const openBtn = e.target.closest("[data-open]");
	if (openBtn) return openFile(openBtn.dataset.open, { line: Number(openBtn.dataset.line) });

	const a = e.target.closest("a[href]");
	const v = e.target.closest(".v");
	if (v && (!a || a.getAttribute("href").startsWith("#type:"))) toggleMatches(v);
	if (!a) return;
	e.preventDefault();
	const href = a.getAttribute("href");
	const from = a.closest("[data-file]")?.dataset.file ?? state.file;
	if (href.startsWith("#def:")) {
		const name = href.slice(5);
		const res = await api(`/api/def?name=${encodeURIComponent(name)}&from=${encodeURIComponent(from)}`);
		if (!res.found) return a.classList.add("dead");
		if (e.metaKey || e.ctrlKey) return openFile(res.file, { line: res.line });
		toggleExpansion(a, { key: `def:${name}`, kind: "def", label: "Definition", name, res });
	}
	if (href.startsWith("#type:")) {
		const [name, field] = href.slice(6).split("#");
		const res = await api(`/api/type?name=${encodeURIComponent(name)}&from=${encodeURIComponent(from)}`);
		if (!res.found) return a.classList.add("dead");
		if (e.metaKey || e.ctrlKey) return openFile(res.file, { line: res.line });
		toggleExpansion(a, { key: `type:${name}`, kind: "typebox", label: "Type", name, res, field });
	}
});

function toggleMatches(v) {
	const n = v.dataset.n;
	const on = !v.classList.contains("match");
	$$(".v.match").forEach((x) => x.classList.remove("match"));
	if (on && n) $$(`#doc .v[data-n="${CSS.escape(n)}"]`).filter((x) => !x.closest(".expand")).forEach((x) => x.classList.add("match"));
}

function toggleExpansion(anchor, { key, kind, label, name, res, field }) {
	const ln = anchor.closest(".ln, .dcell");
	const next = ln.nextElementSibling;
	if (next?.classList.contains("expand") && next.dataset.key === key) {
		next.remove();
		return;
	}
	const box = document.createElement("div");
	box.className = `expand ${kind}`;
	box.dataset.key = key;
	box.dataset.file = res.file;
	box.innerHTML = `
		<div class="expand-head">
			<span class="badge">${label}</span>
			<span class="name">${esc(name)}</span>
			<span class="path" title="${esc(res.file)}">${esc(res.file)}:${res.line}</span>
			<button data-open="${esc(res.file)}" data-line="${res.line}">Open ↗</button>
			<button data-close aria-label="Close">✕</button>
		</div>
		<div class="expand-body"></div>`;
	renderNodes(buildTree(res.lines), box.querySelector(".expand-body"));
	if (ln.classList.contains("dcell")) {
		box.style.gridColumn = "1 / -1";
		const row = ln.classList.contains("side-l") && ln.nextElementSibling?.classList.contains("side-r") ? ln.nextElementSibling : ln;
		row.after(box);
	} else ln.after(box);
	if (field) {
		const hit = $$(".ln", box).find((l) => l.querySelector(`.v[data-n="${CSS.escape(field)}"]`));
		if (hit) {
			hit.classList.add("fieldhit");
			hit.scrollIntoView({ block: "nearest", behavior: "smooth" });
		}
	}
	applyPrefs();
}

/* ---------- popover for typed names ---------- */

let popTimer = null;
function hidePopover() {
	clearTimeout(popTimer);
	$("#popover").hidden = true;
}

$("#doc").addEventListener("mouseover", (e) => {
	const a = e.target.closest('a[href^="#type:"]');
	if (!a) return hidePopover();
	clearTimeout(popTimer);
	popTimer = setTimeout(() => showTypePopover(a), 280);
});
$("#doc").addEventListener("mouseleave", hidePopover);

async function showTypePopover(a) {
	const [name, field] = a.getAttribute("href").slice(6).split("#");
	const res = await api(`/api/type?name=${encodeURIComponent(name)}&from=${encodeURIComponent(a.closest("[data-file]")?.dataset.file ?? state.file)}`);
	if (!res.found || !a.matches(":hover")) return;
	let body;
	if (field) {
		const tmp = document.createElement("div");
		tmp.innerHTML = res.lines.map((l) => `<div>${l.html}</div>`).join("");
		const hit = [...tmp.children].find((d) => d.querySelector(`.v[data-n="${CSS.escape(field)}"]`));
		if (!hit) return;
		body = `<div class="pop-head">${esc(name)} → ${esc(field)}</div><div>${hit.innerHTML.replace(/^•\s*/, "")}</div>`;
	} else {
		const rows = res.lines.filter((l) => l.kind !== "blank").slice(0, 7);
		body = `<div class="pop-head">${esc(name)} · click to expand</div>${rows.map((l) => `<div class="pop-row" style="--d:${l.d}">${l.html}</div>`).join("")}${res.lines.length > 7 ? `<div class="muted">… ${res.lines.length - 7} more</div>` : ""}`;
	}
	const pop = $("#popover");
	pop.innerHTML = body;
	pop.hidden = false;
	const r = a.getBoundingClientRect();
	const w = pop.offsetWidth;
	pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 12))}px`;
	const below = r.bottom + 8;
	pop.style.top = `${below + pop.offsetHeight > innerHeight - 8 ? r.top - pop.offsetHeight - 8 : below}px`;
}

/* ---------- palette ---------- */

const palette = { sel: 0, matches: [], mode: "files", commits: [] };

function fuzzy(path, q) {
	const lower = path.toLowerCase();
	const name = lower.slice(lower.lastIndexOf("/") + 1);
	let pos = 0;
	let score = 0;
	let prev = -2;
	const hits = [];
	for (const ch of q) {
		if (ch === " ") continue;
		const i = lower.indexOf(ch, pos);
		if (i < 0) return null;
		score += i === prev + 1 ? 4 : 1;
		if (i >= lower.length - name.length) score += 2;
		hits.push(i);
		prev = i;
		pos = i + 1;
	}
	if (name.includes(q.replace(/ /g, ""))) score += 25;
	if (name.startsWith(q.replace(/ /g, ""))) score += 15;
	return { score: score - path.length / 80, hits };
}

function renderPaletteResults() {
	const ol = $("#palette-results");
	if (palette.mode === "commits") {
		if (!palette.matches.length) {
			ol.innerHTML = `<div class="none">${palette.commits.length ? "No matching commits" : "Loading commits…"}</div>`;
			return;
		}
		ol.innerHTML = palette.matches
			.map((c, i) => `<li class="${i === palette.sel ? "sel" : ""}" data-i="${i}"><span class="csub">${esc(c.subject)}</span><span class="cmeta">${esc(c.short)} · ${esc(c.author)} · ${esc(c.when)}</span></li>`)
			.join("");
		ol.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
		return;
	}
	if (!palette.matches.length) {
		ol.innerHTML = `<div class="none">No matching files</div>`;
		return;
	}
	ol.innerHTML = palette.matches
		.map(({ path, hits }, i) => {
			const set = new Set(hits);
			const cut = path.lastIndexOf("/") + 1;
			const mark = (from, to) => [...path.slice(from, to)].map((ch, k) => (set.has(from + k) ? `<mark>${esc(ch)}</mark>` : esc(ch))).join("");
			return `<li class="${i === palette.sel ? "sel" : ""}" data-i="${i}"><span class="fname">${mark(cut, path.length)}</span><span class="dir">${mark(0, cut)}</span></li>`;
		})
		.join("");
	ol.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
}

function updatePalette() {
	const q = $("#palette-input").value.toLowerCase().trim();
	palette.sel = 0;
	if (palette.mode === "commits") {
		const range = /^([\w./^~-]+)\.\.([\w./^~-]+)$/.exec(q);
		palette.matches = range
			? [{ subject: `Compare ${range[1]} → ${range[2]}`, short: "range", author: "", when: "", base: range[1], head: range[2] }]
			: palette.commits.filter((c) => !q || `${c.subject} ${c.short} ${c.author}`.toLowerCase().includes(q) || c.sha.startsWith(q)).slice(0, 60);
		if (!range && /^[0-9a-f]{6,40}$/.test(q) && !palette.matches.length) palette.matches = [{ subject: `Commit ${q}`, short: q, author: "", when: "", sha: q }];
		return renderPaletteResults();
	}
	if (!q) palette.matches = state.recent.slice(0, 12).map((path) => ({ path, hits: [] }));
	else
		palette.matches = state.files
			.map((path) => ({ path, ...(fuzzy(path, q) ?? { score: -1 }) }))
			.filter((m) => m.score >= 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, 40);
	renderPaletteResults();
}

function openPalette(prefill = "", mode = "files") {
	palette.mode = mode;
	$("#palette").hidden = false;
	const input = $("#palette-input");
	input.placeholder = mode === "commits" ? "Search commits, paste a SHA, or type base..head" : "Search files by name or path…";
	if (mode === "commits" && !palette.commits.length)
		api("/api/commits").then((c) => {
			palette.commits = Array.isArray(c) ? c : [];
			updatePalette();
		});
	input.value = prefill;
	input.focus();
	updatePalette();
}

function closePalette() {
	$("#palette").hidden = true;
}

$("#palette-input").addEventListener("input", updatePalette);
$("#palette-input").addEventListener("keydown", (e) => {
	if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) palette.sel = Math.min(palette.sel + 1, palette.matches.length - 1);
	else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) palette.sel = Math.max(palette.sel - 1, 0);
	else if (e.key === "Enter") {
		const m = palette.matches[palette.sel];
		if (m) {
			closePalette();
			choose(m);
		}
		return;
	} else if (e.key === "Escape") return closePalette();
	else return;
	e.preventDefault();
	renderPaletteResults();
});
$("#palette-results").addEventListener("click", (e) => {
	const li = e.target.closest("li[data-i]");
	if (!li) return;
	closePalette();
	choose(palette.matches[Number(li.dataset.i)]);
});

function choose(m) {
	if (palette.mode === "files") return openFile(m.path);
	if (m.base) return openDiff({ base: m.base, head: m.head });
	return openDiff({ commit: m.sha });
}
$("#palette").addEventListener("mousedown", (e) => {
	if (e.target.id === "palette") closePalette();
});

/* ---------- chrome: toggles, theme, splitter, keys ---------- */

function applyPrefs() {
	$("#layout").classList.toggle("no-source", !prefs.source);
	$('[data-toggle="source"]').setAttribute("aria-pressed", prefs.source);
	$('[data-toggle="comments"]').setAttribute("aria-pressed", prefs.comments);
	$$(".ln.note").forEach((x) => (x.style.display = prefs.comments ? "" : "none"));
	if (prefs.sourceWidth) document.documentElement.style.setProperty("--source-w", prefs.sourceWidth);
}

function togglePref(key) {
	prefs[key] = !prefs[key];
	localStorage.setItem(`pe.${key}`, prefs[key] ? "1" : "0");
	applyPrefs();
}

function toggleTheme() {
	const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
	document.documentElement.dataset.theme = next;
	localStorage.setItem("pe.theme", next);
}

document.addEventListener("click", (e) => {
	const t = e.target.closest("[data-toggle]");
	if (t) return togglePref(t.dataset.toggle);
	const act = e.target.closest("[data-action]")?.dataset.action;
	if (act === "palette") return openPalette();
	if (act === "theme") return toggleTheme();
	if (act === "home") return openPalette();
	if (act === "commits") return openPalette("", "commits");
	const dir = e.target.closest("[data-dir]");
	if (dir) return openPalette(dir.dataset.dir);
	const rec = e.target.closest("[data-recent]");
	if (rec) return openFile(rec.dataset.recent);
});

document.addEventListener("keydown", (e) => {
	if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
		e.preventDefault();
		return openPalette();
	}
	if (e.key === "Escape") {
		hidePopover();
		return closePalette();
	}
	if (e.target.closest("input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
	if (e.key === "/") {
		e.preventDefault();
		openPalette();
	}
	if (e.key === "d") openPalette("", "commits");
	if (e.key === "u" && state.renderedDiff) setDiffLayout(prefs.diffLayout === "split" ? "unified" : "split");
	if (e.key === "s") togglePref("source");
	if (e.key === "c") togglePref("comments");
	if (e.key === "t") toggleTheme();
});

const splitter = $("#splitter");
splitter.addEventListener("pointerdown", (e) => {
	splitter.setPointerCapture(e.pointerId);
	splitter.classList.add("dragging");
	const move = (ev) => {
		const w = Math.max(280, Math.min(innerWidth - 600, innerWidth - ev.clientX));
		prefs.sourceWidth = `${w}px`;
		document.documentElement.style.setProperty("--source-w", prefs.sourceWidth);
	};
	const up = () => {
		splitter.classList.remove("dragging");
		localStorage.setItem("pe.sourceWidth", prefs.sourceWidth);
		splitter.removeEventListener("pointermove", move);
		splitter.removeEventListener("pointerup", up);
	};
	splitter.addEventListener("pointermove", move);
	splitter.addEventListener("pointerup", up);
});

window.addEventListener("popstate", (e) => {
	const s = e.state ?? Object.fromEntries(new URLSearchParams(location.search));
	if (s.diff) return openDiff(s.diff, { push: false });
	openFile(s.file, { line: Number(s.line) || null, push: false });
});

/* ---------- diffs ---------- */

function setMode(mode) {
	document.body.classList.toggle("mode-diff", mode === "diff");
	document.body.classList.toggle("mode-file", mode === "file");
}

const diffQuery = (spec) => (spec.commit ? `commit=${encodeURIComponent(spec.commit)}` : `base=${encodeURIComponent(spec.base)}&head=${encodeURIComponent(spec.head)}`);

async function openDiff(spec, { push = true } = {}) {
	setMode("diff");
	if (push) history.pushState({ diff: spec }, "", `?${diffQuery(spec)}`);
	$("#doc").innerHTML = `<div class="loading">Narrating both sides of ${esc(spec.commit ?? `${spec.base}..${spec.head}`)}…</div>`;
	const res = await api(`/api/diff?${diffQuery(spec)}`);
	if (res.error) {
		$("#doc").innerHTML = `<div class="error">${esc(res.error)}</div>`;
		return;
	}
	state.renderedDiff = res;
	state.file = null;
	document.title = `${res.subject || res.short} · Plain English`;
	$("#crumbs").innerHTML = `<span class="file">${esc(res.short)}</span><span class="sep">&nbsp;·&nbsp;</span><span>${esc(res.subject)}</span>`;
	renderDiff(res);
	$("#reader").scrollTop = 0;
}

function setDiffLayout(layout) {
	prefs.diffLayout = layout;
	localStorage.setItem("pe.diffLayout", layout);
	if (state.renderedDiff) renderDiff(state.renderedDiff, { keepScroll: true });
}

const fileName = (p) => {
	const i = p.lastIndexOf("/");
	return `<span class="muted">${esc(p.slice(0, i + 1))}</span><b>${esc(p.slice(i + 1))}</b>`;
};

function renderDiff(res, { keepScroll = false } = {}) {
	const scroll = $("#reader").scrollTop;
	const adds = res.files.reduce((n, f) => n + f.adds, 0);
	const dels = res.files.reduce((n, f) => n + f.dels, 0);
	const doc = $("#doc");
	doc.innerHTML = `
		<div class="diff-head">
			<div class="title">
				<h1>${esc(res.subject || "Comparison")}</h1>
				<div class="meta"><code>${esc(res.short)}</code> ${res.author ? `· ${esc(res.author)} · ${esc(res.when)}` : ""} · ${res.files.length} file${res.files.length === 1 ? "" : "s"} with logic changes · <span class="stat"><span class="a">+${adds}</span> <span class="r">−${dels}</span></span> lines of English</div>
			</div>
			<div class="segmented" role="group">
				<button data-layout="split" aria-pressed="${prefs.diffLayout === "split"}">Split</button>
				<button data-layout="unified" aria-pressed="${prefs.diffLayout === "unified"}">Unified</button>
			</div>
		</div>`;
	if (!res.files.length) doc.insertAdjacentHTML("beforeend", `<div class="dempty">No logic changes in TS/JS files for this range.</div>`);
	for (const f of res.files) doc.append(renderDiffFile(f));
	renderChangedList(res);
	applyPrefs();
	if (keepScroll) $("#reader").scrollTop = scroll;
}

function renderChangedList(res) {
	$("#changed").innerHTML = res.files
		.map((f, i) => `<li><button data-jump="${i}" title="${esc(f.path)}"><span class="stat"><span class="a">+${f.adds}</span> <span class="r">−${f.dels}</span></span> ${esc(f.path.split("/").pop())}</button></li>`)
		.join("") || `<li class="empty">Nothing changed</li>`;
}

function renderDiffFile(f) {
	const sec = document.createElement("section");
	sec.className = "dfile";
	sec.dataset.file = f.path;
	const changed = f.units.filter((u) => u.status !== "unchanged");
	const unchanged = f.units.filter((u) => u.status === "unchanged");
	sec.innerHTML = `
		<div class="dfile-head">
			<svg class="chev" viewBox="0 0 10 10" width="10" height="10"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
			<span class="badge-s ${f.status}">${f.status}</span>
			<span class="p" title="${esc(f.path)}">${f.oldPath && f.oldPath !== f.path ? `<span class="muted">${esc(f.oldPath)}</span> <span class="arrow">→</span> ` : ""}${fileName(f.path)}</span>
			<span class="stat"><span class="a">+${f.adds}</span> <span class="r">−${f.dels}</span></span>
			<button class="icon" data-openfile="${esc(f.path)}" title="Read the full file">↗</button>
		</div>
		<div class="dfile-body"></div>`;
	const body = sec.querySelector(".dfile-body");
	if (!changed.length && f.status === "renamed") body.insertAdjacentHTML("beforeend", `<p class="unchanged-note">Renamed with no logic changes.</p>`);
	for (const u of changed) body.append(u.status === "moved-away" ? renderMovedAway(u) : renderUnit(u));
	if (unchanged.length) {
		const names = unchanged.slice(0, 6).map((u) => `<b>${esc(u.title)}</b>`).join(", ");
		body.insertAdjacentHTML("beforeend", `<p class="unchanged-note">${unchanged.length} unchanged declaration${unchanged.length === 1 ? "" : "s"}: ${names}${unchanged.length > 6 ? `, and ${unchanged.length - 6} more` : ""}</p>`);
	}
	return sec;
}

function renderMovedAway(u) {
	const el = document.createElement("div");
	el.className = "dmoved";
	el.innerHTML = `<span class="badge-s moved-away">moved</span> <b>${esc(u.title)}</b> moved to <button class="link" data-goto-unit="${esc(u.other.path)}::${esc(u.other.title)}">${esc(u.other.path.split("/").pop())}${u.other.title !== u.title ? ` as <b>${esc(u.other.title)}</b>` : ""}</button>`;
	return el;
}

function renderUnit(u) {
	const card = document.createElement("div");
	card.className = "dunit";
	card.dataset.unit = u.title;
	const origin = u.other
		? `<span class="origin">${u.status === "renamed" ? `was <b>${esc(u.other.title)}</b>` : `from ${esc(u.other.path.split("/").pop())}${u.other.title !== u.title ? ` (was <b>${esc(u.other.title)}</b>)` : ""}`}</span>`
		: "";
	const untouched = (u.status === "moved" || u.status === "renamed") && !u.adds && !u.dels;
	card.innerHTML = `<div class="dunit-head"><span class="ttl">${esc(u.title)} ${origin}</span><span class="badge-s ${u.status}">${u.status}</span>${untouched ? `<span class="muted small">body unchanged</span>` : `<span class="stat"><span class="a">+${u.adds}</span> <span class="r">−${u.dels}</span></span>`}</div>`;
	const rows = document.createElement("div");
	const split = prefs.diffLayout === "split" && ["modified", "moved", "renamed"].includes(u.status);
	rows.className = `drows ${split ? "split" : "unified"}`;
	for (const r of u.rows) appendRow(rows, r, split);
	card.append(rows);
	return card;
}

function cellHtml(c, cls, side) {
	if (!c) return `<div class="dcell side-${side} empty"></div>`;
	let html = c.html;
	if (c.kind === "head") {
		const i = html.indexOf(" — ");
		if (i > 0 && html.lastIndexOf("<", i) <= html.lastIndexOf(">", i)) html = `${html.slice(0, i)}<span class="sig">${html.slice(i + 3).replace(/:$/, "")}</span>`;
	}
	const sign = cls === "del" ? "−" : cls === "add" ? "+" : cls === "mod" ? "±" : "";
	return `<div class="dcell side-${side} ${cls} ${c.kind}" style="--d:${c.d}" data-from="${c.from ?? ""}" data-to="${c.to ?? ""}">${sign ? `<span class="sign">${sign}</span>` : ""}${html}</div>`;
}

function appendRow(container, r, split) {
	if (r.kind === "fold") {
		const fold = document.createElement("div");
		fold.className = "dfold";
		fold.textContent = `⋯ ${r.count} unchanged line${r.count === 1 ? "" : "s"} · click to show`;
		fold.addEventListener("click", () => {
			const frag = document.createElement("div");
			for (const h of r.hidden ?? []) appendRow(frag, h, split);
			fold.replaceWith(...frag.childNodes);
		});
		container.append(fold);
		return;
	}
	const L = r.kind === "same" ? "" : r.kind === "add" ? "" : "del";
	const R = r.kind === "same" ? "" : r.kind === "del" ? "" : "add";
	if (split) {
		container.insertAdjacentHTML("beforeend", cellHtml(r.left, L, "l") + cellHtml(r.right, R, "r"));
		return;
	}
	if (r.kind === "same") container.insertAdjacentHTML("beforeend", cellHtml(r.right, "", "u"));
	else if (r.kind === "mod" && r.merged) container.insertAdjacentHTML("beforeend", cellHtml({ ...r.right, html: r.merged }, "mod", "u"));
	else {
		if (r.left) container.insertAdjacentHTML("beforeend", cellHtml(r.left, "del", "u"));
		if (r.right) container.insertAdjacentHTML("beforeend", cellHtml(r.right, "add", "u"));
	}
}

$("#doc").addEventListener("click", (e) => {
	const lay = e.target.closest("[data-layout]");
	if (lay) return setDiffLayout(lay.dataset.layout);
	const of = e.target.closest("[data-openfile]");
	if (of) {
		e.stopPropagation();
		return openFile(of.dataset.openfile);
	}
	const head = e.target.closest(".dfile-head");
	if (head) head.parentElement.classList.toggle("collapsed");
});

$("#doc").addEventListener("click", (e) => {
	const g = e.target.closest("[data-goto-unit]");
	if (!g) return;
	const [path, title] = g.dataset.gotoUnit.split("::");
	const sec = $$(".dfile").find((x) => x.dataset.file === path);
	const card = sec && $$(".dunit", sec).find((x) => x.dataset.unit === title);
	sec?.classList.remove("collapsed");
	(card ?? sec)?.scrollIntoView({ block: "center", behavior: "smooth" });
	if (card) flash(card.querySelector(".dunit-head"));
});

$("#changed").addEventListener("click", (e) => {
	const b = e.target.closest("[data-jump]");
	if (!b) return;
	const sec = $$(".dfile")[Number(b.dataset.jump)];
	sec?.classList.remove("collapsed");
	sec?.scrollIntoView({ block: "start", behavior: "smooth" });
});

/* ---------- boot ---------- */

applyPrefs();
renderRecent();
api("/api/files").then((f) => (state.files = Array.isArray(f) ? f : []));
const params = new URLSearchParams(location.search);
const initialDiff = params.get("commit") ? { commit: params.get("commit") } : params.get("base") && params.get("head") ? { base: params.get("base"), head: params.get("head") } : null;
if (initialDiff) {
	history.replaceState({ diff: initialDiff }, "", location.search);
	openDiff(initialDiff, { push: false });
} else {
const initial = params.get("file") ?? state.recent[0] ?? "server/src/internal/billing/v2/actions/attach/attach.ts";
history.replaceState({ file: initial, line: params.get("line") }, "", `?file=${encodeURIComponent(initial)}${params.get("line") ? `&line=${params.get("line")}` : ""}`);
openFile(initial, { line: Number(params.get("line")) || null, push: false });
}

