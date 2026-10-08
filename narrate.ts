import { parseSync } from "oxc-parser";
import { Engine, renderText } from "./src/engine";
import { setParser } from "./src/parser";

setParser((filename, src) => parseSync(filename, src) as any);
import { toAnsi } from "./src/markup";
import { createEngine } from "./src/createEngine";

export { createEngine };

if (import.meta.main) {
	const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
	const src = file ? await Bun.file(file).text() : await Bun.stdin.text();
	const { lines } = createEngine().narrate(src, file ?? "stdin.ts");
	console.log(renderText(lines, process.argv.includes("--plain") ? undefined : toAnsi));
}
