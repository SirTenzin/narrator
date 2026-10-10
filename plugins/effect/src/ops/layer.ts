import { D, mk } from "@usenarrator/core";
import { unwrap } from "@usenarrator/lang-ts";
import { type Ctx, curried, form, layerNoun, make, type OpTable, serviceName, step, strLit } from "../context";
import type { EffectPhrases } from "../phrases";
import { thunkValue } from "./effect";

const list = (c: Ctx, xs: unknown[]) => {
	const flat = xs.flatMap((x: any) => (unwrap(x)?.type === "ArrayExpression" ? unwrap(x).elements : [x]));
	return c.e.g.list(flat.map((x) => layerNoun(c, x)));
};

/** `Layer.x(Tag, value)` or v4's curried `Layer.x(Tag)(value)`. */
const layerOf = (render: (c: Ctx, tag: any, value: any) => ReturnType<typeof D> | null) =>
	curried((c, inner, outer) => {
		const [tag, value] = inner.length >= 2 ? inner : [inner[0], outer?.[0]];
		return tag && value ? render(c, tag, value) : null;
	});

const builtBy = (pick: (s: EffectPhrases) => (p: { service: string; effect: string }) => string) =>
	layerOf((c, tag, eff) => {
		if (unwrap(eff).type === "MemberExpression" && unwrap(eff).property.name === "make") return D(c.say.layer.fromMake({ service: serviceName(c, tag) }));
		const v = c.e.noun(eff);
		return D(pick(c.say)({ service: serviceName(c, tag), effect: v.t }), v.kids);
	});

const layerList = (pick: (s: EffectPhrases) => (p: { layers: string }) => string) => step(1, (c, [x]) => (x ? D(pick(c.say)({ layers: list(c, [x]) })) : null));

const shared: OpTable = {
	"Layer.succeed": layerOf((c, tag, impl) => {
		const v = c.e.noun(impl);
		return D(c.say.layer.succeed({ service: serviceName(c, tag), impl: v.t }), v.kids);
	}),
	"Layer.effect": builtBy((s) => s.layer.effect),
	"Layer.sync": layerOf((c, tag, fn) => {
		const v = thunkValue(c, fn);
		return D(c.say.layer.sync({ service: serviceName(c, tag), value: v.t }), v.kids);
	}),
	"Layer.merge": make((c, args) => (args.length > 1 ? D(c.say.layer.merge({ layers: list(c, args) })) : null)),
	"Layer.mergeAll": make((c, args) => (args.length ? D(c.say.layer.merge({ layers: list(c, args) })) : null)),
	"Layer.provide": layerList((s) => s.layer.provide),
	"Layer.provideMerge": layerList((s) => s.layer.provideMerge),
	"Layer.launch": step(0, (c) => D(c.say.layer.launch)),
	"Layer.effectDiscard": make((c, [eff]) => (eff ? D(c.say.layer.discard({ effect: c.e.noun(eff).t })) : null)),
	"Layer.fresh": make((c, [l]) => (l ? D(c.say.layer.fresh({ layer: layerNoun(c, l) })) : null)),
	"Layer.orDie": step(0, (c) => D(c.say.steps.orDie)),
	"ManagedRuntime.make": make((c, [layer]) => (layer ? D(c.say.layer.runtime({ layer: layerNoun(c, layer) })) : null)),

	"Scope.make": make((c) => D(c.say.scope.make)),
	"Scope.close": make((c, [scope]) => (scope ? D(c.say.scope.close({ scope: c.e.noun(scope).t })) : null)),
};

/** `Context.GenericTag("Db")` (v3) / `Context.Service("Db")` (v4 function form). */
const tagNamed = curried((c, inner, outer) => {
	const id = strLit(inner[0]) !== null ? inner[0] : outer?.[0];
	return id ? D(c.say.service.tag({ id: c.e.noun(id).t })) : null;
});

const unwrapOp = make((c, [eff]) => (eff ? D(c.say.layer.unwrap({ effect: c.e.noun(eff).t })) : null));

const v3: OpTable = {
	"Layer.scoped": builtBy((s) => s.layer.scoped),
	"Layer.scopedDiscard": make((c, [eff]) => (eff ? D(c.say.layer.discard({ effect: c.e.noun(eff).t })) : null)),
	"Layer.unwrapEffect": unwrapOp,
	"Context.GenericTag": tagNamed,
};

const v4: OpTable = {
	"Layer.unwrap": unwrapOp,
	"Layer.mock": layerOf((c, tag, impl) => {
		const v = c.e.noun(impl);
		return D(c.say.layer.mock({ service: serviceName(c, tag), impl: v.t }), v.kids);
	}),
	"Context.Service": tagNamed,
	"ServiceMap.Service": tagNamed,
};

export const layerOps = { shared, v3, v4 };
