import { expect, test } from "bun:test";
import { createDependencyIndex, createNarrator, type ManifestReader, renderText } from "@usenarrator/core";
import { typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en } from "@usenarrator/locale-en";

const manifests = new Map([
	["package.json", JSON.stringify({ devDependencies: { typescript: "^5" } })],
	["apps/api/package.json", JSON.stringify({ dependencies: { hono: "^4.6.0" } })],
	["node_modules/x/package.json", JSON.stringify({ dependencies: { nope: "1" } })],
	["crates/core/Cargo.toml", '[dependencies]\nserde = "1"\n'],
]);

const cargoToml: ManifestReader = {
	ecosystem: "crates",
	matches: (p) => p.endsWith("Cargo.toml"),
	parse: (text) => Object.fromEntries([...text.matchAll(/^(\w[\w-]*)\s*=\s*"([^"]+)"/gm)].map((m) => [m[1]!, m[2]!])),
};

test("nearest manifest wins, merged over the root, per ecosystem", () => {
	const index = createDependencyIndex({ manifests });
	expect(index.forFile("apps/api/src/routes/users.ts", "npm")).toEqual({ typescript: "^5", hono: "^4.6.0" });
	expect(index.forFile("scripts/seed.ts", "npm")).toEqual({ typescript: "^5" });
	expect(index.forFile("apps/api/src/x.ts", "crates")).toEqual({});
});

test("other ecosystems plug in as readers", () => {
	const index = createDependencyIndex({ manifests, readers: [cargoToml] });
	expect(index.forFile("crates/core/src/lib.rs", "crates")).toEqual({ serde: "1" });
	expect(index.manifestPaths(["a/Cargo.toml", "package.json", "src/main.rs"])).toEqual(["a/Cargo.toml"]);
});

test("the narrator hands each file its package's dependencies", () => {
	const seen: Record<string, string>[] = [];
	const narrator = createNarrator({
		languages: [typescript({ parser: oxcParser, setup: ({ engine }) => void seen.push(engine.dependencies) })],
		locale: en,
		dependencies: createDependencyIndex({ manifests }),
	});
	renderText(narrator.narrate("const a = 1;", "apps/api/src/index.ts").lines);
	expect(seen[0]).toEqual({ typescript: "^5", hono: "^4.6.0" });
});
