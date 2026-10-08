import { Glob } from "bun";
import { createEngine } from "./narrate";

const root = "/workspace/autumn";
const files: string[] = [];
for await (const f of new Glob("{server,shared,vite,apps,packages,scripts}/**/*.{ts,tsx}").scan({ cwd: root, onlyFiles: true })) if (!f.includes("node_modules") && !f.endsWith(".d.ts")) files.push(f);
files.sort();
const out: string[] = [];
for (const f of files) {
	const src = await Bun.file(`${root}/${f}`).text();
	try {
		const { lines } = createEngine().narrate(src, f);
		out.push(JSON.stringify({ f, lines: lines.map((l) => [l.d, l.kind, l.start, l.end, l.text]) }));
	} catch (e) {
		out.push(JSON.stringify({ f, error: String(e) }));
	}
}
await Bun.write(`${process.env.HOME}/.capy/work/narrate-golden/golden.jsonl.gz`, Bun.gzipSync(new TextEncoder().encode(out.join("\n"))));
console.log(files.length, "files");
