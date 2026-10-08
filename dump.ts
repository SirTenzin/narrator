import { Glob } from "bun";
import { createEngine } from "./narrate";
import { renderText } from "./src/engine";
const root = "/workspace/autumn";
const out = `${process.env.HOME}/.capy/work/ast-english/corpus`;
const glob = new Glob("{server,shared}/**/*.ts");
let all = "";
for await (const f of glob.scan({ cwd: root })) {
	if (f.includes("node_modules") || f.includes("/tests/") || f.startsWith("server/tests")) continue;
	const { lines } = createEngine().narrate(await Bun.file(`${root}/${f}`).text(), f);
	all += `\n##### ${f}\n${renderText(lines)}\n`;
}
await Bun.write(`${out}/all.txt`, all);
