import { cp, mkdir, rm } from "node:fs/promises";

const root = import.meta.dir;
const src = `${root}/src`;

/** `universal` loads in Chrome and Firefox (for development); `firefox` is the AMO package without Chrome-only code or keys. */
type Target = "universal" | "firefox";

async function build(target: Target, out: string) {
	await rm(out, { recursive: true, force: true });
	await mkdir(out, { recursive: true });
	const common = {
		target: "browser" as const,
		minify: true,
		sourcemap: "linked" as const,
		define: { "process.env.BROWSER": JSON.stringify(target) },
	};
	const chromeOnly = target === "firefox" ? [] : ["offscreen.ts", "worker.ts"];
	// One split ESM build: the parser, each plugin and the SQL parser become chunks the engine imports on demand.
	const modules = await Bun.build({
		...common,
		entrypoints: ["background.ts", "options.ts", ...chromeOnly].map((f) => `${src}/${f}`),
		outdir: out,
		format: "esm",
		splitting: true,
		naming: { entry: "[name].[ext]", chunk: "chunks/[name]-[hash].[ext]" },
	});
	const content = await Bun.build({ ...common, entrypoints: [`${src}/content.ts`], outdir: out, format: "iife", naming: "content.js" });
	for (const r of [modules, content]) if (!r.success) throw new AggregateError(r.logs, "build failed");

	for (const f of ["options.html", "options.css", ...(chromeOnly.length ? ["offscreen.html"] : [])]) await cp(`${src}/${f}`, `${out}/${f}`);
	const manifest = await Bun.file(`${root}/manifest.json`).json();
	if (target === "firefox") {
		delete manifest.background.service_worker;
		manifest.permissions = manifest.permissions.filter((p: string) => p !== "offscreen");
	}
	await Bun.write(`${out}/manifest.json`, `${JSON.stringify(manifest, null, "\t")}\n`);
	await cp(Bun.resolveSync("@usenarrator/lang-ts/wasm.wasm", root), `${out}/oxc-parser.wasm`);
	await cp(`${root}/icon128.png`, `${out}/icon128.png`);
}

await build("universal", `${root}/dist`);
await build("firefox", `${root}/firefox/dist`);

if (process.argv.includes("--sizes")) {
	const out = `${root}/dist`;
	for (const f of [...new Bun.Glob("**/*.{js,wasm}").scanSync(out)].sort()) {
		const bytes = await Bun.file(`${out}/${f}`).bytes();
		console.log(`${f.padEnd(40)} ${(bytes.length / 1024).toFixed(1).padStart(7)} KB ${(Bun.gzipSync(bytes).length / 1024).toFixed(1).padStart(7)} KB gz`);
	}
}
if (process.env.PE_COPY_TO) await cp(`${root}/dist`, process.env.PE_COPY_TO, { recursive: true, force: true });
console.log(`built ${root}/dist and ${root}/firefox/dist`);
