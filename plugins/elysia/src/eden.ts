import { D, type Doc, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, isPluginModule, keyOf, objectArg, stringLit } from "./shared";

export const EDEN_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "subscribe"];

const isEdenImport = (c: Ctx, name: string) => isPluginModule(c.state.imports.get(name), "eden");

/** `treaty<App>(url)` / `treaty(app)` when `treaty` comes from Eden. */
export function clientDoc(c: Ctx, node: N): Doc | null {
	const u = unwrap(node);
	if (u?.type !== "CallExpression" || unwrap(u.callee)?.type !== "Identifier" || !isEdenImport(c, unwrap(u.callee).name)) return null;
	const { e, say } = c;
	const typeArg = (u.typeArguments ?? u.typeParameters)?.params?.[0];
	const target = unwrap(u.arguments[0]);
	if (!typeArg && target?.type === "Identifier") return D(say.eden.clientDirect({ app: e.text(target) }));
	return D(say.eden.client({ app: typeArg ? mk("c", e.code(typeArg)) : "", url: target ? e.text(target) : "" }));
}

const isClientRoot = (c: Ctx, n: N) => {
	const u = unwrap(n);
	if (u?.type === "Identifier") return c.state.clients.has(u.name) && [...c.state.imports.keys()].some((k) => isEdenImport(c, k));
	return u?.type === "CallExpression" && clientDoc(c, u) !== null;
};

/** `api.users({ id }).get()` -> GET "/users/:id" with ID; null when the root isn't an Eden client. */
export function edenCallDoc(c: Ctx, { node, stmt }: { node: N; stmt: boolean }): Doc | null {
	const { e, say } = c;
	const callee = unwrap(node.callee);
	if (callee?.type !== "MemberExpression" || callee.computed) return null;
	const method = callee.property.name;
	const segments: string[] = [];
	const details: string[] = [];
	let cur = unwrap(callee.object);
	while (cur && !isClientRoot(c, cur)) {
		if (cur.type === "MemberExpression") {
			const name = cur.computed ? stringLit(cur.property) : cur.property.name;
			if (name === null) return null;
			segments.unshift(name);
			cur = unwrap(cur.object);
		} else if (cur.type === "CallExpression" && unwrap(cur.callee)?.type === "MemberExpression" && cur.arguments.length === 1) {
			const params = objectArg(cur.arguments[0]);
			if (!params) return null;
			const names = params.properties.map((p: N) => keyOf(p));
			if (names.some((n: string | null) => n === null)) return null;
			segments.unshift(...names.map((n: string) => `:${n}`));
			details.unshift(...params.properties.map((p: N) => say.eden.param({ name: e.prop(keyOf(p)!), value: e.text(p.value) })));
			cur = unwrap(cur.callee);
		} else return null;
	}
	if (!cur) return null;
	const client = e.text(cur);
	const path = mk("l", `"/${segments.filter((s) => s !== "index").join("/")}"`);
	if (method === "subscribe") return D(say.eden.subscribe({ path, client }));
	const bodyless = method === "get" || method === "head";
	const [first, second] = node.arguments;
	if (!bodyless && first) details.push(say.eden.body({ value: e.text(first) }));
	const opts = objectArg(bodyless ? first : second);
	for (const p of opts?.properties ?? []) {
		const key = keyOf(p);
		if (key === "query") details.push(say.eden.query({ value: e.text(p.value) }));
		else if (key === "headers") details.push(say.eden.headers({ value: e.text(p.value) }));
		else details.push(say.eden.option({ name: key === null ? e.text(p) : e.prop(key), value: key === null ? "" : e.text(p.value) }));
	}
	const parts = { method: mk("l", method.toUpperCase()), path, client, details };
	return D(stmt ? say.eden.send(parts) : say.eden.reply(parts));
}
