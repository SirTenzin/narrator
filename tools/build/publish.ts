// Publishes every public workspace package, dependencies first. Bun packs each package (rewriting `workspace:^`
// to real ranges) and npm uploads the tarball, so npm's browser sign-in and CI's OIDC trusted publishing both work.
//   bun tools/build/publish.ts --dry-run          build, check and pack everything in parallel; no network, no upload
//   bun tools/build/publish.ts [--otp=123456]     publish; versions already on npm are skipped, so a rerun resumes
//   bun tools/build/publish.ts --tag=next         publish under a dist-tag other than latest
// When npm opens the browser to confirm, tick "skip two-factor authentication for the next 5 minutes" so the
// remaining packages publish without asking again.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { $ } from "bun";
import { type PublishablePackage, publishablePackages } from "./packages";
import { pool } from "./pool";

type Manifest = PublishablePackage["manifest"] & {
	version: string;
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};
type Pkg = { dir: string; manifest: Manifest };

const dryRun = process.argv.includes("--dry-run");
const passThrough = process.argv.slice(2).filter((a) => a.startsWith("--otp=") || a.startsWith("--tag="));

const packages = (await publishablePackages()) as Pkg[];
const byName = new Map(packages.map((p) => [p.manifest.name, p]));
const internalDeps = (m: Manifest) => Object.keys({ ...m.dependencies, ...m.peerDependencies }).filter((d) => byName.has(d));

/** Dependencies before dependents, so nothing is ever live with a dependency npm doesn't have yet. */
const ordered: Pkg[] = [];
const visit = (p: Pkg, seen = new Set<string>()) => {
	if (ordered.includes(p)) return;
	if (seen.has(p.manifest.name)) throw new Error(`dependency cycle at ${p.manifest.name}`);
	seen.add(p.manifest.name);
	for (const d of internalDeps(p.manifest)) visit(byName.get(d)!, seen);
	ordered.push(p);
};
for (const p of packages) visit(p);

const scratch = await mkdtemp(`${tmpdir()}/narrator-pack-`);

/** Packs one package and fails if the packed manifest still has a `workspace:` range in it. */
async function pack({ dir, manifest }: Pkg): Promise<string> {
	const out = `${scratch}/${manifest.name.replace("/", "__")}`;
	await $`mkdir -p ${out}`;
	await $`bun pm pack --destination ${out} --quiet`.cwd(dir).quiet();
	const tarball = `${out}/${[...new Bun.Glob("*.tgz").scanSync(out)][0]}`;
	const packed = await $`tar -xOzf ${tarball} package/package.json`.text();
	if (packed.includes('"workspace:')) throw new Error(`${manifest.name}: packed package.json still has a workspace: range`);
	return tarball;
}

const isPublished = async (m: Manifest) => (await fetch(`https://registry.npmjs.org/${m.name.replace("/", "%2f")}/${m.version}`)).ok;

async function run(): Promise<number> {
	console.log("Building and checking every package…");
	await $`bun run build`.quiet();
	await $`bun run check:publish`;

	if (dryRun) {
		const tarballs = await pool({ items: ordered, fn: pack });
		for (const [i, p] of ordered.entries())
			console.log(`packed ${p.manifest.name}@${p.manifest.version}  ${((await Bun.file(tarballs[i]!).size) / 1024).toFixed(1)} KB`);
		console.log(`\n${ordered.length} package(s) ready to publish, in this order.`);
		return 0;
	}

	const live = await pool({ items: ordered, fn: (p) => isPublished(p.manifest) });
	const todo = ordered.filter((_, i) => !live[i]);
	for (const p of ordered.filter((_, i) => live[i])) console.log(`skip ${p.manifest.name}@${p.manifest.version} (already on npm)`);
	const tarballs = await pool({ items: todo, fn: pack });

	for (const [i, { manifest }] of todo.entries()) {
		const label = `${manifest.name}@${manifest.version}`;
		console.log(`\npublishing ${label} (${i + 1} of ${todo.length})`);
		// Inherit the terminal so npm's sign-in link and prompts show up as they happen.
		const proc = Bun.spawn(["npm", "publish", tarballs[i]!, "--access", "public", ...passThrough], { stdio: ["inherit", "inherit", "inherit"] });
		if ((await proc.exited) !== 0) {
			console.log(`\nStopped at ${label}. Rerun to continue; packages already published are skipped.`);
			return 1;
		}
	}
	console.log(`\n${todo.length} package(s) published.`);
	return 0;
}

try {
	process.exitCode = await run();
} finally {
	await rm(scratch, { recursive: true, force: true });
}
