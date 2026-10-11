// Builds the extension and writes upload-ready zips to store/out/: `bun store/package.ts chrome|edge|firefox|safari`.
// Firefox also gets the source zip AMO asks for; Safari gets the universal build for App Store Connect's web extension packager.
import { mkdir, rm } from "node:fs/promises";
import { $ } from "bun";

const STORES = ["chrome", "edge", "firefox", "safari"] as const;
type Store = (typeof STORES)[number];

const extension = `${import.meta.dir}/..`;
const repo = (await $`git rev-parse --show-toplevel`.cwd(extension).text()).trim();
const out = `${import.meta.dir}/out`;

/** Tracked files that AMO reviewers need to rebuild; the test corpus and docs site aren't build inputs. */
const SOURCE_EXCLUDES = [/^corpus\//, /^docs\//];

async function zipDir({ dir, zip }: { dir: string; zip: string }) {
	await rm(zip, { force: true });
	await $`zip -q -X -r ${zip} . -x '*.DS_Store'`.cwd(dir);
	return zip;
}

async function sourceZip({ zip }: { zip: string }) {
	if ((await $`git status --porcelain`.cwd(repo).text()).trim())
		console.warn("warning: the working tree has uncommitted changes; the source zip includes them as they are on disk.");
	const files = (await $`git ls-files`.cwd(repo).text()).split("\n").filter((f) => f && !SOURCE_EXCLUDES.some((re) => re.test(f)));
	await rm(zip, { force: true });
	const stage = `${out}/.source`;
	await rm(stage, { recursive: true, force: true });
	await mkdir(stage, { recursive: true });
	await Bun.write(`${stage}/README-AMO.md`, Bun.file(`${import.meta.dir}/AMO-SOURCE.md`));
	await $`zip -q -X ${zip} README-AMO.md`.cwd(stage);
	await $`zip -q -X ${zip} -@ < ${new Response(files.join("\n"))}`.cwd(repo);
	await rm(stage, { recursive: true, force: true });
	return zip;
}

async function packageFor(store: Store) {
	const { version } = await Bun.file(`${extension}/manifest.json`).json();
	const name = `narrator-for-github-${version}`;
	const dist = { chrome: "chrome/dist", edge: "chrome/dist", firefox: "firefox/dist", safari: "dist" }[store];
	const written = [await zipDir({ dir: `${extension}/${dist}`, zip: `${out}/${name}-${store}.zip` })];
	if (store === "firefox") written.push(await sourceZip({ zip: `${out}/${name}-source.zip` }));
	return written;
}

const store = process.argv[2] as Store;
if (!STORES.includes(store)) throw new Error(`usage: bun store/package.ts ${STORES.join("|")}`);
await mkdir(out, { recursive: true });
await $`bun build.ts`.cwd(extension).quiet();
for (const zip of await packageFor(store)) console.log(`${zip.slice(repo.length + 1)}  ${((await Bun.file(zip).size) / 1024).toFixed(0)} KB`);
