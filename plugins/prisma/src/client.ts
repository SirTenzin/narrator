import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, entryDoc, isFn, items, keyName, literalString } from "./shared";

/** `new PrismaClient({ adapter, log, accelerateUrl })`. */
export function clientDoc(c: Ctx, { args }: { args: N[] }): Doc {
	const { e, say } = c;
	const o = unwrap(args[0]);
	if (!o) return D(say.client.create);
	if (o.type !== "ObjectExpression") return D(say.client.create, e.bullet(e.noun(o)));
	const kids = o.properties.map((p: N): Doc => {
		const k = keyName(p);
		const v = unwrap(p.value);
		if (k === "adapter") return D(say.client.adapter({ adapter: e.text(v) }));
		if (k === "accelerateUrl") return D(say.client.accelerate({ url: e.text(v) }));
		if (k === "log") {
			const levels = items(v).map((x) => {
				const lit = literalString(x);
				if (lit !== null) return e.lex.humanize(lit);
				const level = literalString(unwrap(x)?.properties?.find((q: N) => keyName(q) === "level")?.value);
				return level ? e.lex.humanize(level) : e.text(x);
			});
			return D(say.client.log({ levels: e.g.list(levels) }));
		}
		return entryDoc(e, p);
	});
	return D(
		say.client.create,
		kids.flatMap((k: Doc) => e.bullet(k)),
	);
}

const humanList = (c: Ctx, o: N) =>
	c.e.g.list(
		(unwrap(o)?.properties ?? []).map((p: N) => {
			const k = keyName(p);
			return k ? c.e.prop(k) : entryDoc(c.e, p).t;
		}),
	);

/** `prisma.$extends({ query, result, model, client })`, or an extension value like `withAccelerate()`. */
export function extendsDoc(c: Ctx, { obj, args }: { obj: N | null; args: N[] }): Doc | null {
	const { e, say } = c;
	const client = obj ? e.noun(obj) : D(say.client.create);
	const ext = unwrap(args[0]);
	if (ext?.type !== "ObjectExpression") {
		const x = e.noun(args[0]);
		return D(say.client.extendedWith({ client: client.t, extension: x.t }), [...client.kids, ...x.kids]);
	}
	const kids: Doc[] = [];
	const modelName = (k: string) => (k === "$allModels" ? say.client.allModels : e.prop(k));
	for (const p of ext.properties) {
		const k = keyName(p);
		const v = unwrap(p.value);
		if (k === "query" && v?.type === "ObjectExpression")
			for (const m of v.properties) {
				const mk = keyName(m);
				const mv = unwrap(m.value);
				if (!mk || mv?.type !== "ObjectExpression") {
					kids.push(entryDoc(e, m));
					continue;
				}
				for (const op of mv.properties) {
					const ok = keyName(op);
					const operation = ok === "$allOperations" ? say.client.allOperations : ok ? e.prop(ok) : entryDoc(e, op).t;
					const fn = op.method || isFn(op.value) ? (op.method ? op.value : unwrap(op.value)) : null;
					const head = say.client.queryHook({ model: modelName(mk), operation });
					kids.push(fn ? D(head, fn.body.type === "BlockStatement" ? e.body(fn.body, 0) : e.bullet(e.noun(fn.body))) : D(head));
				}
			}
		else if (k === "result" && v?.type === "ObjectExpression")
			for (const m of v.properties) {
				const mk = keyName(m);
				const mv = unwrap(m.value);
				if (!mk || mv?.type !== "ObjectExpression") {
					kids.push(entryDoc(e, m));
					continue;
				}
				for (const f of mv.properties) {
					const fk = keyName(f);
					const needs = unwrap(f.value)?.properties?.find((x: N) => keyName(x) === "needs")?.value;
					const compute = unwrap(f.value)?.properties?.find((x: N) => keyName(x) === "compute");
					const sub: Doc[] = [];
					if (needs) sub.push(D(say.client.needs({ fields: humanList(c, needs) })));
					if (compute) sub.push(e.objectProp(compute));
					kids.push(
						D(
							say.client.computedField({ model: modelName(mk), field: fk ? e.prop(fk) : "…" }),
							sub.flatMap((s) => e.bullet(s)),
						),
					);
				}
			}
		else if (k === "model" && v?.type === "ObjectExpression")
			for (const m of v.properties) {
				const mk = keyName(m);
				kids.push(mk ? D(say.client.modelMethods({ model: modelName(mk), methods: humanList(c, m.value) })) : entryDoc(e, m));
			}
		else if (k === "client" && v?.type === "ObjectExpression") kids.push(D(say.client.clientMethods({ methods: humanList(c, v) })));
		else kids.push(entryDoc(e, p));
	}
	return D(say.client.extended({ client: client.t }), [...client.kids, ...kids.flatMap((d) => e.bullet(d))]);
}
