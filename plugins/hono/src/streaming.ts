import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { importedAs, isContext, isStream } from "./facts";
import { type Ctx, fnLines, isFn, keyOf, msText, objectArg, type Rule } from "./shared";

const HELPERS = { streamSSE: "sse", streamText: "text", stream: "bytes" } as const;

/** `streamSSE(c, async (stream) => …, onError?)` and its text/byte siblings, or null. */
export function streamDoc(c: Ctx, call: N): Doc | null {
	const u = unwrap(call);
	if (u?.type !== "CallExpression") return null;
	const helper = importedAs(c, u.callee);
	if (!helper || !(helper in HELPERS) || !isContext(c, u.arguments[0])) return null;
	const [, cb, onError] = u.arguments;
	if (!cb || !isFn(cb)) return null;
	const errLines = onError && isFn(onError) ? c.e.bullet(D(c.say.stream.onError, fnLines(c.e, onError))) : [];
	return D(c.say.stream[HELPERS[helper as keyof typeof HELPERS]], [...fnLines(c.e, cb), ...errLines]);
}

/** `stream.writeSSE({ data, event, id })` fields as "data: …, event: …". */
function fieldsText(c: Ctx, n: N): string {
	const o = objectArg(n);
	if (!o) return c.e.text(n);
	return c.e.g.list(
		o.properties.map((p: N) => {
			const k = keyOf(p);
			if (k === null) return c.e.text(p);
			return c.say.common.option({ name: c.e.prop(k), value: p.shorthand ? c.e.ref(k) : c.e.text(p.value) });
		}),
	);
}

const STREAM_METHODS: Record<string, (c: Ctx, args: N[]) => Doc | null> = {
	writeSSE: (c, [v]) => (v ? D(c.say.stream.writeSSE({ fields: fieldsText(c, v) })) : null),
	write: (c, [v]) => (v ? D(c.say.stream.write({ value: c.e.text(v) })) : null),
	writeln: (c, [v]) => (v ? D(c.say.stream.writeln({ value: c.e.text(v) })) : null),
	sleep: (c, [ms]) => (ms ? D(c.say.stream.sleep({ duration: msText(c, ms) })) : null),
	pipe: (c, [src]) => (src ? D(c.say.stream.pipe({ source: c.e.text(src) })) : null),
	onAbort: (c, [fn]) => (fn && isFn(fn) ? D(c.say.stream.onAbort, fnLines(c.e, fn)) : null),
	close: (c) => D(c.say.stream.close),
	abort: (c) => D(c.say.stream.close),
};

/** The streaming helpers from `hono/streaming` and the methods of the stream they hand over. */
export function streamCalls(): Record<string, Rule> {
	const calls: Record<string, Rule> = {};
	for (const h of Object.keys(HELPERS)) calls[h] = (c, { node }) => streamDoc(c, node);
	for (const [m, f] of Object.entries(STREAM_METHODS)) calls[`*.${m}`] = (c, { obj, args }) => (obj && isStream(c, obj) ? f(c, args) : null);
	return calls;
}
