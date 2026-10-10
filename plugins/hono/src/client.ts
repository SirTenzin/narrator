import { D, type Doc, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { importedAs, isClient } from "./facts";
import type { Target } from "./phrases";
import { type Ctx, keyOf, objectArg, type Rule, str, typeArgs } from "./shared";

const VERBS = ["get", "post", "put", "patch", "delete", "options"];

/** `client.api.posts[":id"].$get` -> the client and the route path "/api/posts/:id" (`index` is the route's root). */
function routeOf(c: Ctx, obj: N): { client: N; path: string } | null {
	const segs: string[] = [];
	let cur = unwrap(obj);
	while (cur?.type === "MemberExpression") {
		const s = cur.computed ? str(cur.property) : cur.property.name;
		segs.unshift(s ?? `[${c.e.code(cur.property)}]`);
		cur = unwrap(cur.object);
	}
	if (!isClient(c, cur)) return null;
	return { client: cur, path: mk("c", `/${segs.filter((s) => s !== "index").join("/")}`) };
}

/** `{ query: { id }, json: { title } }` as "the query parameters …" parts. */
function partsText(c: Ctx, n: N): string | null {
	const o = objectArg(n);
	if (!o) return n ? c.e.text(n) : null;
	const parts = o.properties.map((p: N) => {
		const k = keyOf(p);
		const target = k ? c.say.validation.targets[k as Target] : undefined;
		const inner = objectArg(p.value);
		const value = inner && !p.shorthand ? c.e.g.list(inner.properties.map((x: N) => c.e.objectProp(x).t)) : c.e.text(p.shorthand ? p.key : p.value);
		return target ? c.say.client.part({ target, value }) : c.say.common.option({ name: k ? c.e.prop(k) : c.e.text(p.key), value });
	});
	return parts.length ? c.e.g.list(parts) : null;
}

const call =
	(verb: string): Rule =>
	(c, { obj, args, stmt }) => {
		const r = obj && routeOf(c, obj);
		if (!r) return null;
		const p = { method: mk("l", verb.toUpperCase()), path: r.path, client: c.e.text(r.client), parts: partsText(c, args[0]) };
		return D(stmt ? c.say.client.send(p) : c.say.client.request(p));
	};

/** `hc<AppType>(url)` and calls through the typed client it returns. */
export function clientCalls(): Record<string, Rule> {
	const calls: Record<string, Rule> = {};
	for (const v of VERBS) calls[`*.$${v}`] = call(v);
	return {
		...calls,
		"*.$url": (c, { obj }) => {
			const r = obj && routeOf(c, obj);
			return r ? D(c.say.client.url({ path: r.path, client: c.e.text(r.client) })) : null;
		},
		hc: (c, { node, args }): Doc | null => {
			if (importedAs(c, node.callee) !== "hc" || !args[0]) return null;
			const [t] = typeArgs(node);
			return D(c.say.client.create({ type: t ? mk("c", c.e.code(t)) : null, url: c.e.text(args[0]) }));
		},
	};
}
