// Lints every publishable package as it would be published: publint (package.json, exports, files) and
// arethetypeswrong (types resolve for each export under Node16 ESM and bundlers). Run after `bun run build`.
import { $ } from "bun";
import { publishablePackages } from "./packages";

let failed = 0;
for (const { dir, manifest } of await publishablePackages()) {
	const publint = await $`bunx publint run ${dir} --strict`.nothrow().quiet();
	const attw = await $`bunx attw --pack ${dir} --profile esm-only --format ascii`.nothrow().quiet();
	const ok = publint.exitCode === 0 && attw.exitCode === 0;
	console.log(`${ok ? "ok  " : "FAIL"} ${manifest.name}`);
	if (ok) continue;
	failed++;
	if (publint.exitCode !== 0) console.log(publint.stdout.toString(), publint.stderr.toString());
	if (attw.exitCode !== 0) console.log(attw.stdout.toString(), attw.stderr.toString());
}
process.exit(failed ? 1 : 0);
