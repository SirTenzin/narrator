// Checks that the WASM parser (browsers, workers, the extension) gives the same AST and English as the native one.
// Usage: bun tools/dev/wasm-parity.ts [--every=N] (default: every file of the corpus).

import { createNarrator, renderText } from "@usenarrator/core";
import { autumn } from "@usenarrator/example-autumn";
import { typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { createWasmParser } from "@usenarrator/lang-ts/wasm";
import { en } from "@usenarrator/locale-en";
import { AUTUMN, corpusFiles } from "./corpus";

const every = Number(process.argv.find((a) => a.startsWith("--every="))?.slice(8) ?? 1);

// Syntax the corpus may not cover, so a version skew between the two builds shows up here.
const SYNTAX: [string, string][] = [
	["bigint.ts", "const a = 10n ** 3n; const b = 0x1fn;"],
	["regex.ts", "const r = /a(?<n>b)+/giv; s.replace(/x/g, '');"],
	["using.ts", "{ using f = open(); await using g = conn(); }"],
	["decorators.ts", "@Component({}) class A { @Input() accessor x = 1; static { init(); } #p = 2; }"],
	["attrs.ts", 'import data from "./d.json" with { type: "json" };'],
	["satisfies.ts", "const c = { a: 1 } satisfies Record<string, number>; function f<const T>(x: T) { return x; }"],
	["defer.ts", 'import defer * as ns from "./m";'],
	["hashbang.ts", "#!/usr/bin/env node\nconsole.log(1);"],
	["jsx.tsx", "export const A = () => <div className={x}>{items.map((i) => <B key={i} />)}</div>;"],
	["enum.ts", "enum E { A = 1, B } declare module 'm' { export const x: number }"],
	["broken.ts", "function ( {"],
];

const json = ({ program, comments, errors }: ReturnType<typeof oxcParser>) =>
	JSON.stringify({ program, comments, errors }, (_k, x) => (typeof x === "bigint" ? `${x}n` : x instanceof RegExp ? String(x) : x));
const make = (parser: typeof oxcParser) => createNarrator({ languages: [typescript({ parser, plugins: [autumn()] })], locale: en });

const wasmDefault = await createWasmParser();
const wasmModule = await createWasmParser({ wasm: await Bun.file(Bun.resolveSync("@usenarrator/lang-ts/wasm.wasm", import.meta.dir)).arrayBuffer() });
const native = make(oxcParser);
const webs = [make(wasmDefault), make(wasmModule)];

const files: [string, string][] = [...SYNTAX];
for (const f of (await corpusFiles()).filter((_, i) => i % every === 0)) files.push([f, await Bun.file(`${AUTUMN}/${f}`).text()]);

let same = 0;
const diffs: string[] = [];
for (const [path, src] of files) {
	const ast = json(oxcParser(path, src));
	const text = renderText(native.narrate(src, path).lines);
	const ok = [wasmDefault, wasmModule].every((p) => json(p(path, src)) === ast) && webs.every((w) => renderText(w.narrate(src, path).lines) === text);
	if (ok) same++;
	else diffs.push(path);
}
console.log({ files: files.length, same, diff: diffs.length }, diffs.slice(0, 10));
if (diffs.length) process.exit(1);
