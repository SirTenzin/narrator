// Builds every publishable package to dist/ (ESM + bundled .d.ts) with tsdown. Entries come from each
// package.json: an export or bin at `./dist/<x>.js` is built from `src/<x>.ts`, and any other file an export
// points at, such as `./dist/oxc-parser.wasm`, is copied from `src/`. Imports that aren't dependencies are bundled.
import { cp } from "node:fs/promises";
import { Glob } from "bun";
import { build } from "tsdown";
import { publishablePackages, ROOT } from "./packages";
import { pool } from "./pool";

const only = process.argv.slice(2);

const sourceOf = (distPath: string) => distPath.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts");

const selected = (await publishablePackages()).filter(({ manifest }) => !only.length || only.some((o) => manifest.name.endsWith(o)));

await pool({
	items: selected,
	fn: async ({ dir, manifest }) => {
		const targets = [
			...Object.values(manifest.exports ?? {}).flatMap((e) => (typeof e === "object" && e.import ? [e.import] : [])),
			...Object.values(manifest.bin ?? {}),
		].filter((p) => p.startsWith("./dist/"));
		const entry = Object.fromEntries(targets.map((t) => [t.slice("./dist/".length, -".js".length), sourceOf(t)]));
		const files = (await Array.fromAsync(new Glob("src/**/*.ts").scan(dir))).filter((f) => !f.endsWith(".test.ts"));
		const sources = await Promise.all(files.map((f) => Bun.file(`${dir}/${f}`).text()));
		const usesNode = sources.some((text) => text.includes('from "node:'));
		await build({
			cwd: dir,
			entry,
			outDir: "dist",
			format: "esm",
			platform: usesNode ? "node" : "neutral",
			target: "es2022",
			dts: { tsconfig: `${import.meta.dir}/tsconfig.build.json` },
			clean: true,
			fixedExtension: false,
			logLevel: "warn",
		});
		const exported = Object.values(manifest.exports ?? {}).flatMap((e) => (typeof e === "string" ? [e] : Object.values(e)));
		for (const p of exported.filter((p) => p.startsWith("./dist/")))
			if (!(await Bun.file(`${dir}/${p}`).exists())) await cp(`${dir}/${p.replace(/^\.\/dist\//, "src/")}`, `${dir}/${p}`, { dereference: true });
		await Bun.write(`${dir}/LICENSE`, Bun.file(`${ROOT}/LICENSE`));
		console.log(`built ${manifest.name}`);
	},
});
