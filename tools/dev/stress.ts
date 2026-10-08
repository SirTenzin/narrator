import { narrator } from "@narrate/cli";
import { renderText } from "@narrate/core";
import { corpusFiles } from "./corpus";

const root = process.argv[2] ?? "/workspace/autumn";
const crashes: { f: string; err: string }[] = [];
const totals = { files: 0, nodes: 0, fallbacks: 0, lines: 0, rawLines: 0, srcLines: 0, ms: 0 };
const ft: Record<string, number> = {};
const t0 = performance.now();
for (const f of await corpusFiles(root)) {
	const src = await Bun.file(`${root}/${f}`).text();
	try {
		const { lines, stats } = narrator.narrate(src, f);
		totals.files++;
		totals.nodes += stats.nodes;
		totals.fallbacks += stats.fallbacks;
		totals.lines += lines.length;
		totals.rawLines += lines.filter((l) => l.kind === "raw").length;
		totals.srcLines += src.split("\n").length;
		for (const [k, v] of Object.entries(stats.fallbackTypes)) ft[k] = (ft[k] ?? 0) + v;
		renderText(lines);
	} catch (err: any) {
		crashes.push({
			f,
			err: String(err?.stack ?? err)
				.split("\n")
				.slice(0, 3)
				.join(" | "),
		});
	}
}
totals.ms = Math.round(performance.now() - t0);
const top = Object.entries(ft)
	.sort((a, b) => b[1] - a[1])
	.slice(0, 15);
console.log(
	JSON.stringify({ ...totals, crashes: crashes.length, fallbackRate: +(totals.fallbacks / Math.max(1, totals.nodes)).toFixed(4), topFallbacks: top }, null, 1),
);
for (const c of crashes.slice(0, 10)) console.log(c.f, c.err);
