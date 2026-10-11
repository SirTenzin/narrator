import { existsSync, globSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathSkipReason } from "@usenarrator/core";

/** Files under `root`; `keep` sees root-relative paths, with a trailing slash for directories. */
const walk = ({ root, keep, dir = "" }: { root: string; keep: (rel: string) => boolean; dir?: string }): string[] =>
	readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
		const rel = dir ? `${dir}/${entry.name}` : entry.name;
		if (entry.name === ".git") return [];
		if (entry.isDirectory()) return keep(`${rel}/`) ? walk({ root, keep, dir: rel }) : [];
		return entry.isFile() && keep(rel) ? [join(root, rel)] : [];
	});

/** The part of a glob before its first wildcard segment, so skip rules only look at what the glob matched. */
const globBase = (pattern: string) => {
	const segments = pattern.split(/[\\/]/);
	const firstWild = segments.findIndex((s) => /[*?[\]{}]/.test(s));
	return segments.slice(0, firstWild === -1 ? segments.length : firstWild).join("/") || ".";
};

/**
 * Files named by paths, directories (recursive) and globs, keeping those `accepts` takes.
 * Inside directories and globs, build and vendored paths are skipped unless `includeGenerated` (dependencies always are); a file named directly is always kept.
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
	const files = targets.flatMap((target) => {
		if (existsSync(target) && !statSync(target).isDirectory()) return accepts(target) ? [target] : [];
		if (existsSync(target)) return walk({ root: target, keep: handWritten }).filter(accepts);
		const base = globBase(target);
		return globSync(target).filter((p) => accepts(p) && handWritten(relative(base, p)));
	});
	return [...new Set(files)].sort();
}

export const displayPath = (path: string) => relative(process.cwd(), path) || path;
