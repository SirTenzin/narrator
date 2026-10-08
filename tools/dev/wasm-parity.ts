// The extension parses with oxc's wasm build; this checks it narrates identically to the native parser.
import * as wasm from "@oxc-parser/wasm";
import { createNarrator, renderText } from "@narrate/core";
import { autumn } from "@narrate/example-autumn";
import { typescript } from "@narrate/lang-ts";
import { oxcParser } from "@narrate/lang-ts/oxc";
import { oxcWasmParser } from "@narrate/lang-ts/wasm";
import { en } from "@narrate/locale-en";
import { AUTUMN, corpusFiles } from "./corpus";

const make = (parser: typeof oxcParser) => createNarrator({ languages: [typescript({ parser, plugins: [autumn()] })], locale: en });
const native = make(oxcParser);
const web = make(oxcWasmParser(wasm.parseSync as any));
let same = 0;
const diffs: string[] = [];
for (const f of (await corpusFiles()).filter((_, i) => i % 7 === 0).slice(0, 1500)) {
	const src = await Bun.file(`${AUTUMN}/${f}`).text();
	const a = renderText(native.narrate(src, f).lines);
	const b = renderText(web.narrate(src, f).lines);
	if (a === b) same++;
	else diffs.push(f);
}
console.log({ same, diff: diffs.length }, diffs.slice(0, 5));
