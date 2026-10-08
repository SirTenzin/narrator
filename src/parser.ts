export type ParseOutput = { program: any; comments: { type: string; value: string; start: number; end: number }[]; errors: unknown[] };
export type Parser = (filename: string, src: string) => ParseOutput;

let current: Parser | null = null;

/** Swap the parser implementation (native oxc in Bun/Node, oxc wasm in the browser extension). */
export const setParser = (p: Parser) => {
	current = p;
};

export const parse: Parser = (filename, src) => {
	if (!current) throw new Error("No parser configured: call setParser() first");
	return current(filename, src);
};
