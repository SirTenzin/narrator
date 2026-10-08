import { createNarrator, renderText, toAnsi } from "@narrate/core";
import { autumn } from "@narrate/example-autumn";
import { typescript } from "@narrate/lang-ts";
import { oxcParser } from "@narrate/lang-ts/oxc";
import { en } from "@narrate/locale-en";
import { testing } from "@narrate/plugin-testing";
import { zod } from "@narrate/plugin-zod";

/** The narrator the CLI and dev tools use: TS/JS in, English out, with Autumn's conventions. */
export const narrator = createNarrator({
	languages: [typescript({ parser: oxcParser, plugins: [zod(), testing(), autumn()] })],
	locale: en,
});

if (import.meta.main) {
	const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
	const src = file ? await Bun.file(file).text() : await Bun.stdin.text();
	const { lines } = narrator.narrate(src, file ?? "stdin.ts");
	console.log(renderText(lines, process.argv.includes("--plain") ? undefined : toAnsi));
}
