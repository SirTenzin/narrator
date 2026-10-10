import { D, type Doc, type Line } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, callbackParts, calleeKey, cbValue, isFn, isObj, type Mode, memberKey, owns } from "../context";
import type { EffectPhrases } from "../phrases";

type Refinement = keyof EffectPhrases["matcher"]["refinements"];
const REFINEMENTS: Record<string, Refinement> = {
	"Match.string": "string",
	"Match.number": "number",
	"Match.boolean": "boolean",
	"Match.bigint": "bigint",
	"Match.date": "date",
	"Match.null": "null",
	"Match.undefined": "undefined",
	"Match.defined": "defined",
	"Match.nonEmptyString": "nonEmptyString",
	"Match.record": "record",
	"Match.any": "any",
};

/** A `Match.when` pattern as a condition: `{ _tag: "A" }`, a predicate, a refinement, or a literal. */
function pattern(c: Ctx, n: N): string {
	const m = c.say.matcher;
	const u = unwrap(n);
	const ref = REFINEMENTS[memberKey(u) ?? ""];
	if (ref) return m.refinements[ref];
	if (isFn(u)) {
		const ex = c.e.lambdaExpr(u);
		return ex ? c.e.cond(ex).t : c.e.noun(u).t;
	}
	if (u?.type === "ObjectExpression")
		return c.e.g.list(
			u.properties.map((p: N) => {
				const field = c.e.prop(p.key?.name ?? String(p.key?.value));
				const v = unwrap(p.value);
				const r = REFINEMENTS[memberKey(v) ?? ""];
				return m.fieldIs({ field, value: r ? m.refinements[r] : c.e.noun(v).t });
			}),
		);
	return m.is({ value: c.e.noun(u).t });
}

/** One case: `when: then`, with the handler's parameter named when it's used. */
function caseLine(c: Ctx, when: string, handler: N | undefined): Line[] {
	const p = c.say.match;
	if (!handler) return c.e.bullet(D(when));
	if (!isFn(handler)) return c.e.bullet(D(p.line({ when, then: c.e.noun(handler).t })));
	const parts = callbackParts(c, handler);
	const body = cbValue(c, parts);
	return c.e.bullet(D(p.line({ when: parts.name ? p.named({ when, name: parts.name }) : when, then: body.t }), body.kids));
}

const tagsOf = (c: Ctx, xs: N[]) =>
	c.e.g.list(
		xs.map((x) => c.e.noun(x).t),
		"or",
	);

/** The cases of a `Match` pipeline, and whether it ends with `Match.exhaustive`. */
function cases(c: Ctx, steps: N[]): { lines: Line[]; exhaustive: boolean } | null {
	const m = c.say.matcher;
	const lines: Line[] = [];
	let exhaustive = false;
	for (const s of steps) {
		const u = unwrap(s);
		const key = u?.type === "CallExpression" ? calleeKey(u) : memberKey(u);
		const args: N[] = u?.type === "CallExpression" ? u.arguments : [];
		const handler = args.at(-1);
		const patterns = args.slice(0, -1);
		switch (key) {
			case "Match.when":
			case "Match.whenOr":
			case "Match.whenAnd": {
				const conj = key === "Match.whenOr" ? "or" : "and";
				lines.push(
					...caseLine(
						c,
						m.when({
							pattern: c.e.g.list(
								patterns.map((p) => pattern(c, p)),
								conj,
							),
						}),
						handler,
					),
				);
				break;
			}
			case "Match.not":
				lines.push(...caseLine(c, m.not({ pattern: pattern(c, patterns[0]) }), handler));
				break;
			case "Match.tag":
				lines.push(...caseLine(c, m.tag({ tags: tagsOf(c, patterns) }), handler));
				break;
			case "Match.tags":
			case "Match.tagsExhaustive":
				if (!isObj(args[0])) return null;
				for (const p of unwrap(args[0]).properties)
					lines.push(...caseLine(c, m.tag({ tags: c.e.literal({ type: "Literal", value: p.key?.name ?? String(p.key?.value) }) }), p.value));
				exhaustive ||= key === "Match.tagsExhaustive";
				break;
			case "Match.orElse":
				lines.push(...caseLine(c, m.otherwise, args[0]));
				break;
			case "Match.exhaustive":
				exhaustive = true;
				break;
			case "Match.option":
			case "Match.either":
			case "Match.result":
			case "Match.orElseAbsurd":
				break;
			default:
				return null;
		}
	}
	return { lines, exhaustive };
}

/** `Match.value(x).pipe(...)` / `Match.type<T>().pipe(...)` as a list of cases, or null when it isn't one. */
export function matchPipeline(c: Ctx, subject: N, steps: N[], _mode: Mode): Doc | null {
	if (!owns(c, "Match")) return null;
	const s = unwrap(subject);
	const key = calleeKey(s);
	if (key !== "Match.value" && key !== "Match.type") return null;
	const body = cases(c, steps);
	if (!body) return null;
	const head = key === "Match.value" && s.arguments[0] ? c.say.matcher.value({ subject: c.e.noun(s.arguments[0]).t }) : c.say.matcher.type;
	return D(body.exhaustive ? c.say.common.withNote({ text: head, note: c.say.matcher.allCovered }) : head, body.lines);
}
