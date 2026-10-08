import { Glob } from "bun";
import { parseSync as nativeParse } from "oxc-parser";
import * as wasm from "@oxc-parser/wasm";
import { Engine, renderText } from "./src/engine";
import { setParser } from "./src/parser";
import { common } from "./src/dialects/common";
import { autumn } from "./src/dialects/autumn";

const wasmParser = (filename: string, src: string) => {
	const r: any = wasm.parseSync(src, { sourceFilename: filename, sourceType: "module" });
	return { program: JSON.parse(r.programJson), comments: r.comments, errors: r.errors };
};
const root = "/workspace/autumn";
const files: string[] = [];
for await (const f of new Glob("{server,shared,vite}/**/*.{ts,tsx}").scan({ cwd: root })) files.push(f);
const sample = files.filter((_, i) => i % 7 === 0).slice(0, 1500);
let same = 0, diff = 0, crash = 0; const examples: string[] = [];
for (const f of sample) {
	const src = await Bun.file(`${root}/${f}`).text();
	setParser((fn, s) => nativeParse(fn, s) as any);
	const a = renderText(new Engine([common, autumn]).narrate(src, f).lines);
	setParser(wasmParser);
	let b = "";
	try { b = renderText(new Engine([common, autumn]).narrate(src, f).lines); } catch (e) { crash++; if (examples.length < 3) examples.push(`${f}: ${e}`); continue; }
	if (a === b) same++; else { diff++; if (examples.length < 6) { const al = a.split("\n"), bl = b.split("\n"); const i = al.findIndex((x, k) => x !== bl[k]); examples.push(`${f}\n  native: ${al[i]}\n  wasm:   ${bl[i]}`); } }
}
console.log({ same, diff, crash }); console.log(examples.join("\n"));
