import { createNarrator, plain } from "@usenarrator/core";
import { typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en } from "@usenarrator/locale-en";

const narrator = createNarrator({ languages: [typescript({ parser: oxcParser })], locale: en });
const { lines, stats } = narrator.narrate(`const changed = previousFlags ^ nextFlags;`, "flags.ts");

console.log(plain(lines[0]!.text));
console.log(stats);
