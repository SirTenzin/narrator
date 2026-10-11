import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ChangedFile, pathSkipReason, type SkipReason } from "@usenarrator/core";

const git = ({ cwd, args, input }: { cwd: string; args: string[]; input?: string }): Buffer => {
	try {
		return execFileSync("git", args, { cwd, input, maxBuffer: 1 << 30, stdio: ["pipe", "pipe", "pipe"] });
	} catch (e) {
		const stderr = (e as { stderr?: Buffer }).stderr?.toString().trim();
		throw new Error(stderr || `git ${args[0]} failed`);
	}
};

const gitText = (opts: { cwd: string; args: string[]; input?: string }) => git(opts).toString("utf8");

/** Paths that `.gitattributes` marks `linguist-generated` or `linguist-vendored`, with the reason. */
export function gitAttributeSkips({ root, paths }: { root: string; paths: string[] }): Map<string, SkipReason> {
	const skips = new Map<string, SkipReason>();
	if (!paths.length) return skips;
	let out: string;
	try {
		out = gitText({ cwd: root, args: ["check-attr", "-z", "--stdin", "linguist-generated", "linguist-vendored"], input: `${paths.join("\0")}\0` });
	} catch {
		return skips;
	}
	const fields = out.split("\0");
	for (let i = 0; i + 2 < fields.length; i += 3) {
		const [path, attr, value] = [fields[i]!, fields[i + 1]!, fields[i + 2]!];
		if (value === "unspecified" || value === "unset" || value === "false") continue;
		if (!skips.has(path)) skips.set(path, attr === "linguist-vendored" ? "vendored" : "generated");
	}
	return skips;
}

/** Reads many blobs (`rev:path`) through one `git cat-file --batch`; missing ones come back empty. */
function readBlobs({ root, specs }: { root: string; specs: string[] }): string[] {
	if (!specs.length) return [];
	const out = git({ cwd: root, args: ["cat-file", "--batch"], input: `${specs.join("\n")}\n` });
	const blobs: string[] = [];
	let pos = 0;
	for (let i = 0; i < specs.length; i++) {
		const end = out.indexOf(10, pos);
		const header = out.toString("utf8", pos, end);
		pos = end + 1;
		const [, type, size] = header.split(" ");
		if (type !== "blob") {
			blobs.push("");
			continue;
		}
		blobs.push(out.toString("utf8", pos, pos + Number(size)));
		pos += Number(size) + 1;
	}
	return blobs;
}

const isRevision = ({ root, rev }: { root: string; rev: string }) => {
	try {
		git({ cwd: root, args: ["rev-parse", "--verify", "--quiet", `${rev}^{tree}`] });
		return true;
	} catch {
		return false;
	}
};

/** Runs a git command over a range, turning a bad revision into an error that names it. */
const overRange = ({ root, range, revs, args }: { root: string; range: string; revs: string[]; args: string[] }) => {
	try {
		return gitText({ cwd: root, args });
	} catch (e) {
		const bad = revs.find((rev) => !isRevision({ root, rev }));
		throw bad ? new Error(`Unknown git revision "${bad}" in "${range}"`) : e;
	}
};

const STATUS: Record<string, ChangedFile["status"]> = { A: "added", D: "deleted", R: "renamed", C: "added" };

/**
 * The files changed in a git range (`base..head`, `base...head`, or `base` alone for the working tree), with both sides' sources.
 * Generated, vendored and build files come back with `skipped` set and no sources, unless `includeGenerated`.
 * `accepts` drops other paths before any source is read, e.g. `narrator.canNarrate`.
 */
export function changedFilesFromGit({
	root,
	range,
	includeGenerated = false,
	accepts = () => true,
}: {
	root: string;
	range: string;
	includeGenerated?: boolean;
	accepts?: (path: string) => boolean;
}): ChangedFile[] {
	const threeDot = range.includes("...");
	const [from, head] = threeDot ? range.split("...") : range.split("..");
	if (!from) throw new Error(`Expected <base>..<head>, got "${range}"`);
	const revs = head ? [from, head] : [from];
	const base = threeDot ? overRange({ root, range, revs, args: ["merge-base", from, head || "HEAD"] }).trim() : from;
	const fields = overRange({ root, range, revs, args: ["diff", "--name-status", "-z", "-M", base, ...(head ? [head] : [])] }).split("\0");

	const entries: { path: string; oldPath: string; status: ChangedFile["status"]; renamed: boolean }[] = [];
	for (let i = 0; i < fields.length - 1; ) {
		const code = fields[i++]!.charAt(0);
		const oldPath = fields[i++]!;
		const path = code === "R" || code === "C" ? fields[i++]! : oldPath;
		if (accepts(path)) entries.push({ path, oldPath, status: STATUS[code] ?? "modified", renamed: code === "R" });
	}

	const attributeSkips = includeGenerated ? new Map<string, SkipReason>() : gitAttributeSkips({ root, paths: entries.map((e) => e.path) });
	const skipOf = (path: string) => (includeGenerated ? null : (attributeSkips.get(path) ?? pathSkipReason(path)));
	const wanted = entries.filter((e) => !skipOf(e.path));
	const oldSpecs = wanted.filter((e) => e.status !== "added").map((e) => `${base}:${e.oldPath}`);
	const newSpecs = head ? wanted.filter((e) => e.status !== "deleted").map((e) => `${head}:${e.path}`) : [];
	const blobs = readBlobs({ root, specs: [...oldSpecs, ...newSpecs] });
	const oldBlobs = blobs.slice(0, oldSpecs.length);
	const newBlobs = blobs.slice(oldSpecs.length);
	const readWorkingTree = (path: string) => {
		try {
			return readFileSync(join(root, path), "utf8");
		} catch {
			return "";
		}
	};

	return entries.map((e): ChangedFile => {
		const oldPath = e.renamed ? e.oldPath : null;
		const skipped = skipOf(e.path);
		if (skipped) return { path: e.path, oldPath, status: e.status, oldSrc: "", newSrc: "", skipped };
		const oldSrc = e.status === "added" ? "" : oldBlobs.shift()!;
		const newSrc = e.status === "deleted" ? "" : head ? newBlobs.shift()! : readWorkingTree(e.path);
		return { path: e.path, oldPath, status: e.status, oldSrc, newSrc };
	});
}
