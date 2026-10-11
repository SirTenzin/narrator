import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, detailsOf, isFn, params, restLines, type Said, said, whoOf } from "./shared";

/** The object a function hands back, and the steps before it: `() => ({ customerId })` or a block ending in `return { … }`. */
function returnedObject(c: Ctx, fn: N): { obj: N; before: N[] } | null {
	const ex = unwrap(c.e.lambdaExpr(fn));
	if (ex?.type === "ObjectExpression") return { obj: ex, before: [] };
	const body: N[] = fn.body.type === "BlockStatement" ? fn.body.body : [];
	const last = body.at(-1);
	if (last?.type !== "ReturnStatement" || unwrap(last.argument)?.type !== "ObjectExpression") return null;
	return { obj: unwrap(last.argument), before: body.slice(0, -1) };
}

/** `identify: (req) => ({ customerId: req.user.id, customerData: { name, email } })`. */
function identifyLine(c: Ctx, n: N): Doc {
	const { e, say } = c;
	const fn = unwrap(n);
	if (!isFn(fn)) return D(say.handler.identifyBy({ fn: e.text(n) }));
	const found = returnedObject(c, fn);
	const p = found ? params(found.obj) : null;
	const customer = p?.take("customerId");
	if (found && p && customer && !p.rest().some((x) => x.type === "SpreadElement")) {
		const data = p.take("customerData");
		const who = e.text(customer);
		const text = data ? say.handler.identifyWith({ customer: who, details: detailsOf(c, data) }) : say.handler.identify({ customer: who });
		const steps = found.before.length ? e.body({ type: "BlockStatement", body: found.before, start: fn.body.start, end: fn.body.end }, 0) : [];
		return D(steps.length ? say.handler.identifyAfter({ identify: text }) : text, [...steps, ...restLines(c, p).flatMap((l) => e.bullet(l))]);
	}
	const body =
		fn.body.type === "BlockStatement" ? e.body(fn.body, 0) : e.body({ type: "ReturnStatement", argument: fn.body, start: fn.body.start, end: fn.body.end }, 0);
	return D(say.handler.identifyFn, body);
}

/** `autumnHandler({ identify, secretKey })` from any framework adapter, or the low-level `autumnHandler({ request, customerId })`. */
export function handler(c: Ctx, args: N[]): Said {
	const { e, say } = c;
	const p = params(args[0]);
	const request = p.take("request");
	if (request) {
		const who = whoOf(c, p.take("customerId"), undefined);
		const data = p.take("customerData");
		return said(c, say.handler.forward, { request: e.text(request), who }, [
			data ? D(say.handler.customerData({ value: detailsOf(c, data) })) : null,
			...restLines(c, p),
		]);
	}
	const identify = p.take("identify");
	const key = p.take("secretKey");
	const url = p.take("autumnURL") ?? p.take("url");
	const prefix = p.take("pathPrefix");
	const lines = [
		identify ? identifyLine(c, identify) : null,
		key ? D(say.handler.secretKey({ key: e.text(key) })) : null,
		url ? D(say.handler.autumnURL({ url: e.text(url) })) : null,
		prefix ? D(say.handler.pathPrefix({ path: e.text(prefix) })) : null,
		...restLines(c, p),
	];
	return said(c, { do: () => say.handler.routes, done: () => say.handler.routes }, {}, lines);
}

/** `export const { GET, POST } = autumnHandler(…)`: the route exports a Next.js or TanStack route file serves. */
export const serveText = (c: Ctx, methods: string) => c.say.handler.serve({ methods });
