import { D, type Doc, type Line } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, entryDoc, isFn, keyName, literalString } from "./shared";

function settingsOf(c: Ctx, opts: N): string[] {
	const { e, say } = c;
	const o = unwrap(opts);
	if (!o) return [];
	if (o.type !== "ObjectExpression") return [e.text(opts)];
	const t = say.transaction;
	return o.properties.map((p: N): string => {
		const k = keyName(p);
		const v = unwrap(p.value);
		if (k === "isolationLevel") {
			const lit = literalString(v);
			const level = lit ?? (v?.type === "MemberExpression" && !v.computed ? v.property.name : e.text(v));
			return t.isolation({ level });
		}
		if (k === "timeout") return t.timeout({ ms: e.text(v) });
		if (k === "maxWait") return t.maxWait({ ms: e.text(v) });
		if (!k) return entryDoc(e, p).t;
		return t.setting({ key: e.prop(k), value: e.text(v) });
	});
}

function fnSteps(c: Ctx, fn: N): Line[] {
	const { e } = c;
	if (fn.body.type === "BlockStatement") return e.body(fn.body, 0);
	const u = unwrap(fn.body);
	return e.bullet(u.type === "CallExpression" ? e.call(u, true) : e.noun(u));
}

/** `$transaction([q1, q2], opts)` and `$transaction(async (tx) => {...}, opts)`. */
export function transactionDoc(c: Ctx, { args, stmt }: { args: N[]; stmt: boolean }): Doc | null {
	const { e, say } = c;
	const first = unwrap(args[0]);
	const settings = settingsOf(c, args[1]);
	const t = say.transaction;
	if (isFn(first)) return D((stmt ? t.run : t.result)({ settings }), fnSteps(c, first));
	if (first?.type === "ArrayExpression")
		return D(
			(stmt ? t.batch : t.batchResult)({ settings }),
			first.elements.filter(Boolean).flatMap((x: N) => e.bullet(unwrap(x)?.type === "CallExpression" ? e.call(unwrap(x), true) : e.noun(x))),
		);
	if (!first) return null;
	const q = e.noun(first);
	return D(t.batchOf({ queries: q.t }), q.kids);
}
