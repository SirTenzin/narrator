// Lints every publishable package as it would be published: publint (package.json, exports, files) and
// arethetypeswrong (types resolve for each export under Node16 ESM and bundlers). Run after `bun run build`.
import { $ } from "bun";
import { publishablePackages } from "./packages";
import { pool } from "./pool";

const results = await pool({
	items: await publishablePackages(),
	fn: async ({ dir, manifest }) => {
		const [publint, attw] = await Promise.all([
			$`bunx publint run ${dir} --strict`.nothrow().quiet(),
			$`bunx attw --pack ${dir} --profile esm-only --format ascii`.nothrow().quiet(),
		]);
		const ok = publint.exitCode === 0 && attw.exitCode === 0;
		console.log(`${ok ? "ok  " : "FAIL"} ${manifest.name}`);
		return { manifest, publint, attw, ok };
	},
});
for (const { manifest, publint, attw, ok } of results) {
	if (ok) continue;
	console.log(`\n${manifest.name}:`);
	if (publint.exitCode !== 0) console.log(publint.stdout.toString(), publint.stderr.toString());
	if (attw.exitCode !== 0) console.log(attw.stdout.toString(), attw.stderr.toString());
}
process.exit(results.some((r) => !r.ok) ? 1 : 0);
