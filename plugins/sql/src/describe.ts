import { D, type Doc, mk } from "@usenarrator/core";
import type { Engine, TsPlugin } from "@usenarrator/lang-ts";
import type { Statement } from "pgsql-ast-parser";
import { en } from "./en";
import { type Ctx, value } from "./expr";
import type { SqlParser } from "./parser";
import type { SqlPhrases } from "./phrases";
import type { SqlText } from "./source";
import { statement } from "./statements";

/** How the SQL sits in the JS: run as a step, used as a value, prepared for later, or held as text. */
export type SqlMode = "action" | "value" | "prepared" | "text";

function parseFirst<T>(attempts: string[], parse: (s: string) => T): T | null {
	for (const a of attempts) {
		try {
			return parse(a);
		} catch {}
	}
	return null;
}

type NarrateSql = { e: Engine; say: SqlPhrases; sql: SqlText; mode: SqlMode; parser: SqlParser | null };

/** English for a SQL text, always followed by the full SQL; unreadable SQL falls back to the SQL alone. */
export function narrateSql(p: NarrateSql): Doc {
	const shown = mk("c", p.sql.display);
	return readSql(p) ?? D(p.mode === "action" ? p.say.run.rawAction({ sql: shown }) : p.say.run.rawValue({ sql: shown }));
}

/** `narrateSql`, but null when there's no parser or the SQL doesn't parse. */
function readSql({ e, say, sql, mode, parser }: NarrateSql): Doc | null {
	const shown = mk("c", sql.display);
	if (!parser) return null;
	const c: Ctx = { e, say, params: sql.params, labels: sql.labels, aliases: new Map(), query: statement };
	const sqlLine = e.bullet(D(say.run.sql({ sql: shown })));
	const stmts = parseFirst(sql.attempts, parser.statements);
	if (stmts?.length) {
		try {
			return describeStatements({ c, stmts, mode, sqlLine });
		} catch {
			return null;
		}
	}
	const expr = parseFirst(sql.attempts, parser.expression);
	if (!expr) return null;
	try {
		return D(say.run.fragment({ value: value(c, expr) }), sqlLine);
	} catch {
		return null;
	}
}

function describeStatements({ c, stmts, mode, sqlLine }: { c: Ctx; stmts: Statement[]; mode: SqlMode; sqlLine: Doc["kids"] }): Doc {
	const { e, say } = c;
	if (stmts.length === 1) {
		const n = statement(c, stmts[0]!);
		const head =
			mode === "action"
				? n.action
				: mode === "value"
					? n.value
					: mode === "prepared"
						? say.run.prepared({ action: n.action })
						: say.run.text({ action: n.action });
		return D(head, [...n.items.flatMap((i) => e.bullet(i)), ...sqlLine]);
	}
	const count = e.g.formatNumber(stmts.length);
	const steps = stmts.map((s) => {
		const n = statement(c, s);
		return D(
			n.action,
			n.items.flatMap((i) => e.bullet(i)),
		);
	});
	const head = mode === "action" ? say.run.severalAction({ count }) : say.run.severalValue({ count });
	return D(head, [...steps.flatMap((s) => e.bullet(s)), ...sqlLine]);
}

const parsers = new WeakMap<TsPlugin, () => SqlParser | null>();

/** Lets `describeSql` find the parser of a loaded `sql()` plugin. */
export const registerParser = (plugin: TsPlugin, parser: () => SqlParser | null) => parsers.set(plugin, parser);

/**
 * For other plugins (e.g. Drizzle's `db.execute(sql\`...\`)`): narrate SQL in this plugin's words for the active locale.
 * Without `parser`, uses the parser of the `sql()` plugin loaded alongside, if any (else the SQL is shown as-is).
 */
export function describeSql(p: DescribeSql): Doc {
	return narrateSql(describeArgs(p));
}

/** `describeSql`, but null when the SQL can't be read (no parser loaded, or it doesn't parse), so callers can keep their own wording. */
export function tryDescribeSql(p: DescribeSql): Doc | null {
	return readSql(describeArgs(p));
}

type DescribeSql = { e: Engine; sql: SqlText; mode: SqlMode; parser?: SqlParser | null };

function describeArgs({ e, sql, mode, parser }: DescribeSql): NarrateSql {
	const say = e.phrasesFor({ name: "sql", phrases: { en } }) as SqlPhrases;
	const loaded = e.dialects.find((d) => parsers.has(d));
	return { e, say, sql, mode, parser: parser !== undefined ? parser : loaded ? (parsers.get(loaded)?.() ?? null) : null };
}
