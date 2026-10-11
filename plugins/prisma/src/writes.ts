import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { whereDoc } from "./filters";
import { optionDocs, rowsWithOptions } from "./options";
import { type Ctx, entryDoc, isTrue, items, keyName, type ModelCall, prop, tableOf } from "./shared";

const ATOMIC = new Set(["increment", "decrement", "multiply", "divide", "set", "push", "unset"]);
const NESTED = new Set(["create", "createMany", "connect", "connectOrCreate", "disconnect", "set", "update", "updateMany", "upsert", "delete", "deleteMany"]);

const onlyKeys = (o: N, set: Set<string>) => o.properties.length > 0 && o.properties.every((p: N) => set.has(keyName(p) ?? ""));

/** The fields of a `data` object, one bullet each; nested writes and number updates read as what they do. */
export function dataDocs(c: Ctx, data: N): Doc[] {
	const { e, say } = c;
	const o = unwrap(data);
	if (o?.type !== "ObjectExpression") {
		const v = e.noun(data);
		return [D(say.write.valuesFrom({ value: v.t }), v.kids)];
	}
	return o.properties.flatMap((p: N): Doc[] => {
		const k = keyName(p);
		const v = unwrap(p.value);
		if (!k) return [entryDoc(e, p)];
		const key = e.prop(k);
		if (v?.type === "ObjectExpression" && v.properties.length === 1 && onlyKeys(v, ATOMIC) && !isRelationWrite(v)) return [atomicDoc(c, key, v.properties[0])];
		if (v?.type === "ObjectExpression" && onlyKeys(v, NESTED)) return v.properties.map((x: N) => nestedDoc(c, key, x));
		return [entryDoc(e, p)];
	});
}

/** `{ set: [...] }` / `{ set: { id } }` on a relation is a nested write, not a scalar set. */
const isRelationWrite = (o: N) => keyName(o.properties[0]) === "set" && ["ArrayExpression", "ObjectExpression"].includes(unwrap(o.properties[0].value)?.type);

function atomicDoc(c: Ctx, key: string, p: N): Doc {
	const { e, say } = c;
	const op = keyName(p) as "increment" | "decrement" | "multiply" | "divide" | "set" | "push" | "unset";
	if (op === "unset") return D(say.data.unset({ key }));
	const v = e.noun(p.value);
	return D(say.data[op]({ key, value: v.t }), v.kids);
}

