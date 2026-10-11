import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { active, type Ctx, chainOf, isFn, literalString } from "./shared";

/** `db.transaction().setIsolationLevel("serializable").execute(async (trx) => {...})`. */
export function transactionDoc(c: Ctx, { node, stmt }: { node: N; stmt: boolean }): Doc | null {
	const { e, say } = c;
	if (!active(e)) return null;
	const { steps } = chainOf(node);
	if (steps.length < 2 || steps[0]!.m !== "transaction" || steps.at(-1)!.m !== "execute") return null;
	const settings: string[] = [];
	for (const s of steps.slice(1, -1)) {
		const v = literalString(s.args[0]) ?? e.text(s.args[0]);
		if (s.m === "setIsolationLevel") settings.push(say.transaction.isolation({ level: v }));
		else if (s.m === "setAccessMode") settings.push(say.transaction.accessMode({ mode: v }));
		else return null;
	}
	const fn = unwrap(steps.at(-1)!.args[0]);
	if (!isFn(fn)) return null;
	const body =
		fn.body.type === "BlockStatement"
			? e.body(fn.body, 0)
			: e.bullet(unwrap(fn.body).type === "CallExpression" ? e.call(unwrap(fn.body), true) : e.noun(fn.body));
	return D((stmt ? say.transaction.run : say.transaction.result)({ settings }), body);
}
