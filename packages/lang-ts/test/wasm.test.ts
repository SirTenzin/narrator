import { describe, expect, test } from "bun:test";
import { createNarrator, renderText } from "@usenarrator/core";
import { typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { createWasmParser } from "@usenarrator/lang-ts/wasm";
import { en } from "@usenarrator/locale-en";

const wasmPath = Bun.resolveSync("@usenarrator/lang-ts/wasm.wasm", import.meta.dir);
const SRC = "const big = 2n ** 64n;\nexport const isId = (s: string) => /^cus_[a-z0-9]+$/i.test(s);\n";
const narrate = (parser: typeof oxcParser) => renderText(createNarrator({ languages: [typescript({ parser })], locale: en }).narrate(SRC, "a.ts").lines);
const ast = (parser: typeof oxcParser) => {
	const { program, comments, errors } = parser("a.ts", SRC);
	return JSON.stringify({ program, comments, errors }, (_k, v) => (typeof v === "bigint" ? `${v}n` : v instanceof RegExp ? String(v) : v));
};

describe("createWasmParser", () => {
	test("finds the installed .wasm on its own and matches the native parser", async () => {
		const parser = await createWasmParser();
		expect(ast(parser)).toBe(ast(oxcParser));
		expect(narrate(parser)).toBe(narrate(oxcParser));
	});

	test("accepts a URL, bytes, a Response or a compiled module", async () => {
		const bytes = await Bun.file(wasmPath).arrayBuffer();
		const sources = [Bun.pathToFileURL(wasmPath), new Uint8Array(bytes), new Response(bytes), await WebAssembly.compile(bytes)];
		for (const wasm of sources) expect(narrate(await createWasmParser({ wasm }))).toBe(narrate(oxcParser));
	});

	test("an HTML page instead of the .wasm says so", async () => {
		const page = new Response("<!doctype html><html><body>app</body></html>", { headers: { "content-type": "text/html" } });
		expect(createWasmParser({ wasm: page })).rejects.toThrow(/not a WebAssembly file \(it starts with HTML/);
	});

	test("the wrong kind of value says what to pass", async () => {
		expect(createWasmParser({ wasm: 42 as any })).rejects.toThrow(/`wasm` must be a URL, a Response, the file's bytes or a WebAssembly.Module, but got number/);
		expect(createWasmParser({ wasm: { default: "x.wasm" } as any })).rejects.toThrow(/module namespace object. Pass its default export/);
		expect(createWasmParser("x.wasm" as any)).rejects.toThrow(/takes an options object/);
	});
});

describe("typescript({ parser }) checks its parser", () => {
	test("a Promise (forgot await)", () => {
		expect(() => typescript({ parser: createWasmParser() as any })).toThrow(/got a Promise; await createWasmParser\(\)/);
	});

	test("the factory itself instead of its result", () => {
		const narrator = createNarrator({ languages: [typescript({ parser: createWasmParser as any })], locale: en });
		const { problems } = narrator.narrate("let a = 1;", "a.ts");
		expect(problems[0]?.message).toMatch(/returned a Promise; pass the result of `await createWasmParser\(\)`/);
	});

	test("something that is not a parser", () => {
		expect(() => typescript({ parser: {} as any })).toThrow(/needs a function, but got object/);
	});
});