/** A nested write on a relation: `posts: { create: [...] }`, `author: { connect: { id } }`, ... */
function nestedDoc(c: Ctx, relation: string, p: N): Doc {
	const { e, say } = c;
	const op = keyName(p)!;
	const v = unwrap(p.value);
	const block = (head: string, docs: Doc[]) =>
		D(
			head,
			docs.flatMap((d) => e.bullet(d)),
		);
	const rows = (head: string, node: N = v) => {
		const list = items(node);
		if (list.length === 1 && unwrap(list[0])?.type !== "ArrayExpression") return block(head, dataDocs(c, list[0]));
		return block(
			head,
			list.map((x) => block(say.write.row, dataDocs(c, x))),
		);
	};
	if (op === "create") return rows(unwrap(v)?.type === "ArrayExpression" ? say.data.createManyRelated({ relation }) : say.data.createRelated({ relation }));
	if (op === "createMany") {
		const data = prop(v, "data");
		return data ? rows(say.data.createManyRelated({ relation }), data) : D(say.data.createManyRelated({ relation }));
	}
	if (op === "connect") {
		if (v?.type === "ArrayExpression")
			return block(
				say.data.connectEach({ relation }),
				v.elements.map((x: N) => whereDoc(c, x)),
			);
		const w = whereDoc(c, v);
		return D(say.data.connect({ relation, condition: w.t }), w.kids);
	}
	if (op === "connectOrCreate") {
		const kids = items(v).flatMap((x) => {
			const where = prop(x, "where");
			const create = prop(x, "create");
			const out: Doc[] = [];
			if (where) {
				const w = whereDoc(c, where);
				out.push(D(say.options.where({ condition: w.t }), w.kids));
			}
			if (create) out.push(block(say.write.ifMissing, dataDocs(c, create)));
			return out;
		});
		return block(say.data.connectOrCreate({ relation }), kids);
	}
	if (op === "disconnect") {
		if (isTrue(v)) return D(say.data.disconnect({ relation }));
		if (v?.type === "ArrayExpression")
			return block(
				say.data.disconnectEach({ relation }),
				v.elements.map((x: N) => whereDoc(c, x)),
			);
		const w = whereDoc(c, v);
		return D(say.data.disconnectWhere({ relation, condition: w.t }), w.kids);
	}
	if (op === "set") {
		if (v?.type === "ArrayExpression" && !v.elements.length) return D(say.data.clearRelated({ relation }));
		const x = e.noun(v);
		return D(say.data.setRelated({ relation, value: x.t }), x.kids);
	}
	if (op === "update" || op === "updateMany") {
		const kids = items(v).flatMap((x) => (prop(x, "data") ? writeKids(c, x) : dataDocs(c, x)));
		return block(say.data.updateRelated({ relation }), kids);
	}
	if (op === "upsert")
		return block(
			say.data.upsertRelated({ relation }),
			items(v).flatMap((x) => upsertKids(c, x)),
		);
	if (op === "delete" || op === "deleteMany") {
		if (isTrue(v) || (v?.type === "ObjectExpression" && !v.properties.length)) return D(say.data.deleteRelated({ relation }));
		const w = whereDoc(c, v);
		return D(say.data.deleteRelatedWhere({ relation, condition: w.t }), w.kids);
	}
	const x = e.noun(v);
	return D(say.data.other({ relation, action: e.prop(op), value: x.t }), x.kids);
}

/** `{ where, data }` of an update: the filter, then the fields. */
function writeKids(c: Ctx, o: N): Doc[] {
	const { say } = c;
	const where = prop(o, "where");
	const out: Doc[] = [];
	if (where) {
		const w = whereDoc(c, where);
		out.push(D(say.options.where({ condition: w.t }), w.kids));
	}
	return [...out, ...dataDocs(c, prop(o, "data"))];
}

function upsertKids(c: Ctx, o: N): Doc[] {
	const { e, say } = c;
	const out: Doc[] = [];
	const where = prop(o, "where");
	if (where) {
		const w = whereDoc(c, where);
		out.push(D(say.options.where({ condition: w.t }), w.kids));
	}
	const update = prop(o, "update");
	const create = prop(o, "create");
	if (update)
		out.push(
			D(
				say.write.ifFound,
				dataDocs(c, update).flatMap((d) => e.bullet(d)),
			),
		);
	if (create)
		out.push(
			D(
				say.write.ifMissing,
				dataDocs(c, create).flatMap((d) => e.bullet(d)),
			),
		);
	return out;
}

const WRITE_KEYS = new Set(["data", "where", "create", "update", "skipDuplicates"]);

/** The options a write takes besides its data, like `select` and `include`. */
const extraOptions = (c: Ctx, o: N) => optionDocs(c, o, WRITE_KEYS).map((x) => x.doc);

/** `create` / `createMany` / `createManyAndReturn`. */
export function createDoc(c: Ctx, call: ModelCall, stmt: boolean): Doc {
	const { e, say } = c;
	const table = tableOf(e, call.model);
	const o = unwrap(call.opts);
	const many = call.method !== "create";
	const returning = call.method === "createManyAndReturn";
	const action = many ? say.write.createMany({ table }) : say.write.create({ table });
	const head = stmt ? action : returning ? say.write.createdManyReturning({ table }) : many ? say.write.affected({ action }) : say.write.created({ table });
	if (o?.type !== "ObjectExpression") return D(head, call.opts ? e.bullet(D(say.write.valuesFrom({ value: e.text(call.opts) }))) : []);
	const data = prop(o, "data");
	const kids: Doc[] = [];
	if (data && many && unwrap(data)?.type === "ArrayExpression")
		kids.push(
			...unwrap(data).elements.map((x: N) =>
				D(
					say.write.row,
					dataDocs(c, x).flatMap((d) => e.bullet(d)),
				),
			),
		);
	else if (data) kids.push(...dataDocs(c, data));
	if (isTrue(prop(o, "skipDuplicates"))) kids.push(D(say.write.skipDuplicates));
	kids.push(...extraOptions(c, o));
	return D(
		head,
		kids.flatMap((k) => e.bullet(k)),
	);
}

