export type Format = "plain" | "ansi" | "json" | "html";

export type CliArgs = {
	command: "narrate" | "diff" | "help";
	targets: string[];
	/** Explicit `--plugins` list; null means detect from the repo's manifests. */
	plugins: string[] | null;
	locale: string;
	/** Narrate generated, vendored, minified and build files too. */
	includeGenerated: boolean;
	format: Format;
};

export const USAGE = `Usage:
  narrator <file|dir|glob>...      narrate files (reads stdin when none are given)
  narrator diff <base>..<head>     narrate a git change set (omit <head> for the working tree)

Options:
  --plugins zod,drizzle   plugins to load ("all", "none"); default: detected from package.json dependencies
  --locale en             output language
  --include-generated     also narrate generated, vendored, minified and build files
  --plain | --ansi | --json | --html   output format (default: ansi on a terminal, plain otherwise)
  -h, --help`;

const FORMATS: Format[] = ["plain", "ansi", "json", "html"];
const VALUE_FLAGS = new Set(["plugins", "locale"]);

export function parseArgs({ argv, isTTY }: { argv: string[]; isTTY: boolean }): CliArgs {
	const values: Record<string, string> = {};
	const positionals: string[] = [];
	let format: Format | null = null;
	let help = false;
	let includeGenerated = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "-h" || arg === "--help") help = true;
		else if (arg.startsWith("--")) {
			const [name, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
			if (FORMATS.includes(name as Format)) format = name as Format;
			else if (name === "include-generated") includeGenerated = true;
			else if (VALUE_FLAGS.has(name)) {
				const value = inline ?? argv[++i];
				if (value === undefined) throw new Error(`--${name} needs a value`);
				values[name] = value;
			} else throw new Error(`Unknown option ${arg}\n\n${USAGE}`);
		} else positionals.push(arg);
	}
	const isDiff = positionals[0] === "diff";
	const list = values.plugins
		?.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return {
		command: help ? "help" : isDiff ? "diff" : "narrate",
		targets: isDiff ? positionals.slice(1) : positionals,
		plugins: list ?? null,
		locale: values.locale ?? "en",
		includeGenerated,
		format: format ?? (isTTY && !process.env.NO_COLOR ? "ansi" : "plain"),
	};
}
