import type { Parser } from "./parser";

type WasmParse = (src: string, opts: { sourceFilename: string; sourceType: "module" }) => any;

// JSON can't carry BigInt, so the wasm build leaves `0n` literals with a null value; the native parser doesn't.
const reviveBigInt = (_key: string, v: any) => (v?.type === "Literal" && v.value === null && typeof v.bigint === "string" ? { ...v, value: BigInt(v.bigint) } : v);

/** Wraps `parseSync` from `@oxc-parser/wasm` (after its init) for browsers and extension workers. */
export const oxcWasmParser =
	(parseSync: WasmParse): Parser =>
	(filename, src) => {
		const r = parseSync(src, { sourceFilename: filename, sourceType: "module" });
		return { program: JSON.parse(r.programJson, reviveBigInt), comments: r.comments, errors: r.errors };
	};
