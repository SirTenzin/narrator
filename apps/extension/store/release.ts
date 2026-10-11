// Builds the files for a GitHub release of the extension into store/out/release/, with stable names so
// docs can link to https://github.com/<owner>/<repo>/releases/latest/download/<file>.
//   bun store/release.ts            Chromium and Firefox zips (any OS)
//   bun store/release.ts --safari   also the Safari app (macOS with Xcode)
import { mkdir, rm } from "node:fs/promises";
import { $ } from "bun";

const extension = `${import.meta.dir}/..`;
const out = `${import.meta.dir}/out/release`;
const withSafari = process.argv.includes("--safari");

export const RELEASE_FILES = {
	chromium: "narrator-for-github-chromium.zip",
	firefox: "narrator-for-github-firefox.zip",
	safari: "narrator-for-github-safari.zip",
};

const zipDir = async ({ dir, zip }: { dir: string; zip: string }) => {
	await rm(zip, { force: true });
	await $`zip -q -X -r ${zip} . -x '*.DS_Store'`.cwd(dir);
};

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await $`bun build.ts`.cwd(extension).quiet();
await zipDir({ dir: `${extension}/chrome/dist`, zip: `${out}/${RELEASE_FILES.chromium}` });
await zipDir({ dir: `${extension}/firefox/dist`, zip: `${out}/${RELEASE_FILES.firefox}` });
if (withSafari) {
	await $`./safari.sh`.cwd(extension).quiet();
	// ditto keeps the app bundle's symlinks and metadata intact, which plain zip can break.
	await $`ditto -c -k --keepParent safari-build/Narrator.app ${`${out}/${RELEASE_FILES.safari}`}`.cwd(extension);
}

const { version } = await Bun.file(`${extension}/manifest.json`).json();
for (const f of [...new Bun.Glob("*.zip").scanSync(out)].sort()) console.log(`${f}  ${((await Bun.file(`${out}/${f}`).size) / 1024).toFixed(0)} KB`);
console.log(`\nversion ${version}; tag it extension-v${version}`);
