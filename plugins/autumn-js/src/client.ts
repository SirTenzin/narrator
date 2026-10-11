import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, literalBool, params, restLines } from "./shared";

/** `new Autumn({ secretKey, serverURL, failOpen })`; with no key the SDK reads `AUTUMN_SECRET_KEY`. */
export function clientDoc(c: Ctx, node: N, args: N[]): Doc | null {
	const { e, say } = c;
	const callee = unwrap(node.callee);
	if (!c.facts.active || callee?.type !== "Identifier" || !c.facts.ctors.has(callee.name)) return null;
	const p = params(args[0]);
	if (args[0] && !p.node) return D(say.client.create({ key: e.text(args[0]) }));
	const key = p.take("secretKey");
	const url = p.take("serverURL") ?? p.take("url");
	const failOpen = literalBool(p.take("failOpen"));
	const timeout = p.take("timeoutMs");
	const version = p.take("version") ?? p.take("xApiVersion");
	const returnUrl = p.take("defaultReturnUrl");
	const lines = [
		url ? D(say.client.serverURL({ url: e.text(url) })) : null,
		failOpen === null ? null : D(failOpen ? say.client.failOpen.on : say.client.failOpen.off),
		timeout ? D(say.client.timeout({ ms: e.text(timeout) })) : null,
		version ? D(say.client.version({ version: e.text(version) })) : null,
		returnUrl ? D(say.client.defaultReturnUrl({ url: e.text(returnUrl) })) : null,
		...restLines(c, p),
	].flatMap((l) => (l ? e.bullet(l) : []));
	return D(key ? say.client.create({ key: e.text(key) }) : say.client.envKey, lines);
}
