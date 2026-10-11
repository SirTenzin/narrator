// Publishes every public workspace package with `bun publish`, dependencies first.
//   bun tools/build/publish.ts --dry-run          pack and check everything, upload nothing
//   bun tools/build/publish.ts [--otp=123456]     publish; versions already on npm are skipped, so a rerun resumes
//   bun tools/build/publish.ts --tag=next         publish under a dist-tag other than latest
//   bun tools/build/publish.ts --npm              pack with Bun, upload with npm (CI: OIDC trusted publishing + provenance)
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { $ } from "bun";
import { type PublishablePackage, publishablePackages } from "./packages";

type Manifest = PublishablePackage["manifest"] & {
	version: string;
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};

const dryRun = process.argv.includes("--dry-run");
const viaNpm = process.argv.includes("--npm");
const passThrough = process.argv.slice(2).filter((a) => a.startsWith("--otp=") || a.startsWith("--tag="));

const packages = (await publishablePackages()) as { dir: string; manifest: Manifest }[];
const byName = new Map(packages.map((p) => [p.manifest.name, p]));
const internalDeps = (m: Manifest) => Object.keys({ ...m.dependencies, ...m.peerDependencies }).filter((d) => byName.has(d));

/** Dependencies before dependents, so nothing is ever live with a dependency npm doesn't have yet. */
const ordered: typeof packages = [];
const visit = (p: (typeof packages)[number], seen = new Set<string>()) => {
	if (ordered.includes(p)) return;
	if (seen.has(p.manifest.name)) throw new Error(`dependency cycle at ${p.manifest.name}`);
	seen.add(p.manifest.name);
	for (const d of internalDeps(p.manifest)) visit(byName.get(d)!, seen);
	ordered.push(p);
};
for (const p of packages) visit(p);

/** `bun pm pack` rewrites `workspace:^` to real ranges; npm then uploads the tarball, which is what trusted publishing needs. */
async function npmPublish(dir: string, flags: string[]) {
	const out = await mkdtemp(`${tmpdir()}/narrator-pack-`);
	const pack = await $`bun pm pack --destination ${out} --quiet`.cwd(dir).nothrow().quiet();
	if (pack.exitCode !== 0) return pack;
	const tarball = [...new Bun.Glob("*.tgz").scanSync(out)][0];
	return $`npm publish ${`${out}/${tarball}`} ${flags}`.nothrow().quiet();
}

const published = async (m: Manifest) => (await fetch(`https://registry.npmjs.org/${m.name.replace("/", "%2f")}/${m.version}`)).ok;

console.log("Building and checking every package first…");
await $`bun run build`.quiet();
await $`bun run check:publish`;

let done = 0;
for (const { dir, manifest } of ordered) {
	const label = `${manifest.name}@${manifest.version}`;
	if (!dryRun && (await published(manifest))) {
		console.log(`skip ${label} (already on npm)`);
		continue;
	}
	const flags = ["--access", "public", ...passThrough, ...(dryRun ? ["--dry-run"] : [])];
	const out = viaNpm ? await npmPublish(dir, flags) : await $`bun publish ${flags}`.cwd(dir).nothrow().quiet();
	if (out.exitCode !== 0) {
		console.log(out.stdout.toString(), out.stderr.toString());
		console.log(`\nStopped at ${label}. Fix it and rerun; packages already published are skipped.`);
		process.exit(1);
	}
	done++;
	console.log(`${dryRun ? "ok  " : "published"} ${label}`);
}
console.log(`\n${done} package(s) ${dryRun ? "would be published" : "published"}.`);
