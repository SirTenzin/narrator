import { parseSync } from "@oxc-parser/wasm";
import { createNarrator, renderText } from "@usenarrator/core";
import { typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { oxcWasmParser } from "@usenarrator/lang-ts/wasm";
import { en } from "@usenarrator/locale-en";

const source = `export const total = (items: Item[]) => items.reduce((sum, item) => sum + item.price * item.qty, 0);`;

const native = createNarrator({ languages: [typescript({ parser: oxcParser })], locale: en });
const wasm = createNarrator({ languages: [typescript({ parser: oxcWasmParser(parseSync) })], locale: en });

const a = renderText(native.narrate(source, "cart.ts").lines);
const b = renderText(wasm.narrate(source, "cart.ts").lines);
console.log(a);
console.log(a === b ? "native and WASM agree" : "native and WASM differ");
