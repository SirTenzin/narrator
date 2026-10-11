import type { Doc } from "@usenarrator/core";
import { type CallRule, definePlugin, type Engine, type MemberRule, type N, type StmtRule, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { narrateSql, registerParser, type SqlMode } from "./describe";
import { en } from "./en";
import { memoized, type ParserSource, resolveParser, type SqlParser } from "./parser";
import type { SqlPhrases } from "./phrases";
import { arrayBinding, type Binding, fromString, fromTemplate, looksLikeSql, noParams, restBinding, type SqlText, stringValue } from "./source";

export { describeSql, type SqlMode, tryDescribeSql } from "./describe";
export { en } from "./en";
export type { ParserSource, SqlParser } from "./parser";
export type { DropKind, JoinKind, LockKind, RefAction, SqlPhrases } from "./phrases";
export type { Binding, Param, SqlText } from "./source";
export { arrayBinding, fromString, fromTemplate, looksLikeSql, restBinding } from "./source";

export type SqlOptions = {
	/** Without a parser the plugin still claims SQL call sites but shows the SQL as-is. Pass a getter to load it lazily. */
	parser?: ParserSource;
};

type P = SqlPhrases;

const DB_NAME = /^(db|database|pool|client|conn|connection|pg|sql|sqlite|mysql|tx|trx|txn|transaction|neon|prisma)$/i;
const DB_SUFFIX = /(Db|DB|Pool|Client|Conn|Connection|Database|Tx|Sql|SQL)$/;

/** The receiver looks like a database handle: `db`, `pool`, `this.client`, `ctx.readDb`. */
function isDb(e: Engine, n: N | null): boolean {
	if (!n) return false;
	const last =
		e
			.code(n)
			.replace(/\(\)$/, "")
			.split(/[.?!]+/)
			.at(-1) ?? "";
	return DB_NAME.test(last) || DB_SUFFIX.test(last);
}

/** Template tags this plugin reads, by the tag's last segment (with its receiver when it matters). */
function tagKind(tag: N): "sql" | "prisma" | "slonik" | null {
	const t = unwrap(tag);
	if (t.type === "Identifier") return t.name === "sql" ? "sql" : null;
	if (t.type !== "MemberExpression" || t.computed) return null;
	const prop = t.property.name;
	const obj = unwrap(t.object);
	if (prop === "$queryRaw" || prop === "$executeRaw") return "prisma";
	if (prop === "sql") return "sql";
	if ((prop === "unsafe" || prop === "fragment") && obj.type === "Identifier" && obj.name === "sql") return "slonik";
	return null;
}

const isSqlTag = (n: N) => unwrap(n)?.type === "TaggedTemplateExpression" && tagKind(unwrap(n).tag) !== null;

const isDrizzleModule = (m: string | undefined) => !!m && (m === "drizzle-orm" || m.startsWith("drizzle-orm/"));

/** A `sql` tag imported from Drizzle (`import { sql }` or `import * as orm` then `orm.sql`). */
function isDrizzleTag(e: Engine, tag: N): boolean {
	const t = unwrap(tag);
	if (t.type === "Identifier") return isDrizzleModule(e.imports.get(t.name)?.from);
	const obj = t.type === "MemberExpression" && !t.computed ? unwrap(t.object) : null;
	return obj?.type === "Identifier" && isDrizzleModule(e.imports.get(obj.name)?.from);
}

/** Identifiers declared in this file whose value is SQL text or a prepared statement. */
type FileState = { src: string; texts: Map<string, N>; prepared: Map<string, N> };

// Engine rule keys for tagged templates on a plain identifier include the identifier (`prisma.$queryRaw`), so common handle names are listed.
const HANDLES = ["prisma", "db", "tx", "trx", "client", "database", "pool", "conn", "neon", "ctx"];
const TEMPLATE_KEYS = ["sql``", "*.sql``", "Bun.sql``", "Prisma.sql``", "sql.unsafe``", "sql.fragment``", "*.$queryRaw``", "*.$executeRaw``"].concat(
	HANDLES.flatMap((h) => [`${h}.$queryRaw\`\``, `${h}.$executeRaw\`\``, `${h}.sql\`\``]),
);
const RUN_METHODS = ["get", "all", "run", "values", "iterate"];

/** SQL in TS/JS (tagged templates, driver calls, prepared statements, SQL constants) narrated clause by clause, with the full SQL kept. */
export const sql = ({ parser }: SqlOptions = {}): TsPlugin<P> => {
	const files = new WeakMap<Engine, FileState>();
	const state = (e: Engine): FileState => {
		const cur = files.get(e);
		if (cur?.src === e.src) return cur;
		const fresh = { src: e.src, texts: new Map(), prepared: new Map() };
		files.set(e, fresh);
		return fresh;
	};
	const memos = new WeakMap<SqlParser, SqlParser>();
	const currentParser = () => {
		const p = resolveParser(parser);
		if (!p) return null;
		if (!memos.has(p)) memos.set(p, memoized(p));
		return memos.get(p)!;
	};
	const narrate = ({ e, say, text, mode }: { e: Engine; say: P; text: SqlText; mode: SqlMode }) =>
		narrateSql({ e, say, sql: text, mode, parser: currentParser() });

	/** SQL handed to a driver: a string, a template, a SQL constant, a SQL tag, or pg's `{ text, values }`. */
	const sqlOf = (e: Engine, node: N | undefined, binding: Binding): SqlText | null => {
		const u = unwrap(node);
		if (!u) return null;
		const s = stringValue(u);
		if (s !== null) return looksLikeSql(s) ? fromString({ text: s, binding }) : null;
		if (u.type === "TemplateLiteral") {
			const t = fromTemplate({ e, quasi: u, isSqlTag, binding });
			return looksLikeSql(t.display) ? t : null;
		}
		if (isSqlTag(u)) return drizzles(e, u) ? null : templateText(e, u);
		if (u.type === "Identifier") {
			const known = state(e).texts.get(u.name);
			return known ? sqlOf(e, known, binding) : null;
		}
		if (u.type === "ObjectExpression") {
			const prop = (k: string) => u.properties.find((p: N) => p.type === "Property" && !p.computed && (p.key.name ?? p.key.value) === k)?.value;
			const text = prop("text") ?? prop("sql");
			return text ? sqlOf(e, text, arrayBinding(e, prop("values"))) : null;
		}
		return null;
	};

	/** Drizzle's `sql` template is Drizzle's to describe when the Drizzle plugin is loaded. */
	const drizzles = (e: Engine, node: N) => tagKind(node.tag) === "sql" && isDrizzleTag(e, node.tag) && e.dialects.some((d) => d.name === "drizzle");

	const templateText = (e: Engine, node: N): SqlText => fromTemplate({ e, quasi: unwrap(node).quasi, isSqlTag });

	/** A tagged template we read, or null when it's Drizzle's (or not ours). */
	const template = (e: Engine, say: P, node: N, mode: SqlMode): Doc | null => {
		if (!tagKind(node.tag) || drizzles(e, node)) return null;
		return narrate({ e, say, text: templateText(e, node), mode });
	};

	const templateRule: CallRule<P> = ({ node, e, say }) => template(e, say, node, "value");

	/** `pool.query(text, values)`, `conn.execute(text, values)`, `sql.unsafe(text, values)`; bun:sqlite's `db.query` only prepares. */
	const driverRule =
		(prepares = false): CallRule<P> =>
		({ node, args, obj, e, stmt, say }) => {
			const target = unwrap(obj);
			if (target?.type === "TaggedTemplateExpression") return template(e, say, target, stmt ? "action" : "value");
			if (!isDb(e, obj)) return null;
			const text = sqlOf(e, args[0], arrayBinding(e, args[1]));
			if (!text) return null;
			const method = unwrap(node.callee).property.name;
			const prepare = prepares || (method === "query" && e.usesLibrary("bun:sqlite"));
			return narrate({ e, say, text, mode: prepare ? "prepared" : stmt ? "action" : "value" });
		};

	/** `db.run(text, ...values)` / `db.exec(text)` / `prisma.$queryRawUnsafe(text, ...values)`: values follow the SQL. */
	const restRule: CallRule<P> = ({ args, obj, e, stmt, say }) => {
		if (!isDb(e, obj)) return null;
		const text = sqlOf(e, args[0], restBinding(e, args.slice(1)));
		return text ? narrate({ e, say, text, mode: stmt ? "action" : "value" }) : null;
	};

	/** `db.prepare(text).get(a)` and `stmt.all(a)` where `stmt` was prepared in this file. */
	const runRule: CallRule<P> = (ctx) => {
		const { args, obj, e, stmt, say } = ctx;
		const target = unwrap(obj);
		let source: N | undefined;
		if (target?.type === "CallExpression" && unwrap(target.callee).type === "MemberExpression") {
			const callee = unwrap(target.callee);
			if (["prepare", "query"].includes(callee.property?.name) && isDb(e, callee.object)) source = target.arguments[0];
		} else if (target?.type === "Identifier") source = state(e).prepared.get(target.name);
		if (source) {
			const text = sqlOf(e, source, restBinding(e, args));
			if (text) return narrate({ e, say, text, mode: stmt ? "action" : "value" });
		}
		return ctx.node.callee.property?.name === "run" ? restRule(ctx) : null;
	};

	/** Remembers SQL constants and prepared statements; narrates `const Q = "select ..."` itself. Bare `await sql\`...\`` reads as an action. */
	const statements: StmtRule<P> = ({ node, e, d, say }) => {
		if (node.type === "ExpressionStatement") {
			const x = unwrap(node.expression);
			if (x?.type !== "TaggedTemplateExpression") return false;
			const doc = template(e, say, x, "action");
			if (!doc) return false;
			e.emitDoc(d, doc, node);
			return true;
		}
		if (node.type !== "VariableDeclaration") return false;
		for (const v of node.declarations) {
			if (v.id.type !== "Identifier" || !v.init) continue;
			const init = unwrap(v.init);
			const s = stringValue(init);
			if (s !== null && looksLikeSql(s)) state(e).texts.set(v.id.name, init);
			const callee = init.type === "CallExpression" ? unwrap(init.callee) : null;
			if (callee?.type === "MemberExpression" && ["prepare", "query"].includes(callee.property?.name) && isDb(e, callee.object))
				state(e).prepared.set(v.id.name, init.arguments[0]);
		}
		const only = node.declarations.length === 1 ? node.declarations[0] : null;
		const text = only?.id.type === "Identifier" && only.init ? stringValue(only.init) : null;
		if (!only || text === null || !looksLikeSql(text) || !currentParser()) return false;
		const doc = narrate({ e, say, text: fromString({ text, binding: noParams }), mode: "text" });
		if (!doc.kids.length) return false;
		e.emitDoc(d, { t: e.say.declarations.let({ name: e.ref(only.id.name), value: doc.t }), kids: doc.kids }, node);
		return true;
	};

	/** `(await pool.query(sql)).rows` / `(await db.execute(sql\`...\`)).rows`: the rows the query reads are the query's value. */
	const rowsOf: MemberRule<P> = ({ obj, e }) => {
		const o = unwrap(obj);
		const call = unwrap(o?.type === "AwaitExpression" ? o.argument : o);
		const callee = call?.type === "CallExpression" ? unwrap(call.callee) : null;
		if (callee?.type !== "MemberExpression" || !["query", "execute"].includes(callee.property?.name) || !isDb(e, callee.object)) return null;
		return e.applyRulesQuiet(call) ? e.noun(call) : null;
	};

	const plugin = definePlugin({
		name: "sql",
		phrases: { en },
		calls: {
			...Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, templateRule])),
			"*.query": driverRule(),
			"*.execute": driverRule(),
			"*.unsafe": driverRule(),
			"*.prepare": driverRule(true),
			"*.$queryRawUnsafe": restRule,
			"*.$executeRawUnsafe": restRule,
			"*.exec": restRule,
			...Object.fromEntries(RUN_METHODS.map((m) => [`*.${m}`, runRule])),
		},
		members: { "*.rows": rowsOf },
		statements: [statements],
	});
	registerParser(plugin, currentParser);
	return plugin;
};
