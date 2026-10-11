import { type ChangedFile, createDependencyIndex } from "@usenarrator/core";
import { ancestorDirs } from "./deps";
import type { DiffReport, DiffRequest, RequestCount } from "./protocol";

export type GitHub = {
	api: <T>(path: string) => Promise<T>;
	raw: (p: { owner: string; repo: string; sha: string; path: string }) => Promise<string | null>;
	count: RequestCount;
};

/** A GitHub client that counts its requests; `raw` returns null for files that don't exist at that commit. */
export function github({ token }: { token: string }): GitHub {
	const count: RequestCount = { api: 0, raw: 0 };
	const api = async <T>(path: string): Promise<T> => {
		count.api++;
		const res = await fetch(`https://api.github.com${path}`, {
			headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		});
		if (res.ok) return res.json() as Promise<T>;
		if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
			const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
			const mins = Math.max(1, Math.round((reset - Date.now()) / 60000));
			const limit = token ? "GitHub's rate limit for your token" : "GitHub's anonymous rate limit (60 requests an hour)";
			throw new Error(`${limit} is used up. It resets in about ${mins} min.${token ? "" : " A token in Narrator's options raises it to 5,000."}`);
		}
		if (res.status === 401) throw new Error("GitHub rejected the token saved in Narrator's options. Check it hasn't expired.");
		if (res.status === 404)
			throw new Error(
				token
					? "GitHub returned 404. The token in Narrator's options may not have access to this repository."
					: "GitHub returned 404. Private repositories need a token: add one in Narrator's options.",
			);
		throw new Error(`GitHub API ${res.status} for ${path}`);
	};
	const raw: GitHub["raw"] = async ({ owner, repo, sha, path }) => {
		count.raw++;
		const url = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
		// raw.githubusercontent.com serves private repos only with a token; public ones never need it.
		const res = await fetch(url, token ? { headers: { Authorization: `token ${token}` } } : undefined);
		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`Couldn't fetch ${path} at ${sha.slice(0, 7)} (${res.status})`);
		return res.text();
	};
	return { api, raw, count };
}

export async function mapLimit<T, R>({ items, limit, fn }: { items: T[]; limit: number; fn: (x: T) => Promise<R> }): Promise<R[]> {
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

const NARRATABLE = /\.(m|c)?[tj]sx?$/;
const narratable = (p: string | undefined) => !!p && NARRATABLE.test(p) && !p.endsWith(".d.ts");

const STATUS: Record<string, ChangedFile["status"]> = {
	added: "added",
	removed: "deleted",
	renamed: "renamed",
	modified: "modified",
	changed: "modified",
	copied: "added",
};

type GhFile = { filename: string; previous_filename?: string; status: string };
export type Change = { title: string; subtitle: string; url: string; base: string; head: string; files: GhFile[] };

/** The pull request or commit: its title, the commits to compare, and the changed files; a cached report skips the rest. */
export async function loadChange({
	gh,
	req,
	cached,
}: {
	gh: GitHub;
	req: DiffRequest;
	cached: (head: string) => DiffReport | undefined;
}): Promise<{ report: DiffReport } | { change: Change }> {
	const { owner, repo } = req;
	if (req.kind === "commit") {
		const report = cached(req.sha);
		if (report) return { report };
	}
	if (req.kind === "pull") {
		const pr = await gh.api<any>(`/repos/${owner}/${repo}/pulls/${req.number}`);
		const report = cached(pr.head.sha);
		if (report) return { report };
		const cmp = await gh.api<any>(`/repos/${owner}/${repo}/compare/${pr.base.sha}...${pr.head.sha}`);
		return {
			change: {
				title: pr.title,
				subtitle: `#${req.number} · ${pr.user?.login ?? ""} · ${pr.base.ref} ← ${pr.head.ref}`,
				url: pr.html_url,
				base: cmp.merge_base_commit.sha,
				head: pr.head.sha,
				files: cmp.files ?? [],
			},
		};
	}
	const c = await gh.api<any>(`/repos/${owner}/${repo}/commits/${req.sha}`);
	return {
		change: {
			title: String(c.commit?.message ?? "").split("\n")[0]!,
			subtitle: `${c.sha.slice(0, 7)} · ${c.commit?.author?.name ?? ""}`,
			url: c.html_url,
			base: c.parents?.[0]?.sha,
			head: c.sha,
			files: c.files ?? [],
		},
	};
}

export const narratableFiles = (files: GhFile[]) => files.filter((f) => narratable(f.filename) || narratable(f.previous_filename));

/** Both sides of each narratable file, fetched from raw.githubusercontent.com. */
export function fetchSources({
	gh,
	owner,
	repo,
	change,
	files,
	progress,
}: {
	gh: GitHub;
	owner: string;
	repo: string;
	change: Change;
	files: GhFile[];
	progress: (t: string) => void;
}): Promise<ChangedFile[]> {
	let fetched = 0;
	return mapLimit({
		items: files,
		limit: 8,
		fn: async (f): Promise<ChangedFile> => {
			const status = STATUS[f.status] ?? "modified";
			const oldPath = status === "added" ? null : (f.previous_filename ?? f.filename);
			const side = (sha: string, path: string) =>
				gh.raw({ owner, repo, sha, path }).then(
					(s) => s ?? "",
					() => "",
				);
			const [oldSrc, newSrc] = await Promise.all([
				oldPath && change.base ? side(change.base, oldPath) : "",
				status === "deleted" ? "" : side(change.head, f.filename),
			]);
			progress(`Fetched ${++fetched} of ${files.length} files…`);
			return { path: f.filename, oldPath, status, oldSrc, newSrc };
		},
	});
}

const manifestMemo = new Map<string, [string, string][]>();

/** Manifest file names to probe when the tree listing is truncated; one per reader the index knows. */
const MANIFEST_NAMES = ["package.json"];

/** The dependency manifests that can apply to the changed files (theirs or an ancestor directory's): one tree call, then raw fetches. */
export async function fetchManifests({
	gh,
	owner,
	repo,
	sha,
	paths,
}: {
	gh: GitHub;
	owner: string;
	repo: string;
	sha: string;
	paths: string[];
}): Promise<[string, string][]> {
	const key = `manifests:${owner}/${repo}@${sha}:${paths.join("\n")}`;
	const cached = manifestMemo.get(key) ?? ((await chrome.storage.session?.get(key).catch(() => undefined))?.[key] as [string, string][] | undefined);
	if (cached) return cached;

	const index = createDependencyIndex({ manifests: new Map() });
	const dirs = new Set(paths.flatMap(ancestorDirs));
	const inChangedDirs = (p: string) => dirs.has(p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
	const tree = await gh
		.api<{ tree: { path: string; type: string }[]; truncated: boolean }>(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`)
		.catch(() => null);
	const listed = tree && !tree.truncated ? tree.tree.filter((t) => t.type === "blob").map((t) => t.path) : null;
	const candidates = listed ?? [...dirs].flatMap((d) => MANIFEST_NAMES.map((n) => (d ? `${d}/${n}` : n)));
	const wanted = index.manifestPaths(candidates).filter(inChangedDirs);

	const texts = await mapLimit({ items: wanted, limit: 8, fn: (path) => gh.raw({ owner, repo, sha, path }).catch(() => null) });
	const result = wanted.flatMap((path, i): [string, string][] => (texts[i] ? [[path, texts[i]!]] : []));
	manifestMemo.set(key, result);
	await chrome.storage.session?.set({ [key]: result }).catch(() => {});
	return result;
}
