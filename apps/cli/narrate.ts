import { createNarrator, renderText, toAnsi } from "@usenarrator/core";
import { autumn } from "@usenarrator/example-autumn";
import { typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en } from "@usenarrator/locale-en";
import { betterAuth } from "@usenarrator/plugin-better-auth";
import { effect } from "@usenarrator/plugin-effect";
import { testing } from "@usenarrator/plugin-testing";
import { aiSdk } from "@usenarrator/plugin-ai-sdk";
import { elysia } from "@usenarrator/plugin-elysia";
import { hono } from "@usenarrator/plugin-hono";
import { zod } from "@usenarrator/plugin-zod";

/** The narrator the CLI and dev tools use: TS/JS in, English out, with Autumn's conventions. */
export const narrator = createNarrator({
	languages: [typescript({ parser: oxcParser, plugins: [zod(), testing(), effect(), betterAuth(), hono(), elysia(), aiSdk(), autumn()] })],
	locale: en,
});

if (import.meta.main) {
	const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
	const src = file ? await Bun.file(file).text() : await Bun.stdin.text();
	const { lines } = narrator.narrate(src, file ?? "stdin.ts");
	console.log(renderText(lines, process.argv.includes("--plain") ? undefined : toAnsi));
}
