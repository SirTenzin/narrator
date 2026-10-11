import { execFileSync } from "node:child_process";
import { existsSync, globSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ChangedFile } from "@usenarrator/core";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo"]);

const walk = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(path);
		return entry.isFile() ? [path] : [];
	});

/** Files named by paths, directories (recursive) and globs, keeping those `accepts` takes. */
export function expandTargets({ targets, accepts }: { targets: string[]; accepts: (path: string) => boolean }): string[] {
	const files = targets.flatMap((target) => {
		if (existsSync(target)) return (statSync(target).isDirectory() ? walk(target) : [target]).filter(accepts);
		return globSync(target).filter((p) => accepts(p) && !p.split(/[\\/]/).some((seg) => SKIP_DIRS.has(seg)));
	});
	return [...new Set(files)].sort();
}

const git = ({ cwd, args }: { cwd: string; args: string[] }) =>
	execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });

const show = ({ cwd, rev, path }: { cwd: string; rev: string; path: string }) => {
	try {
		return git({ cwd, args: ["show", `${rev}:${path}`] });
	} catch {
		return "";
	}
};

const STATUS: Record<string, ChangedFile["status"]> = { A: "added", D: "deleted", R: "renamed", C: "added" };

/** The files changed between two revisions (`base..head`, or `base` alone for the working tree), with both sides' sources. */
export function changedFiles({ root, range }: { root: string; range: string }): ChangedFile[] {
	const [base, head] = range.includes("...")
		? [git({ cwd: root, args: ["merge-base", ...range.split("...")] }).trim(), range.split("...")[1]]
		: range.split("..");
	if (!base) throw new Error(`Expected <base>..<head>, got "${range}"`);
	const fields = git({ cwd: root, args: ["diff", "--name-status", "-z", "-M", base, ...(head ? [head] : [])] }).split("\0");
	const files: ChangedFile[] = [];
	for (let i = 0; i < fields.length - 1; ) {
		const code = fields[i++]!.charAt(0);
		const twoPaths = code === "R" || code === "C";
		const oldPath = fields[i++]!;
		const path = twoPaths ? fields[i++]! : oldPath;
		const status = STATUS[code] ?? "modified";
		const newSrc = status === "deleted" ? "" : head ? show({ cwd: root, rev: head, path }) : readFileSync(join(root, path), "utf8");
		files.push({
			path,
			oldPath: code === "R" ? oldPath : null,
			status,
			oldSrc: status === "added" ? "" : show({ cwd: root, rev: base, path: oldPath }),
			newSrc,
		});
	}
	return files;
}

export const displayPath = (path: string) => relative(process.cwd(), path) || path;
