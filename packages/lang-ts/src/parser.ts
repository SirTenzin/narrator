export type ParseOutput = { program: any; comments: { type: string; value: string; start: number; end: number }[]; errors: unknown[] };

/** Parses TS/JS into an ESTree-compatible (oxc) AST. Pick `oxcParser` (Bun/Node) or `oxcWasmParser` (browsers). */
export type Parser = (filename: string, src: string) => ParseOutput;
