import { parse } from "pgsql-ast-parser";
import type { SqlParser } from "./parser";

/** The Postgres parser (pgsql-ast-parser, pure JS, ~43 KB gzipped). Import this entry only where SQL narration is wanted. */
export const pgsqlParser: SqlParser = {
	statements: (sql) => parse(sql),
	expression: (sql) => parse(sql, "expr"),
};
