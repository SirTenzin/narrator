import { D, type Doc, mk } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import type { PrismaPhrases } from "./phrases";

export type Ctx = { e: Engine; say: PrismaPhrases };

export const keyName = (p: N): string | null => {
	if (p?.type !== "Property" || p.computed) return null;
	if (p.key.type === "Identifier") return p.key.name;
	if (p.key.type === "Literal") return String(p.key.value);
	return null;
};

export const literalString = (n: N): string | null => {
	const u = unwrap(n);
	if (u?.type === "Literal" && typeof u.value === "string") return u.value;
	if (u?.type === "TemplateLiteral" && !u.expressions.length) return u.quasis[0].value.cooked;
	return null;
};

export const isTrue = (n: N) => {
	const u = unwrap(n);
	return u?.type === "Literal" && u.value === true;
};

export const isNullLit = (n: N) => {
	const u = unwrap(n);
	return u?.type === "Literal" && u.value === null && !u.regex;
};

export const isFn = (n: N) => ["ArrowFunctionExpression", "FunctionExpression"].includes(unwrap(n)?.type);

/** The value of `key` in an object literal. */
export const prop = (o: N, key: string): N | undefined => unwrap(o)?.properties?.find((p: N) => keyName(p) === key)?.value;

/** Items of an array literal, or the node itself. */
export const items = (n: N): N[] => {
	const u = unwrap(n);
	return u?.type === "ArrayExpression" ? u.elements.filter(Boolean) : [n];
};

/** An object entry the plugin doesn't interpret, rendered by the engine (spreads included). */
export const entryDoc = (e: Engine, p: N): Doc => (p.type === "SpreadElement" ? e.noun(p) : e.objectProp(p));

/** A phrase over a block: inline when it is one short line, otherwise a heading with bullets. */
export function withKids(c: Ctx, head: string, kids: Doc[]): Doc {
	return D(
		head,
		kids.flatMap((k) => c.e.bullet(k)),
	);
}

const IMPORT_SOURCE = /(^|[/@])prisma([/-]|$)|generated\/prisma|\.prisma\/client/;

/** The file uses Prisma: it imports `@prisma/client`, a generated client, a `prisma` module, or `PrismaClient`; or its package depends on Prisma. */
export function active(e: Engine): boolean {
	if (e.usesLibrary("@prisma/client") || e.usesLibrary("prisma")) return true;
	for (const [local, { from, name }] of e.imports) if (IMPORT_SOURCE.test(from) || name === "PrismaClient" || local === "prisma") return true;
	return false;
}

const HANDLE = /prisma|^(db|tx|trx|database|transaction)$|(Db|DB|Tx)$/;

const lastSegment = (n: N): string => {
	const u = unwrap(n);
	if (u?.type === "Identifier") return u.name;
	if (u?.type === "MemberExpression" && !u.computed) return u.property.name;
	if (u?.type === "ThisExpression") return "this";
	return "";
};

/** The receiver looks like a Prisma client or transaction handle: `prisma`, `ctx.prisma`, `this.prismaService`, `db`, `tx`; not a generic `client`. */
export const isHandle = (n: N) => HANDLE.test(lastSegment(n));

export const MODEL_METHODS = [
	"findMany",
	"findFirst",
	"findFirstOrThrow",
	"findUnique",
	"findUniqueOrThrow",
	"create",
	"createMany",
	"createManyAndReturn",
	"update",
	"updateMany",
	"updateManyAndReturn",
	"upsert",
	"delete",
	"deleteMany",
	"count",
	"aggregate",
	"groupBy",
] as const;
export type ModelMethod = (typeof MODEL_METHODS)[number];

export type ModelCall = { model: string; method: ModelMethod; opts: N };

/** `prisma.user.findMany({...})` -> model `user`, method `findMany`. Drizzle's `db.query.users` and `$`-prefixed members are not models. */
export function modelCall(e: Engine, node: N, obj: N | null): ModelCall | null {
	const o = unwrap(obj);
	if (o?.type !== "MemberExpression" || o.computed) return null;
	const model = o.property.name as string;
	if (!/^[a-zA-Z][A-Za-z0-9_]*$/.test(model) || model === "query" || !isHandle(o.object) || !active(e)) return null;
	const method = unwrap(unwrap(node).callee).property.name as ModelMethod;
	const args = unwrap(node).arguments;
	if (args.length > 1) return null;
	const opts = unwrap(args[0]);
	if (opts && !["ObjectExpression", "Identifier", "MemberExpression"].includes(opts.type)) return null;
	return { model, method, opts: args[0] ?? null };
}

/** `user` -> "users", linked to the model name. */
export const tableOf = (e: Engine, model: string) => mk("v", e.g.plural(e.lex.humanize(model)), model);
