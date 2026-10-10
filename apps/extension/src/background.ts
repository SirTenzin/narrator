import { type ChangedFile, createNarrator, type FileJson, type Narrator } from "@usenarrator/core";
import { autumn } from "@usenarrator/example-autumn";
import { typescript } from "@usenarrator/lang-ts";
import { oxcWasmParser } from "@usenarrator/lang-ts/wasm";
import { en } from "@usenarrator/locale-en";
import { betterAuth } from "@usenarrator/plugin-better-auth";
import { effect } from "@usenarrator/plugin-effect";
import { testing } from "@usenarrator/plugin-testing";
import { aiSdk } from "@usenarrator/plugin-ai-sdk";
import { elysia } from "@usenarrator/plugin-elysia";
import { hono } from "@usenarrator/plugin-hono";
import { zod } from "@usenarrator/plugin-zod";
import initWasm, { parseSync } from "@oxc-parser/wasm/web/oxc_parser_wasm.js";

export type DiffRequest = { kind: "pull"; owner: string; repo: string; number: string } | { kind: "commit"; owner: string; repo: string; sha: string };
export type DiffReport = { title: string; subtitle: string; url: string; base: string; head: string; skipped: number; files: FileJson[] };
export type DiffResponse = { ok: true; report: DiffReport } | { ok: false; error: string };
export type Progress = { type: "progress"; text: string };

const parser = oxcWasmParser((src, opts) => parseSync(src, { ...opts, sourceFilename: opts.sourceFilename.replace(/\.(m|c)?js$/, ".ts") }));
const narrator: Narrator = createNarrator({ languages: [typescript({ parser, plugins: [zod(), testing(), effect(), betterAuth(), hono(), elysia(), aiSdk(), autumn()] })], locale: en });

let parserReady: Promise<unknown> | null = null;
const ensureParser = () => (parserReady ??= initWasm({ module_or_path: chrome.runtime.getURL("oxc_parser_wasm_bg.wasm") }));

const getToken = async (): Promise<string | null> => ((await chrome.storage.local.get("githubToken")).githubToken as string | undefined) ?? null;

async function gh<T>(path: string): Promise<T> {
	const token = await getToken();
	const res = await fetch(`https://api.github.com${path}`, {
		headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
	});
	if (res.ok) return res.json() as Promise<T>;
	const remaining = res.headers.get("x-ratelimit-remaining");
	if (res.status === 403 && remaining === "0") {
		const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
		const mins = Math.max(1, Math.round((reset - Date.now()) / 60000));
		throw new Error(`GitHub's anonymous rate limit (60 requests/hour) is used up. It resets in about ${mins} min.`);
	}
	if (res.status === 404) throw new Error("GitHub returned 404. Private repositories need a token, which logged-out mode doesn't have yet.");
	throw new Error(`GitHub API ${res.status} for ${path}`);
}

async function raw(owner: string, repo: string, sha: string, path: string): Promise<string> {
	const url = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Couldn't fetch ${path} at ${sha.slice(0, 7)} (${res.status})`);
	return res.text();
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i]!);
			}
		}),
	);
	return out;
}

type GhFile = { filename: string; previous_filename?: string; status: string };

const STATUS: Record<string, ChangedFile["status"]> = {
	added: "added",
	removed: "deleted",
	renamed: "renamed",
	modified: "modified",
	changed: "modified",
	copied: "added",
};

const cache = new Map<string, DiffReport>();

async function buildReport(req: DiffRequest, progress: (t: string) => void): Promise<DiffReport> {
	const { owner, repo } = req;
	let base: string;
	let head: string;
	let files: GhFile[];
	let title: string;
	let subtitle: string;
	let url: string;
	if (req.kind === "pull") {
		progress("Asking GitHub for the pull request…");
		const pr = await gh<any>(`/repos/${owner}/${repo}/pulls/${req.number}`);
		const key = `pull:${owner}/${repo}#${req.number}@${pr.head.sha}`;
		if (cache.has(key)) return cache.get(key)!;
		const cmp = await gh<any>(`/repos/${owner}/${repo}/compare/${pr.base.sha}...${pr.head.sha}`);
		base = cmp.merge_base_commit.sha;
		head = pr.head.sha;
		files = cmp.files ?? [];
		title = pr.title;
		subtitle = `#${req.number} · ${pr.user?.login ?? ""} · ${pr.base.ref} ← ${pr.head.ref}`;
		url = pr.html_url;
	} else {
		const key = `commit:${owner}/${repo}@${req.sha}`;
		if (cache.has(key)) return cache.get(key)!;
		progress("Asking GitHub for the commit…");
		const c = await gh<any>(`/repos/${owner}/${repo}/commits/${req.sha}`);
		base = c.parents?.[0]?.sha;
		head = c.sha;
		files = c.files ?? [];
		title = String(c.commit?.message ?? "").split("\n")[0]!;
		subtitle = `${c.sha.slice(0, 7)} · ${c.commit?.author?.name ?? ""}`;
		url = c.html_url;
	}
	const narratable = files.filter((f) => narrator.canNarrate(f.filename) || (f.previous_filename && narrator.canNarrate(f.previous_filename)));
	let fetched = 0;
	progress(`Fetching ${narratable.length} file${narratable.length === 1 ? "" : "s"}…`);
	const changed = await mapLimit(narratable, 8, async (f): Promise<ChangedFile> => {
		const status = STATUS[f.status] ?? "modified";
		const oldPath = status === "added" ? null : (f.previous_filename ?? f.filename);
		const [oldSrc, newSrc] = await Promise.all([
			oldPath && base ? raw(owner, repo, base, oldPath).catch(() => "") : "",
			status === "deleted" ? "" : raw(owner, repo, head, f.filename).catch(() => ""),
		]);
		progress(`Fetched ${++fetched} of ${narratable.length} files…`);
		return { path: f.filename, oldPath, status, oldSrc, newSrc };
	});
	progress("Narrating both sides…");
	await ensureParser();
	const report: DiffReport = {
		title,
		subtitle,
		url,
		base,
		head,
		skipped: files.length - narratable.length,
		files: narrator.diff(changed),
	};
	cache.set(req.kind === "pull" ? `pull:${owner}/${repo}#${req.number}@${head}` : `commit:${owner}/${repo}@${req.sha}`, report);
	return report;
}

chrome.runtime.onConnect.addListener((port) => {
	if (port.name !== "plain-english") return;
	port.onMessage.addListener(async (req: DiffRequest) => {
		try {
			const report = await buildReport(req, (text) => port.postMessage({ type: "progress", text } satisfies Progress));
			port.postMessage({ type: "done", ok: true, report });
		} catch (err) {
			port.postMessage({ type: "done", ok: false, error: err instanceof Error ? err.message : String(err) });
		}
	});
});
