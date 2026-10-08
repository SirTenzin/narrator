import { D, type Doc, type Line } from "@narrate/core";
import { type N, unwrap } from "@narrate/lang-ts";
import { queryDoc } from "./query";
import { type Ctx, condition, entryDoc, isDb, isFn, isTx, keyName, literalString, val } from "./shared";

/** `db.transaction(async (tx) => { ... }, config)`: the callback's steps, as one all-or-nothing unit. */
export function transactionDoc(c: Ctx, { obj, args, stmt }: { obj: N | null; args: N[]; stmt: boolean }): Doc | null {
	const { e, say } = c;
	const fn = unwrap(args[0]);
	if (!obj || !isDb(e, obj) || !isFn(fn) || !takesTx(fn)) return null;
	const settings = transactionSettings(c, args[1]);
	const t = say.transaction;
	const title = isTx(e, obj) ? t.nested({ settings }) : stmt ? t.run({ settings }) : t.result({ settings });
	return D(title, fnSteps(c, fn));
}

/** Drizzle passes the transaction handle in; `bun:sqlite`'s `db.transaction(fn)` wraps arbitrary arguments instead. */
const takesTx = (fn: N) => fn.params.length === 1 && fn.params[0].type === "Identifier" && /^(tx|trx|t|transaction)\d*$|Tx\d*$/.test(fn.params[0].name);

function fnSteps(c: Ctx, fn: N): Line[] {
	const { e } = c;
	if (fn.body.type === "BlockStatement") return e.body(fn.body, 0);
	const u = unwrap(fn.body);
	return e.bullet(u.type === "CallExpression" ? e.call(u, true) : val(c, u));
}

function transactionSettings(c: Ctx, config: N): string[] {
	const { e, say } = c;
	const o = unwrap(config);
	if (o?.type !== "ObjectExpression") return config ? [val(c, config).t] : [];
	const t = say.transaction;
	return o.properties.flatMap((p: N): string[] => {
		const k = keyName(p);
		const v = literalString(p.value);
		if (k === "isolationLevel" && v) return [t.isolation({ level: v })];
		if (k === "accessMode" && v === "read only") return [t.readOnly];
		if (k === "accessMode" && v === "read write") return [t.readWrite];
		if (k === "deferrable" && unwrap(p.value).value === true) return [t.deferrable];
		if (!k) return [entryDoc(e, p).t];
		return [t.setting({ key: e.prop(k), value: val(c, p.value).t })];
	});
}

export const rollbackDoc = (c: Ctx, { obj }: { obj: N | null }): Doc | null => (obj && isTx(c.e, obj) ? D(c.say.transaction.rollback) : null);

/** `db.batch([q1, q2])`. */
export function batchDoc(c: Ctx, { obj, args, stmt }: { obj: N | null; args: N[]; stmt: boolean }): Doc | null {
	const { e, say } = c;
	if (!obj || !isDb(e, obj)) return null;
	const list = unwrap(args[0]);
	if (list?.type !== "ArrayExpression") {
		const q = val(c, args[0]);
		return D(say.transaction.batchOf({ queries: q.t }), q.kids);
	}
	return D(
		stmt ? say.transaction.batch : say.transaction.batchResult,
		list.elements.filter(Boolean).flatMap((x: N) => e.bullet(queryDoc(c, x) ?? val(c, x))),
	);
}

/** `db.$count(table, filter?)`. */
export function countDoc(c: Ctx, { obj, args }: { obj: N | null; args: N[] }): Doc | null {
	const { e, say } = c;
	if (!obj || !isDb(e, obj) || !args.length) return null;
	const table = val(c, args[0]);
	if (!args[1]) return D(say.aggregate.rowsIn({ table: table.t }), table.kids);
	const w = condition(c, args[1]);
	return D(say.aggregate.rowsInWhere({ table: table.t, condition: w.t }), [...table.kids, ...w.kids]);
}
