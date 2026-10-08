import { cp, mkdir, rm } from "node:fs/promises";

const root = import.meta.dir;
const out = `${root}/dist`;
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const common = { target: "browser" as const, minify: false, sourcemap: "none" as const };
const bg = await Bun.build({ ...common, entrypoints: [`${root}/src/background.ts`], outdir: out, format: "esm", naming: "background.js" });
const cs = await Bun.build({ ...common, entrypoints: [`${root}/src/content.ts`], outdir: out, format: "iife", naming: "content.js" });
for (const r of [bg, cs]) if (!r.success) throw new AggregateError(r.logs, "build failed");

await cp(`${root}/manifest.json`, `${out}/manifest.json`);
await cp(`${root}/../../node_modules/@oxc-parser/wasm/web/oxc_parser_wasm_bg.wasm`, `${out}/oxc_parser_wasm_bg.wasm`);
await cp(`${root}/icon128.png`, `${out}/icon128.png`);
if (process.env.PE_COPY_TO) await cp(out, process.env.PE_COPY_TO, { recursive: true, force: true });
console.log(`built ${out}`);
