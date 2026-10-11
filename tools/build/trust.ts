// Lets the Release workflow publish every public package with OIDC (npm trusted publishing), once per package.
// Needs npm 11.15+, 2FA on your npm account, and each package already on npm (publish once from your machine first).
//   bun tools/build/trust.ts [--dry-run]
// npm asks for 2FA on the first package; tick "skip for 5 minutes" on the web page and the rest go through.
import { $ } from "bun";
import { publishablePackages } from "./packages";

const WORKFLOW = "release.yml";
const dryRun = process.argv.includes("--dry-run");
const root = (await Bun.file(`${import.meta.dir}/../../package.json`).json()) as { repository?: { url?: string } };
const firstPackage = (await publishablePackages())[0]!.manifest as { repository?: { url?: string } };
const url = root.repository?.url ?? firstPackage.repository?.url ?? "";
const repo = url.match(/github\.com[/:]([^/]+\/[^/.]+)/)?.[1];
if (!repo) throw new Error("couldn't read owner/repo from repository.url in package.json");

for (const { manifest } of await publishablePackages()) {
	const existing = await $`npm trust list ${manifest.name} --json`.nothrow().quiet();
	if (existing.exitCode === 0 && existing.stdout.toString().includes(WORKFLOW)) {
		console.log(`skip ${manifest.name} (already trusts ${repo}/${WORKFLOW})`);
		continue;
	}
	const flags = ["--file", WORKFLOW, "--repo", repo, "--allow-publish", "--yes", ...(dryRun ? ["--dry-run"] : [])];
	await $`npm trust github ${manifest.name} ${flags}`;
	console.log(`trusted ${manifest.name}`);
	await Bun.sleep(2000);
}
