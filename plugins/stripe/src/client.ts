import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { active, type Ctx, keyName, stripeConstructorName } from "./shared";

/** `new Stripe(key, { apiVersion, maxNetworkRetries })`. */
export function clientDoc(c: Ctx, { node, args }: { node: N; args: N[] }): Doc | null {
	const { e, say } = c;
	const callee = unwrap(node.callee);
	if (!active(e) || callee?.type !== "Identifier" || callee.name !== stripeConstructorName(e) || !args[0]) return null;
	const key = e.noun(args[0]);
	const o = unwrap(args[1]);
	const lines =
		o?.type === "ObjectExpression"
			? o.properties.map((p: N) => {
					const k = keyName(p);
					if (k === "apiVersion") return D(say.options.apiVersion({ version: e.text(p.value) }));
					if (k === "maxNetworkRetries") return D(say.client.maxNetworkRetries({ count: e.text(p.value) }));
					return p.type === "SpreadElement" ? e.noun(p) : e.objectProp(p);
				})
			: args[1]
				? [e.noun(args[1])]
				: [];
	return D(say.client.create({ key: key.t }), [...key.kids, ...lines.flatMap((l: Doc) => e.bullet(l))]);
}
