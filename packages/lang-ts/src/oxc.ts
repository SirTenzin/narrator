import { parseSync } from "oxc-parser";
import type { Parser } from "./parser";

/** Native oxc parser for Bun and Node. */
export const oxcParser: Parser = (filename, src) => parseSync(filename, src) as any;
