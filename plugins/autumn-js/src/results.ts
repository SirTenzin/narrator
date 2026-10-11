import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { bindingAt, clientPath, type Facts, hookAction } from "./facts";
import { type Ctx, params, termOf } from "./shared";
import { checkCondition } from "./usage";

/** Synthetic callees the condition rewrite gives a check's answer and a 0.x error, so condition rules can read them. */
export const ALLOWED = "autumn-js:allowed";
export const FAILED = "autumn-js:failed";
export const HAS_URL = "autumn-js:has-url";

/** Which Autumn operation a call is: `check`, `billing.attach`, or a hook action like `checkout`. */
export function opName(f: Facts, call: N): string | null {
	const u = unwrap(call);
	if (u?.type !== "CallExpression") return null;
	const path = clientPath(f, u);
	if (path) return path.replace(/^v2\./, "");
	return hookAction(f, u.callee)?.method ?? null;
}

/** The Autumn call whose result `n` holds: `res` from `const res = await autumn.check(…)`, 0.x `data` or `res.data`, or the call itself. */
function resultCall(f: Facts, n: N): N | null {
	const u = unwrap(n);
	if (u?.type === "CallExpression") return opName(f, u) ? u : null;
	if (u?.type === "Identifier") {
		const b = bindingAt(f, u.name, u.start);
		return b?.call && (b.field === null || b.field === "data") ? b.call : null;
	}
	if (u?.type === "MemberExpression" && !u.computed && u.property.name === "data" && unwrap(u.object)?.type === "Identifier") {
		const b = bindingAt(f, unwrap(u.object).name, u.start);
		return b?.call && b.field === null ? b.call : null;
	}
	return null;
}

const isCheck = (f: Facts, call: N | null): call is N => call !== null && opName(f, call) === "check";

/** The check whose answer an expression is: `allowed` destructured from it, or `res.allowed` / `data?.allowed` on its result. */
export function answerOf(f: Facts, n: N): N | null {
	const u = unwrap(n);
	if (u?.type === "Identifier") {
		const b = bindingAt(f, u.name, u.start);
		return b?.field === "allowed" && isCheck(f, b.call) ? b.call : null;
	}
	if (u?.type === "MemberExpression" && !u.computed && u.property.name === "allowed") {
		const call = resultCall(f, u.object);
		return isCheck(f, call) ? call : null;
	}
	return null;
}

/** `error` destructured from a 0.x call, which resolves to `{ data, error }` instead of throwing. */
function errorOf(f: Facts, n: N): N | null {
	const u = unwrap(n);
	if (u?.type !== "Identifier") return null;
	const b = bindingAt(f, u.name, u.start);
	return b?.field === "error" && b.call && clientPath(f, b.call) ? b.call : null;
}

/** What a synthetic condition stands for: a check's answer, or a URL on a billing result. */
export type Answers = WeakMap<N, { check: N } | { url: UrlKind }>;

const synthetic = (name: string, original: N): N => ({
	type: "CallExpression",
	callee: { type: "Identifier", name, start: original.start, end: original.start },
	arguments: [original],
	optional: false,
	start: original.start,
	end: original.end,
});

/** Rewrites, in place, a check's answer, a billing URL or a 0.x error used as a condition into a synthetic call the condition rules
 * read ("the customer can use the messages feature"). Nested statements and block-bodied functions get their own pass. */
export function rewriteConditions(c: Ctx, stmt: N, answers: Answers): void {
	const f = c.facts;
	if (!f.active || !f.bindings.size) return;
	const swap = (n: N): N => {
		const call = answerOf(f, n);
		if (call) {
			const s = synthetic(ALLOWED, n);
			answers.set(s, { check: call });
			return s;
		}
		const url = urlOf(f, n);
		if (url) {
			const s = synthetic(HAS_URL, n);
			answers.set(s, { url });
			return s;
		}
		if (errorOf(f, n)) return synthetic(FAILED, n);
		const u = n?.type === "ParenthesizedExpression" ? n.expression : n;
		if (u?.type === "UnaryExpression" && u.operator === "!") u.argument = swap(u.argument);
		if (u?.type === "LogicalExpression") {
			u.left = swap(u.left);
			u.right = swap(u.right);
		}
		return n;
	};
	const visit = (n: N, root: boolean) => {
		if (!n || typeof n !== "object") return;
		if (Array.isArray(n)) {
			for (const x of n) visit(x, false);
			return;
		}
		if (typeof n.type !== "string") return;
		if (!root && /Statement$|Declaration$/.test(n.type)) return;
		if ((n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression") && n.body?.type === "BlockStatement") return;
		if ("test" in n && n.test && /^(If|While|DoWhile|For)Statement$|^ConditionalExpression$/.test(n.type)) n.test = swap(n.test);
		if (n.type === "LogicalExpression") {
			n.left = swap(n.left);
			n.right = swap(n.right);
		}
		for (const [k, v] of Object.entries(n)) if (k !== "parent" && v && typeof v === "object") visit(v, false);
	};
	visit(stmt, true);
}

/** `res.allowed` read as a value: "whether the customer can use the messages feature". */
export const answerText = (c: Ctx, call: N): string => c.say.check.done({ condition: checkCondition(c, call) });

/** The feature a check or track call is about, for `res.balance`. */
export function balanceText(c: Ctx, obj: N): string | null {
	const call = resultCall(c.facts, obj);
	const op = call ? opName(c.facts, call) : null;
	if (!call || (op !== "check" && op !== "track")) return null;
	const feature = termOf(c, "feature", params(call.arguments[0]).take("featureId"));
	return op === "check" ? c.say.results.balance({ feature }) : c.say.results.newBalance({ feature });
}

export type UrlKind = "payment" | "checkout" | "portal" | "setup";
const URL_PROPS = new Set(["paymentUrl", "payment_url", "checkout_url", "url"]);

/** Which page a URL on a billing result opens: payment after attach, checkout, the billing portal, payment setup. */
export function urlKind(f: Facts, obj: N, prop: string): UrlKind | null {
	if (!URL_PROPS.has(prop)) return null;
	const call = resultCall(f, obj);
	const op = call ? opName(f, call)?.split(".").at(-1) : null;
	if (!op) return null;
	if (prop === "paymentUrl" || prop === "payment_url") return /^(attach|multiAttach|update|updateSubscription)$/.test(op) ? "payment" : null;
	if (prop === "checkout_url") return op === "attach" || op === "checkout" ? "checkout" : null;
	if (op === "checkout") return "checkout";
	if (/^(openCustomerPortal|billingPortal|openBillingPortal)$/.test(op)) return "portal";
	return op === "setupPayment" ? "setup" : null;
}

const urlOf = (f: Facts, n: N): UrlKind | null => {
	const u = unwrap(n);
	return u?.type === "MemberExpression" && !u.computed ? urlKind(f, u.object, u.property.name) : null;
};

export const asDoc = (text: string | null): Doc | null => (text ? D(text) : null);
