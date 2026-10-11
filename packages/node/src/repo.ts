import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createDependencyIndex, type DependencyIndex, defaultManifestReaders, type ManifestReader } from "@usenarrator/core";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "target", ".venv", "venv", "vendor"]);

const hasManifest = (dir: string, readers: ManifestReader[]) => {
	try {
		return readdirSync(dir).some((name) => readers.some((r) => r.matches(name)));
	} catch {
		return false;
	}
};

/** The enclosing git checkout of `dir`; outside git, its outermost ancestor holding a manifest, else `dir` itself. */
export function findRepoRoot(dir: string, readers: ManifestReader[] = defaultManifestReaders): string {
	let outermost = resolve(dir);
	for (let d = resolve(dir); ; d = dirname(d)) {
		if (existsSync(join(d, ".git"))) return d;
		if (hasManifest(d, readers)) outermost = d;
		if (dirname(d) === d) return outermost;
	}
}

// Outside git the root may be any directory (even $HOME), so the fallback walk stays shallow.
const MAX_WALK_DEPTH = 4;

const entries = (path: string) => {
	try {
		return readdirSync(path, { withFileTypes: true });
	} catch {
		return [];
	}
};

const walk = (root: string, dir = "", depth = 0): string[] =>
	entries(join(root, dir)).flatMap((entry) => {
		const rel = dir ? `${dir}/${entry.name}` : entry.name;
		if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) || entry.name.startsWith(".") || depth >= MAX_WALK_DEPTH ? [] : walk(root, rel, depth + 1);
		return entry.isFile() ? [rel] : [];
	});

/** Every file in a repo, relative to its root: `git ls-files` when possible (respects .gitignore), else a shallow directory walk. */
export function listRepoFiles(root: string): string[] {
	try {
		const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
			cwd: root,
			encoding: "utf8",
			maxBuffer: 1 << 28,
			stdio: ["ignore", "pipe", "ignore"],
		});
		return out.split("\0").filter(Boolean);
	} catch {
		return walk(root);
	}
}

/** A dependency index over a repo's manifests; file paths may be absolute or relative to `root`. */
export function loadDependencyIndex({ root, readers = defaultManifestReaders }: { root: string; readers?: ManifestReader[] }): DependencyIndex {
	let index: DependencyIndex | null = null;
	const load = () => {
		if (index) return index;
		const paths = createDependencyIndex({ manifests: new Map(), readers }).manifestPaths(listRepoFiles(root));
		const manifests = new Map<string, string>();
		for (const p of paths) {
			try {
				manifests.set(p, readFileSync(join(root, p), "utf8"));
			} catch {}
		}
		index = createDependencyIndex({ manifests, readers });
		return index;
	};
	const toRepoPath = (path: string) => relative(root, resolve(root, path)).split("\\").join("/");
	return {
		manifestPaths: (paths) => load().manifestPaths(paths),
		forFile: (path, ecosystem) => load().forFile(toRepoPath(path), ecosystem),
	};
}
