import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";

/** A JS value bound to a SQL placeholder, rendered only when the narration mentions it. */
export type Param = () => string;

/** SQL text pulled out of JS: what to show, what to parse, and which JS value each placeholder stands for. */
export type SqlText = {
	/** The SQL as written (interpolations included), whitespace collapsed; never truncated. */
	display: string;
	/** Texts to try parsing, in order; they differ only in how interpolations are spelled. */
	attempts: string[];
	params: Map<string, Param>;
	/** Placeholder name -> how the source wrote it (`?`, `:id`), for unbound placeholders. */
	labels: Map<string, string>;
};

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

const SQL_START =
	/^\s*\(?\s*(select|insert\s+(or\s+\w+\s+)?into|update\s|delete\s+from|with\s|create\s|alter\s|drop\s|truncate\s|begin\b|commit\b|rollback\b|start\s+transaction|savepoint\s|release\s|explain\s|values\s*\(|replace\s+into|merge\s+into|lock\s+table|grant\s|revoke\s|vacuum\b|analyze\b|pragma\s|set\s+(local\s+|session\s+)?\w+\s*(=|to)\b|refresh\s+materialized)/i;

/** Text that starts like a SQL statement; guards rules that read plain strings. */
export const looksLikeSql = (s: string) => SQL_START.test(s);

/** The string value of a literal or an interpolation-free template, else null. */
export function stringValue(n: N): string | null {
	const u = unwrap(n);
	if (u?.type === "Literal" && typeof u.value === "string") return u.value;
	if (u?.type === "TemplateLiteral" && !u.expressions.length) return u.quasis[0].value.cooked;
	return null;
}

/**
 * A template's SQL: `${x}` becomes `$k` (attempt 1) or the identifier `__argk` (attempt 2, for
 * interpolated table/column names). Nested SQL templates are inlined so fragments parse as one statement.
 */
export function fromTemplate({ e, quasi, isSqlTag, binding }: { e: Engine; quasi: N; isSqlTag: (n: N) => boolean; binding?: Binding }): SqlText {
	const params = new Map<string, Param>();
	let k = 0;
	const build = (q: N): [string, string] => {
		let dollar = "";
		let ident = "";
		q.quasis.forEach((part: N, i: number) => {
			dollar += part.value.cooked ?? part.value.raw;
			ident += part.value.cooked ?? part.value.raw;
			const x = q.expressions[i];
			if (!x) return;
			const inner = unwrap(x);
			if (isSqlTag(inner)) {
				const [d, id] = build(inner.quasi);
				dollar += d;
				ident += id;
				return;
			}
			k++;
			const value: Param = () => e.text(identifierHelper(inner) ?? x);
			params.set(`$${k}`, value);
			params.set(`__arg${k}`, value);
			dollar += `$${k}`;
			ident += `__arg${k}`;
		});
		return [dollar, ident];
	};
	const [dollar, ident] = build(quasi);
	const display = collapse(e.code(quasi).slice(1, -1));
	if (!binding) return { display, attempts: [dollar, ident], params, labels: new Map() };
	// An untagged template is a string handed to a driver: it may also hold driver placeholders.
	const { sql, labels } = normalize(ident);
	bind({ labels, binding, params });
	return { display, attempts: [sql], params, labels };
}

/** postgres.js `${sql(table)}` / `${sql("name")}`: the name inside the helper. */
const identifierHelper = (n: N): N | null =>
	n.type === "CallExpression" && unwrap(n.callee).type === "Identifier" && unwrap(n.callee).name === "sql" && n.arguments.length === 1 ? n.arguments[0] : null;

/** How a driver call binds its placeholders: positional values and/or an object of named ones. */
export type Binding = { positional: (index: number) => Param | null; named: (name: string) => Param | null };

/** SQL from a plain string, with driver placeholders (`$1`, `?`, `?2`, `:id`, `@id`, `$id`) bound to JS values. */
export function fromString({ text, binding }: { text: string; binding: Binding }): SqlText {
	const { sql, labels } = normalize(text);
	const params = new Map<string, Param>();
	bind({ labels, binding, params });
	return { display: collapse(text), attempts: [sql], params, labels };
}

function bind({ labels, binding, params }: { labels: Map<string, string>; binding: Binding; params: Map<string, Param> }) {
	let question = 0;
	for (const [name, label] of labels) {
		const p =
			label === "?" ? binding.positional(question++) : /^[$?]\d+$/.test(label) ? binding.positional(Number(label.slice(1)) - 1) : binding.named(label.slice(1));
		if (p) params.set(name, p);
	}
}

/**
 * Rewrites driver placeholders to Postgres `$n` (skipping strings, quoted names, and comments) and
 * MySQL backtick names to double quotes, so one Postgres parser reads SQLite/MySQL-style SQL too.
 */
export function normalize(text: string): { sql: string; labels: Map<string, string> } {
	const labels = new Map<string, string>();
	const used = [...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
	const questionMarks = used.length === 0;
	let next = Math.max(0, ...used);
	let out = "";
	let i = 0;
	const take = (end: number) => {
		out += text.slice(i, end);
		i = end;
	};
	const until = (close: string, from: number) => {
		const j = text.indexOf(close, from);
		return j < 0 ? text.length : j + close.length;
	};
	const placeholder = (label: string, len: number) => {
		const name = `$${++next}`;
		labels.set(name, label);
		out += name;
		i += len;
	};
	while (i < text.length) {
		const ch = text[i]!;
		const rest = text.slice(i);
		if (ch === "'") take(skipQuoted(text, i, "'"));
		else if (ch === '"') take(skipQuoted(text, i, '"'));
		else if (ch === "`") {
			const end = until("`", i + 1);
			out += `"${text.slice(i + 1, end - 1)}"`;
			i = end;
		} else if (rest.startsWith("--")) take(until("\n", i));
		else if (rest.startsWith("/*")) take(until("*/", i + 2));
		else if (ch === "$") {
			const dq = /^\$([A-Za-z_]\w*)?\$/.exec(rest);
			const num = /^\$(\d+)/.exec(rest);
			const named = /^\$([A-Za-z_]\w*)/.exec(rest);
			if (dq) take(until(dq[0], i + dq[0].length));
			else if (num) {
				labels.set(num[0], num[0]);
				take(i + num[0].length);
			} else if (named) placeholder(named[0], named[0].length);
			else take(i + 1);
		} else if (ch === "?" && questionMarks) {
			const num = /^\?(\d+)/.exec(rest);
			placeholder(num ? num[0] : "?", num ? num[0].length : 1);
		} else if (ch === ":" && text[i + 1] === ":") take(i + 2);
		else if ((ch === ":" || ch === "@") && /^[:@][A-Za-z_]\w*/.test(rest) && !/[\w:]/.test(text[i - 1] ?? "")) {
			const m = /^[:@][A-Za-z_]\w*/.exec(rest)!;
			placeholder(m[0], m[0].length);
		} else take(i + 1);
	}
	return { sql: out, labels };
}

/** End of a quoted run starting at `i`, where a doubled quote is an escaped one. */
function skipQuoted(text: string, i: number, q: string): number {
	let j = i + 1;
	while (j < text.length) {
		if (text[j] === q && text[j + 1] === q) j += 2;
		else if (text[j] === q) return j + 1;
		else j++;
	}
	return j;
}

export const noParams: Binding = { positional: () => null, named: () => null };

/** A plain `{ key: value }` object's property, looked up with or without the placeholder prefix. */
function namedFrom(e: Engine, obj: N): Binding["named"] {
	return (name) => {
		const p = obj.properties.find((p: N) => {
			if (p.type !== "Property" || p.computed) return false;
			const key = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
			return key === name || key.slice(1) === name;
		});
		return p ? () => e.text(p.value) : null;
	};
}

/** `pool.query(text, values)`: one argument holds every value. */
export function arrayBinding(e: Engine, values: N | undefined): Binding {
	const u = unwrap(values);
	if (!u) return noParams;
	if (u.type === "ArrayExpression") return { positional: (i) => (u.elements[i] ? () => e.text(u.elements[i]) : null), named: () => null };
	if (u.type === "ObjectExpression") return { positional: () => null, named: namedFrom(e, u) };
	return { positional: (i) => () => e.say.expressions.member.nthOf({ value: e.text(values), position: e.g.formatNumber(i + 1) }), named: () => null };
}

/** `stmt.get(a, b)` / `$queryRawUnsafe(sql, a, b)`: values as separate arguments (or one array/object). */
export function restBinding(e: Engine, args: N[]): Binding {
	const only = args.length === 1 ? unwrap(args[0]) : null;
	if (only?.type === "ArrayExpression" || only?.type === "ObjectExpression") return arrayBinding(e, only);
	return { positional: (i) => (args[i] ? () => e.text(args[i]) : null), named: () => null };
}
