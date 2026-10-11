// Builds every publishable package to dist/ (ESM + bundled .d.ts) with tsdown. Entries come from each
// package.json: an export or bin at `./dist/<x>.js` is built from `src/<x>.ts`.
import { Glob } from "bun";
import { build } from "tsdown";
import { publishablePackages, ROOT } from "./packages";

const only = process.argv.slice(2);

const sourceOf = (distPath: string) => distPath.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts");

for (const { dir, manifest } of await publishablePackages()) {
	if (only.length && !only.some((o) => manifest.name.endsWith(o))) continue;
	const targets = [
		...Object.values(manifest.exports ?? {}).flatMap((e) => (typeof e === "object" && e.import ? [e.import] : [])),
		...Object.values(manifest.bin ?? {}),
	].filter((p) => p.startsWith("./dist/"));
	const entry = Object.fromEntries(targets.map((t) => [t.slice("./dist/".length, -".js".length), sourceOf(t)]));
	const sources = await Promise.all((await Array.fromAsync(new Glob("src/**/*.ts").scan(dir))).map((f) => Bun.file(`${dir}/${f}`).text()));
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
	await Bun.write(`${dir}/LICENSE`, Bun.file(`${ROOT}/LICENSE`));
	console.log(`built ${manifest.name}`);
}
