// Dev entry: `bun apps/cli/narrate.ts <file|dir|glob>` or `bun apps/cli/narrate.ts diff main..HEAD`.
import { main } from "./src/main";

export * from "./src/index";

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
