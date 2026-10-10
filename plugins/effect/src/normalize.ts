import type { N } from "@usenarrator/lang-ts";
import { type Ctx, memberKey, owns } from "./context";

/** Rule key for a `yield*` nested inside an expression (`if (yield* isAdmin)`). */
export const YIELD_KEY = "yield*";
/** Rule key `Option.some(x)` is re-keyed to, so the engine stops reading it as an array `.some(...)` check. */
export const OPTION_SOME = "Option.some";

const isFunction = (n: N) => n.type === "FunctionExpression" || n.type === "FunctionDeclaration" || n.type === "ArrowFunctionExpression";
const isStatement = (n: N) => /Statement$|Declaration$/.test(n.type);

/** Statement-level yields (`const x = yield* X`, `yield* X;`, `return yield* X`) are read by `yieldStatement`, so they stay. */
function topLevelYields(stmt: N): Set<N> {
	const out = new Set<N>();
	if (stmt.type === "ExpressionStatement") out.add(stmt.expression);
	if (stmt.type === "ReturnStatement" && stmt.argument) out.add(stmt.argument);
	if (stmt.type === "VariableDeclaration") for (const d of stmt.declarations) if (d.init) out.add(d.init);
	return out;
}

/** Rewrites, in place, two shapes the engine can't hand to a rule: nested `yield* x` becomes a call keyed `yield*`, and
 * `Option.some(x)` gets the callee identifier `Option.some`. Nested statements and block-bodied functions get their own pass. */
export function normalize(c: Ctx, stmt: N): void {
	const keep = topLevelYields(stmt);
	const visit = (n: N, root: boolean) => {
		if (!n || typeof n !== "object") return;
		if (Array.isArray(n)) {
			for (const x of n) visit(x, false);
			return;
		}
		if (typeof n.type !== "string") return;
		if (!root && isStatement(n)) return;
		if (isFunction(n) && n.body?.type === "BlockStatement") return;
		if (n.type === "YieldExpression" && n.delegate && !keep.has(n)) {
			const argument = n.argument;
			delete n.argument;
			delete n.delegate;
			Object.assign(n, { type: "CallExpression", callee: { type: "Identifier", name: YIELD_KEY, start: n.start, end: n.start }, arguments: [argument] });
		}
		if (n.type === "CallExpression" && memberKey(n.callee) === OPTION_SOME && owns(c, "Option"))
			n.callee = { type: "Identifier", name: OPTION_SOME, start: n.callee.start, end: n.callee.end };
		for (const [k, v] of Object.entries(n)) if (k !== "type" && v && typeof v === "object") visit(v, false);
	};
	visit(stmt, true);
}
