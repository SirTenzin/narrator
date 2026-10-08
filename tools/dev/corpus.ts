import type { ChangedFile } from "@narrate/core";
import { $, Glob } from "bun";

export const AUTUMN = process.env.AUTUMN_ROOT ?? "/workspace/autumn";
export const GOLDEN = `${process.env.HOME}/.capy/work/narrate-golden`;
export const TEST_COMMITS = ["a501dccf64", "239cb7db38", "e594622f75", "c236af373b"];

export async function corpusFiles(root = AUTUMN): Promise<string[]> {
	const files: string[] = [];
	for await (const f of new Glob("{server,shared,vite,apps,packages,scripts}/**/*.{ts,tsx}").scan({ cwd: root, onlyFiles: true }))
		if (!f.includes("node_modules") && !f.endsWith(".d.ts")) files.push(f);
	return files.sort();
}

export async function commitFiles(sha: string, root = AUTUMN): Promise<ChangedFile[]> {
	const rows = (await $`git -C ${root} diff --name-status -M ${sha}^ ${sha}`.text()).trim().split("\n");
	const show = async (rev: string, p: string) => (await $`git -C ${root} show ${rev}:${p}`.quiet().nothrow()).stdout.toString();
	const files: ChangedFile[] = [];
	for (const row of rows) {
		const [st, a, b] = row.split("\t") as [string, string, string?];
		const path = b ?? a;
		const oldPath = st.startsWith("R") ? a : null;
		const status = st.startsWith("A") ? "added" : st.startsWith("D") ? "deleted" : st.startsWith("R") ? "renamed" : "modified";
		files.push({
			path,
			oldPath,
			status,
			oldSrc: status === "added" ? "" : await show(`${sha}^`, oldPath ?? a),
			newSrc: status === "deleted" ? "" : await show(sha, path),
		});
	}
	return files;
}
