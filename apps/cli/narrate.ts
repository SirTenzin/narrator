// Dev entry, not published: `bun apps/cli/narrate.ts <file|dir|glob>` or `bun apps/cli/narrate.ts diff main..HEAD`.
// `--preset autumn` adds the in-repo Autumn example preset.
import { autumn } from "@usenarrator/example-autumn";
import { main } from "./src/main";

const PRESETS = { autumn };

const withPreset = (argv: string[]) => {
	const at = argv.findIndex((a) => a === "--preset" || a.startsWith("--preset="));
	if (at === -1) return { argv, extraPlugins: [] };
	const name = argv[at]!.includes("=") ? argv[at]!.split("=")[1]! : argv[at + 1]!;
	const preset = PRESETS[name as keyof typeof PRESETS];
	if (!preset) throw new Error(`Unknown preset "${name}". Available: ${Object.keys(PRESETS).join(", ")}`);
	return { argv: argv.filter((_, i) => i !== at && !(i === at + 1 && !argv[at]!.includes("="))), extraPlugins: preset() };
};

if (import.meta.main) {
	const { argv, extraPlugins } = withPreset(process.argv.slice(2));
	process.exitCode = await main(argv, { extraPlugins });
}
