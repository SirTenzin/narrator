import { Glob } from "bun";
import { createEngine } from "./narrate";
import { renderText } from "./src/engine";

const root = process.argv[2] ?? "/workspace/autumn";
const glob = new Glob("{server,shared,vite,apps,packages,scripts}/**/*.{ts,tsx}");
const files: string[] = [];
for await (const f of glob.scan({ cwd: root, onlyFiles: true })) if (!f.includes("node_modules") && !f.endsWith(".d.ts")) files.push(f);
let crashes: { f: string; err: string }[] = [];
let totals = { files: 0, nodes: 0, fallbacks: 0, lines: 0, rawLines: 0, srcLines: 0, ms: 0 };
const ft: Record<string, number> = {};
const t0 = performance.now();
for (const f of files) {
	const src = await Bun.file(`${root}/${f}`).text();
	const e = createEngine();
	try {
		const { lines } = e.narrate(src, f);
		totals.files++;
		totals.nodes += e.stats.nodes;
		totals.fallbacks += e.stats.fallbacks;
		totals.lines += lines.length;
		totals.rawLines += lines.filter((l) => l.kind === "raw").length;
		totals.srcLines += src.split("\n").length;
		for (const [k, v] of Object.entries(e.stats.fallbackTypes)) ft[k] = (ft[k] ?? 0) + v;
		renderText(lines);
	} catch (err: any) {
		crashes.push({ f, err: String(err?.stack ?? err).split("\n").slice(0, 3).join(" | ") });
	}
}
totals.ms = Math.round(performance.now() - t0);
console.log(JSON.stringify({ ...totals, crashes: crashes.length, fallbackRate: (totals.fallbacks / totals.nodes).toFixed(4) }, null, 1));
console.log(Object.entries(ft).sort((a, b) => b[1] - a[1]).slice(0, 25));
const byErr: Record<string, string[]> = {};
for (const c of crashes) (byErr[c.err.slice(0, 160)] ??= []).push(c.f);
for (const [k, v] of Object.entries(byErr).sort((a, b) => b[1].length - a[1].length).slice(0, 10)) console.log(v.length, k, v[0]);