/** `update` / `updateMany` / `updateManyAndReturn`: which rows, then what changes. */
export function updateDoc(c: Ctx, call: ModelCall, stmt: boolean): Doc {
	const { e, say } = c;
	const table = tableOf(e, call.model);
	const many = call.method !== "update";
	const o = unwrap(call.opts);
	const hasWhere = !!prop(o, "where");
	const base = many ? (hasWhere ? say.rows.some({ table }) : say.rows.every({ table })) : say.rows.unique({ table });
	if (o?.type !== "ObjectExpression")
		return D(say.rows.withOptions({ rows: stmt ? say.write.update({ rows: base }) : say.write.updated({ rows: base }), options: e.text(call.opts) }));
	const rows = rowsWithOptions(c, base, { type: "ObjectExpression", properties: o.properties.filter((p: N) => keyName(p) === "where") });
	const action = many ? say.write.updateMany({ rows: rows.t }) : say.write.update({ rows: rows.t });
	const head = stmt ? action : many && call.method === "updateMany" ? say.write.affected({ action }) : many ? action : say.write.updated({ rows: rows.t });
	const data = prop(o, "data");
	const kids = [...(data ? dataDocs(c, data) : []), ...extraOptions(c, o)];
	return D(head, [...rows.kids, ...kids.flatMap((k) => e.bullet(k))]);
}

export function upsertDoc(c: Ctx, call: ModelCall, stmt: boolean): Doc {
	const { e, say } = c;
	const table = tableOf(e, call.model);
	const o = unwrap(call.opts);
	const base = say.rows.unique({ table });
	if (o?.type !== "ObjectExpression") return D(say.rows.withOptions({ rows: say.write.upsert({ rows: base }), options: e.text(call.opts) }));
	const rows = rowsWithOptions(c, base, { type: "ObjectExpression", properties: o.properties.filter((p: N) => keyName(p) === "where") });
	const head = stmt ? say.write.upsert({ rows: rows.t }) : say.write.upserted({ rows: rows.t });
	const kids: Doc[] = [];
	const update = prop(o, "update");
	const create = prop(o, "create");
	if (update)
		kids.push(
			D(
				say.write.ifFound,
				dataDocs(c, update).flatMap((d) => e.bullet(d)),
			),
		);
	if (create)
		kids.push(
			D(
				say.write.ifMissing,
				dataDocs(c, create).flatMap((d) => e.bullet(d)),
			),
		);
	kids.push(...extraOptions(c, o));
	return D(head, [...rows.kids, ...kids.flatMap((k) => e.bullet(k))]);
}

export function deleteDoc(c: Ctx, call: ModelCall, stmt: boolean): Doc {
	const { e, say } = c;
	const table = tableOf(e, call.model);
	const many = call.method === "deleteMany";
	const o = unwrap(call.opts);
	const base = many ? (prop(o, "where") ? say.rows.some({ table }) : say.rows.every({ table })) : say.rows.unique({ table });
	const rows = rowsWithOptions(c, base, call.opts);
	const action = many ? say.write.deleteMany({ rows: rows.t }) : say.write.delete({ rows: rows.t });
	const head = stmt ? action : many ? say.write.affected({ action }) : say.write.deleted({ rows: rows.t });
	return D(head, rows.kids);
}
