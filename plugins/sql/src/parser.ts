import type { Expr, Statement } from "pgsql-ast-parser";

export type { Expr, Statement };

/** Turns SQL text into a pgsql-ast-parser AST; both methods throw on SQL they can't read. */
export type SqlParser = {
	statements: (sql: string) => Statement[];
	expression: (sql: string) => Expr;
};

/** A parser, or a getter for one that loads lazily (null until it's ready). */
export type ParserSource = SqlParser | (() => SqlParser | null | undefined);

export const resolveParser = (src: ParserSource | undefined): SqlParser | null => (typeof src === "function" ? (src() ?? null) : (src ?? null));

/** Memoizes a parser (results and failures) so re-narrating the same SQL doesn't parse it again. */
export function memoized(parser: SqlParser, limit = 500): SqlParser {
	const memo = <T>(parse: (sql: string) => T) => {
		const seen = new Map<string, { ok: T } | { err: unknown }>();
		return (sql: string): T => {
			let hit = seen.get(sql);
			if (!hit) {
				try {
					hit = { ok: parse(sql) };
				} catch (err) {
					hit = { err };
				}
				if (seen.size >= limit) seen.delete(seen.keys().next().value!);
				seen.set(sql, hit);
			}
			if ("err" in hit) throw hit.err;
			return hit.ok;
		};
	};
	return { statements: memo(parser.statements), expression: memo(parser.expression) };
}
