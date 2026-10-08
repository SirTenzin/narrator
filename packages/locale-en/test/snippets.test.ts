import { expect, test } from "bun:test";
import { narrate } from "@narrate/testkit";

test("arithmetic with a fallback operand", () => {
	expect(narrate("const total = price * quantity + (discount ?? 0);")).toBe("Let total be price times quantity plus discount (or 0 if that's missing).");
});

test("guard clause with a missing property", () => {
	expect(narrate("function f() { if (!customer.email) return null; }")).toBe("To f:\n  If customer's email is missing, give back nothing.");
});

test("object entries loop with a skip", () => {
	expect(narrate("for (const [key, value] of Object.entries(prices)) { if (value > 100) continue; log(key); }")).toBe(
		"For each key key and value value in prices:\n  Skip it if value is more than 100.\n  Log (key).",
	);
});

test("predicate function signature and boolean return", () => {
	expect(narrate('export function isActive(sub: Subscription): boolean { return sub.status === "active" && sub.items.length > 0; }')).toBe(
		"Is active? — given subscription (Subscription); gives back true/false:\n  Give back whether subscription's status is \"active\" and subscription's items is not empty.",
	);
});

test("switch with grouped cases and a default", () => {
	expect(narrate('switch (kind) { case "a": case "b": run(); break; default: stop(); }')).toBe(
		'Depending on kind:\n  • If it is "a" or "b":\n    Run.\n  • For anything else:\n    Stop.',
	);
});

test("try/catch rethrowing an error", () => {
	expect(narrate('try { await chargeCustomer({ customerId, amount }); } catch (err) { throw new Error("charge failed"); }')).toBe(
		'Try the following:\n  Charge customer (customer ID and amount).\nIf anything fails (call the problem error):\n  Fail with an error: "charge failed".',
	);
});

test("type alias with an optional member", () => {
	expect(narrate("type Plan = { id: string; price?: number };")).toBe("Type (Plan): an object with ID and price (optional).");
});

test("inline ternary", () => {
	expect(narrate('const label = isTrial ? "trial" : "paid";')).toBe('Let label be "trial" if is trial, otherwise "paid".');
});
