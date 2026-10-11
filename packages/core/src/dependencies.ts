/** Package name -> version range, as a manifest declares it. */
export type Dependencies = Record<string, string>;

/** How to find and read one kind of dependency manifest (package.json, Cargo.toml, pyproject.toml...). */
export type ManifestReader = {
	/** Registry the names belong to, e.g. "npm", "crates", "pypi". Languages ask for the ecosystems they use. */
	ecosystem: string;
	/** Whether a repo path is this kind of manifest, e.g. `p.endsWith("/package.json")`. */
	matches: (path: string) => boolean;
	parse: (text: string) => Dependencies;
};

const ignoredDir = /(^|\/)(node_modules|target|\.venv|venv|vendor|dist|\.git)\//;

/** Reads `dependencies`, `devDependencies`, `peerDependencies` and `optionalDependencies`. */
export const packageJson: ManifestReader = {
	ecosystem: "npm",
	matches: (path) => (path === "package.json" || path.endsWith("/package.json")) && !ignoredDir.test(path),
	parse: (text) => {
		const json = JSON.parse(text) as Record<string, unknown>;
		const fields = ["optionalDependencies", "peerDependencies", "devDependencies", "dependencies"];
		return Object.assign({}, ...fields.map((f) => (json[f] && typeof json[f] === "object" ? json[f] : {})));
	},
};

export const defaultManifestReaders: ManifestReader[] = [packageJson];

export type DependencyIndex = {
	/** Manifest paths worth fetching from a repo's file list. */
	manifestPaths: (paths: string[]) => string[];
	/** Dependencies for a file: its nearest manifest merged over the repo root's, per ecosystem. */
	forFile: (path: string, ecosystem: string) => Dependencies;
};

const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Builds a lookup from manifest files (`path -> text`); unparseable manifests are skipped. */
export function createDependencyIndex({
	manifests,
	readers = defaultManifestReaders,
}: {
	manifests: Map<string, string>;
	readers?: ManifestReader[];
}): DependencyIndex {
	const byDir = new Map<string, Map<string, Dependencies>>();
	for (const [path, text] of manifests) {
		const reader = readers.find((r) => r.matches(path));
		if (!reader) continue;
		try {
			const dir = dirOf(path);
			const entry = byDir.get(reader.ecosystem) ?? new Map<string, Dependencies>();
			entry.set(dir, { ...entry.get(dir), ...reader.parse(text) });
			byDir.set(reader.ecosystem, entry);
		} catch {}
	}
	return {
		manifestPaths: (paths) => paths.filter((p) => readers.some((r) => r.matches(p))),
		forFile: (path, ecosystem) => {
			const dirs = byDir.get(ecosystem);
			if (!dirs) return {};
			const root = dirs.get("") ?? {};
			for (let dir = dirOf(path); ; dir = dirOf(dir)) {
				const own = dirs.get(dir);
				if (own) return { ...root, ...own };
				if (!dir) return root;
			}
		},
	};
}
