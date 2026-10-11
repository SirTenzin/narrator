import { createDependencyIndex, createNarrator, renderText } from "@usenarrator/core";
import { typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en } from "@usenarrator/locale-en";
import { hono } from "@usenarrator/plugin-hono";

// A monorepo with two packages: only apps/api depends on Hono.
const dependencies = createDependencyIndex({
	manifests: new Map([
		["package.json", JSON.stringify({ devDependencies: { typescript: "^5" } })],
		["apps/api/package.json", JSON.stringify({ dependencies: { hono: "^4.6.0" } })],
		["apps/worker/package.json", JSON.stringify({ dependencies: { bullmq: "^5.0.0" } })],
	]),
});

const narrator = createNarrator({ languages: [typescript({ parser: oxcParser, plugins: [hono()] })], locale: en, dependencies });

// No import of "hono" in either file: the package manifest decides.
const source = `import { app } from "./app";
app.get("/health", (c) => c.json({ ok: true }));`;

console.log(dependencies.forFile("apps/api/src/health.ts", "npm"));
console.log(renderText(narrator.narrate(source, "apps/api/src/health.ts").lines));
console.log(renderText(narrator.narrate(source, "apps/worker/src/health.ts").lines));
