import { execFileSync } from "node:child_process";
import { existsSync, globSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathSkipReason } from "@usenarrator/core";

/** Files under `root`; `keep` sees root-relative paths, with a trailing slash for directories. */
const walk = ({ root, keep, dir = "" }: { root: string; keep: (rel: string) => boolean; dir?: string }): string[] =>
	readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
		const rel = dir ? `${dir}/${entry.name}` : entry.name;
		if (entry.name === ".git") return [];
		if (entry.isDirectory()) return keep(`${rel}/`) ? walk({ root, keep, dir: rel }) : [];
		return entry.isFile() && keep(rel) ? [join(root, rel)] : [];
	});

/** Paths git would ignore (.gitignore, .git/info/exclude, global excludes, negations included); none outside a repo. */
function gitIgnored(paths: string[]): Set<string> {
	if (!paths.length) return new Set();
	try {
		const cwd = dirname(resolve(paths[0]!));
		const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		const abs = paths.map((p) => resolve(p));
		let out = "";
		try {
			out = execFileSync("git", ["check-ignore", "--no-index", "-z", "--stdin"], { cwd: root, input: abs.join("\0"), encoding: "utf8", maxBuffer: 1 << 28, stdio: ["pipe", "pipe", "ignore"] });
		} catch (e: any) {
			// check-ignore exits 1 when nothing is ignored.
			out = e?.status === 1 ? "" : String(e?.stdout ?? "");
		}
		const ignored = new Set(out.split("\0").filter(Boolean).map((p) => resolve(root, p)));
		return new Set(paths.filter((p) => ignored.has(resolve(p))));
	} catch {
		return new Set();
	}
}

/** The part of a glob before its first wildcard segment, so skip rules only look at what the glob matched. */
const globBase = (pattern: string) => {
	const segments = pattern.split(/[\\/]/);
	const firstWild = segments.findIndex((s) => /[*?[\]{}]/.test(s));
	return segments.slice(0, firstWild === -1 ? segments.length : firstWild).join("/") || ".";
};

/**
 * Files named by paths, directories (recursive) and globs, keeping those `accepts` takes.
 * Inside directories and globs, git-ignored, build and vendored paths are skipped unless `includeGenerated` (dependencies always are); a file named directly is always kept.
 */
export function expandTargets({
	targets,
	accepts,
	includeGenerated = false,
}: {
	targets: string[];
	accepts: (path: string) => boolean;
	includeGenerated?: boolean;
}): string[] {
	const handWritten = (rel: string) => {
		const reason = pathSkipReason(rel);
		return !reason || (includeGenerated && reason !== "dependency");
	};
	const withoutIgnored = (paths: string[]) => {
		if (includeGenerated) return paths;
		const ignored = gitIgnored(paths);
		return paths.filter((p) => !ignored.has(p));
	};
	const files = targets.flatMap((target) => {
		if (existsSync(target) && !statSync(target).isDirectory()) return accepts(target) ? [target] : [];
		if (existsSync(target)) return withoutIgnored(walk({ root: target, keep: handWritten }).filter(accepts));
		const base = globBase(target);
		return withoutIgnored(globSync(target).filter((p) => accepts(p) && handWritten(relative(base, p))));
	});
	return [...new Set(files)].sort();
}

export const displayPath = (path: string) => relative(process.cwd(), path) || path;
