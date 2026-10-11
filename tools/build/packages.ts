import { Glob } from "bun";

export const ROOT = `${import.meta.dir}/../..`;

export type Manifest = {
	name: string;
	private?: boolean;
	bin?: Record<string, string>;
	exports?: Record<string, string | Record<string, string>>;
};

export type PublishablePackage = { dir: string; manifest: Manifest };

/** Every workspace package that isn't private, in a stable order. */
export async function publishablePackages(): Promise<PublishablePackage[]> {
	const { workspaces } = (await Bun.file(`${ROOT}/package.json`).json()) as { workspaces: string[] };
	const dirs = (await Promise.all(workspaces.map((w) => Array.fromAsync(new Glob(`${w}/package.json`).scan(ROOT))))).flat().sort();
	const packages = await Promise.all(
		dirs.map(async (p) => ({ dir: `${ROOT}/${p.replace(/\/package\.json$/, "")}`, manifest: (await Bun.file(`${ROOT}/${p}`).json()) as Manifest })),
	);
	return packages.filter((p) => !p.manifest.private);
}
