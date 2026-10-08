import { $ } from "bun";
import { createEngine } from "./narrate";
import { buildDiffReport, type ChangedFile, isNarratable } from "./src/diffReport";

const root = "/workspace/autumn";
const out: Record<string, unknown> = {};
for (const sha of ["a501dccf64", "239cb7db38", "e594622f75", "c236af373b"]) {
	const ns = (await $`git -C ${root} diff --name-status -M ${sha}^ ${sha}`.text()).trim().split("\n");
	const files: ChangedFile[] = [];
	for (const row of ns) {
		const [st, a, b] = row.split("\t") as [string, string, string?];
		const path = b ?? a;
		if (!isNarratable(path)) continue;
		const oldPath = st.startsWith("R") ? a : null;
		const show = async (rev: string, p: string) => (await $`git -C ${root} show ${rev}:${p}`.quiet().nothrow()).stdout.toString();
		const status = st.startsWith("A") ? "added" : st.startsWith("D") ? "deleted" : st.startsWith("R") ? "renamed" : "modified";
		files.push({ path, oldPath, status, oldSrc: status === "added" ? "" : await show(`${sha}^`, oldPath ?? a), newSrc: status === "deleted" ? "" : await show(sha, path) });
	}
	out[sha] = buildDiffReport({ files, engineFor: () => createEngine(), resolve: () => null });
}
const dest = process.argv[2] ?? `${process.env.HOME}/.capy/work/narrate-golden/diffs.json`;
await Bun.write(dest, JSON.stringify(out));
console.log("wrote", dest, JSON.stringify(out).length);
