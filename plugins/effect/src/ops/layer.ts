import { D, mk } from "@usenarrator/core";
import { unwrap } from "@usenarrator/lang-ts";
import { type Ctx, curried, form, make, noun, type OpTable, step, strLit } from "../context";
import type { EffectPhrases } from "../phrases";
import { serviceName, thunkValue } from "./effect";

const list = (c: Ctx, xs: unknown[]) => {
	const flat = xs.flatMap((x: any) => (unwrap(x)?.type === "ArrayExpression" ? unwrap(x).elements : [x]));
	return c.e.g.list(flat.map((x) => noun(c, x).t));
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
		const v = noun(c, eff);
		return D(pick(c.say)({ service: serviceName(c, tag), effect: v.t }), v.kids);
	});

const layerList = (pick: (s: EffectPhrases) => (p: { layers: string }) => string) => step(1, (c, [x]) => (x ? D(pick(c.say)({ layers: list(c, [x]) })) : null));

const configKinds = ["string", "number", "integer", "boolean", "redacted", "url", "duration"] as const;

const shared: OpTable = {
	"Layer.succeed": layerOf((c, tag, impl) => {
		const v = noun(c, impl);
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
	"ManagedRuntime.make": make((c, [layer]) => (layer ? D(c.say.layer.runtime({ layer: noun(c, layer).t })) : null)),

	...Object.fromEntries(
		configKinds.map((k) => [
			`Config.${k}`,
			make((c, [name], mode) =>
				name
					? D(form(c.say.config.setting, mode, { name: strLit(name) !== null ? mk("l", strLit(name)!) : c.e.noun(name).t, kind: c.say.config.kinds[k] }))
					: null,
			),
		]),
	),
	"Config.withDefault": step(1, (c, [v]) => (v ? D(c.say.config.withDefault({ value: noun(c, v).t })) : null)),

	"Ref.make": make((c, [v], mode) => (v ? D(form(c.say.ref.make, mode, { value: noun(c, v).t })) : null)),
	"Ref.get": make((c, [r], mode) => (r ? D(form(c.say.ref.get, mode, { ref: noun(c, r).t })) : null)),
	"Ref.set": make((c, [r, v]) => (r && v ? D(c.say.ref.set({ ref: noun(c, r).t, value: noun(c, v).t })) : null)),
	"Ref.update": make((c, [r, f]) => {
		if (!r || !f) return null;
		const v = thunkValue(c, f);
		return D(c.say.ref.update({ ref: noun(c, r).t, value: v.t }), v.kids);
	}),
	"Fiber.join": make((c, [f], mode) => (f ? D(form(c.say.fiber.join, mode, { fiber: noun(c, f).t })) : null)),
	"Fiber.interrupt": make((c, [f]) => (f ? D(c.say.fiber.interrupt({ fiber: noun(c, f).t })) : null)),
	"Scope.make": make((c) => D(c.say.scope.make)),
	"Scope.close": make((c, [scope]) => (scope ? D(c.say.scope.close({ scope: noun(c, scope).t })) : null)),
};

/** `Context.GenericTag("Db")` (v3) / `Context.Service("Db")` (v4 function form). */
const tagNamed = curried((c, inner, outer) => {
	const id = strLit(inner[0]) !== null ? inner[0] : outer?.[0];
	return id ? D(c.say.service.tag({ id: c.e.noun(id).t })) : null;
});

const v3: OpTable = {
	"Layer.scoped": builtBy((s) => s.layer.scoped),
	"Context.GenericTag": tagNamed,
};

const v4: OpTable = {
	"Context.Service": tagNamed,
	"ServiceMap.Service": tagNamed,
};

export const layerOps = { shared, v3, v4 };
