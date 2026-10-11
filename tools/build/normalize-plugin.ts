// Brings a plugin's package.json in line with the publishing conventions (version, exports to dist, peers, files).
const dir = process.argv[2];
if (!dir) throw new Error("usage: bun tools/build/normalize-plugin.ts plugins/<name>");
const path = `${dir}/package.json`;
const pkg = await Bun.file(path).json();
const entries: Record<string, string> = typeof pkg.exports === "string" ? { ".": pkg.exports } : (pkg.exports ?? { ".": "./src/index.ts" });
const exportsMap: Record<string, unknown> = {};
for (const [key, target] of Object.entries(entries)) {
	if (key === "./package.json") continue;
	const src = typeof target === "string" ? target : String((target as Record<string, string>).import ?? (target as Record<string, string>).default);
	const out = src.replace(/^\.\/src\//, "./dist/").replace(/\.ts$/, ".js");
	exportsMap[key] = { types: out.replace(/\.js$/, ".d.ts"), import: out, default: out };
}
exportsMap["./package.json"] = "./package.json";
const workspace = (deps: Record<string, string> = {}) =>
	Object.fromEntries(Object.entries(deps).map(([k, v]) => [k, k.startsWith("@usenarrator/") ? "workspace:^" : v]));
const internal = Object.fromEntries(Object.entries(workspace({ ...pkg.dependencies, ...pkg.peerDependencies })).filter(([k]) => k.startsWith("@usenarrator/")));
const external = Object.fromEntries(Object.entries({ ...pkg.dependencies }).filter(([k]) => !k.startsWith("@usenarrator/")));
// core and lang-ts stay peers so every plugin shares one engine; a plugin another plugin builds on is an ordinary dependency.
const SHARED = new Set(["@usenarrator/core", "@usenarrator/lang-ts"]);
const peers = Object.fromEntries(Object.entries(internal).filter(([k]) => SHARED.has(k)));
const builtOn = Object.fromEntries(Object.entries(internal).filter(([k]) => !SHARED.has(k)));
const externalPeers = Object.fromEntries(Object.entries({ ...pkg.peerDependencies }).filter(([k]) => !k.startsWith("@usenarrator/")));
const dependencies = { ...builtOn, ...external };
const out = {
	name: pkg.name,
	version: "0.1.0",
	description: pkg.description,
	license: "MIT",
	repository: { type: "git", url: "git+https://github.com/SirTenzin/narrator.git", directory: dir },
	homepage: "https://github.com/SirTenzin/narrator#readme",
	type: "module",
	sideEffects: false,
	engines: { node: "^20.19.0 || >=22.12.0" },
	main: "./dist/index.js",
	types: "./dist/index.d.ts",
	exports: exportsMap,
	files: ["dist"],
	publishConfig: { access: "public" },
	...(Object.keys(dependencies).length ? { dependencies } : {}),
	peerDependencies: { ...peers, ...externalPeers },
	...(pkg.peerDependenciesMeta ? { peerDependenciesMeta: pkg.peerDependenciesMeta } : {}),
	devDependencies: { ...internal, ...workspace(pkg.devDependencies) },
};
await Bun.write(path, `${JSON.stringify(out, null, "\t")}\n`);
console.log("normalized", path);
