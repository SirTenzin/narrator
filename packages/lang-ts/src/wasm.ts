import { createInstance } from "@oxc-parser/binding-wasm32-wasip1/workerd";
import type { ParseOutput, Parser } from "./parser";

/** Where to load oxc's `.wasm` from: a URL, a fetch `Response`, the file's bytes, or an already compiled module. */
export type WasmSource = URL | string | Response | PromiseLike<Response> | ArrayBuffer | ArrayBufferView | WebAssembly.Module | PromiseLike<WebAssembly.Module>;

export type CreateWasmParserOptions = {
	/** Leave out in Node, Bun and Vite-style bundlers; pass a compiled module on Cloudflare Workers. */
	wasm?: WasmSource;
};

type Binding = { parseSync(filename: string, src: string): { program: string; comments: ParseOutput["comments"]; errors: unknown[] } };

const GUIDE = 'See the "Embedding in your app" guide in the Narrator docs.';
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

const fail = (msg: string, cause?: unknown): never => {
	const why = cause instanceof Error ? ` (${cause.message})` : "";
	throw new Error(`Narrator: ${msg}${why} ${GUIDE}`, cause === undefined ? undefined : { cause });
};

const isThenable = (x: any): x is PromiseLike<unknown> => typeof x?.then === "function";
const isModule = (x: unknown): x is WebAssembly.Module => typeof WebAssembly !== "undefined" && x instanceof WebAssembly.Module;
const isResponse = (x: unknown): x is Response => typeof Response !== "undefined" && x instanceof Response;
const isBytes = (x: unknown): x is ArrayBuffer | ArrayBufferView => x instanceof ArrayBuffer || ArrayBuffer.isView(x);

async function compile(bytes: ArrayBuffer | ArrayBufferView, from: string): Promise<WebAssembly.Module> {
	const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (!WASM_MAGIC.every((b, i) => view[i] === b)) {
		const head = new TextDecoder().decode(view.subarray(0, 64)).trim();
		const looksHtml = head.startsWith("<");
		fail(
			`${from} is not a WebAssembly file${looksHtml ? " (it starts with HTML, so the server probably answered with your app's index page)" : ""}. Pass the URL your bundler gives for @usenarrator/lang-ts/wasm.wasm, or leave \`wasm\` out.`,
		);
	}
	return WebAssembly.compile(view as Uint8Array<ArrayBuffer>);
}

async function fromResponse(res: Response, from: string): Promise<WebAssembly.Module> {
	if (!res.ok) fail(`Fetching the parser's .wasm from ${from} failed with HTTP ${res.status}.`);
	return compile(await res.arrayBuffer(), from);
}

async function toModule(source: WasmSource): Promise<WebAssembly.Module> {
	const value: any = isThenable(source) ? await source : source;
	if (isModule(value)) return value;
	if (isResponse(value)) return fromResponse(value, value.url || "the Response you passed");
	if (isBytes(value)) return compile(value, "The bytes you passed");
	if (typeof value === "string" || value instanceof URL) {
		const url = String(value);
		let res: Response;
		try {
			res = await fetch(url);
		} catch (e) {
			return fail(`Couldn't fetch the parser's .wasm from ${url}.`, e);
		}
		return fromResponse(res, url);
	}
	if (value && typeof value === "object" && "default" in value)
		return fail('`wasm` got a module namespace object. Pass its default export instead: `import wasm from "…wasm"`, then `{ wasm }`.');
	return fail(`\`wasm\` must be a URL, a Response, the file's bytes or a WebAssembly.Module, but got ${value === null ? "null" : typeof value}.`);
}

const instantiate = async (module: WebAssembly.Module): Promise<Binding> => {
	try {
		return (await createInstance(module)).exports as unknown as Binding;
	} catch (e) {
		return fail("oxc's WASM parser failed to start.", e);
	}
};

// The build puts oxc's .wasm next to this module, and bundlers emit it as an asset from this `new URL` pattern.
// Node and Bun read it from disk, without a static `node:` import that would trip browser bundlers; everything else fetches it.
async function loadShipped(): Promise<WebAssembly.Module> {
	const url = new URL("./oxc-parser.wasm", import.meta.url);
	const fs = (globalThis as any).process?.getBuiltinModule?.("node:fs");
	if (!fs || url.protocol !== "file:") return toModule(url);
	let bytes: Uint8Array;
	try {
		bytes = fs.readFileSync(url);
	} catch (e) {
		return fail(
			`Couldn't read the parser's .wasm at ${url.pathname}. If you bundled Narrator, copy oxc-parser.wasm next to the bundle or pass \`wasm\` explicitly.`,
			e,
		);
	}
	return compile(bytes, url.pathname);
}

let defaultBinding: Promise<Binding> | null = null;

const loadDefault = (): Promise<Binding> =>
	(defaultBinding ??= loadShipped()
		.then(instantiate)
		.catch((e) => {
			defaultBinding = null;
			throw e;
		}));

async function load(options?: CreateWasmParserOptions): Promise<Binding> {
	const o: any = options;
	if (o !== undefined && (o === null || typeof o !== "object" || isThenable(o) || isModule(o) || o instanceof URL))
		fail("createWasmParser takes an options object, for example `createWasmParser({ wasm: url })`.");
	return options?.wasm === undefined ? loadDefault() : instantiate(await toModule(options.wasm));
}

// Same post-processing as oxc-parser's `wrap`: JSON can't carry BigInt or RegExp values, so oxc lists the literals to revive.
function parseProgram(json: string) {
	const { node, fixes } = JSON.parse(json);
	for (const path of fixes) {
		const lit = path.reduce((n: any, k: string | number) => n[k], node);
		if (lit.bigint) lit.value = BigInt(lit.bigint);
		else
			try {
				lit.value = RegExp(lit.regex.pattern, lit.regex.flags);
			} catch {}
	}
	return node;
}

/**
 * Loads oxc's WASM build and resolves to a synchronous parser for `typescript({ parser })`.
 * Works in browsers, workers, extensions, edge runtimes, Node and Bun, and produces the same tree as `oxcParser`.
 */
export async function createWasmParser(options?: CreateWasmParserOptions): Promise<Parser> {
	const binding = await load(options);
	return (filename, src) => {
		const r = binding.parseSync(filename, src);
		return { program: parseProgram(r.program), comments: r.comments, errors: r.errors };
	};
}
