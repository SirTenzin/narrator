import { createNarrator, plain, toHtml } from "@usenarrator/core";
import { typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en } from "@usenarrator/locale-en";

const narrator = createNarrator({ languages: [typescript({ parser: oxcParser })], locale: en });
const [line] = narrator.narrate(`if (order.total > limit) notifyFinance(order);`, "order.ts").lines;

console.log(plain(line!.text));
console.log(toHtml(line!.text, (name, kind) => (kind === "f" ? `#fn-${name}` : null)));
