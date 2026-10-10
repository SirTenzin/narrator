import { D, type Doc, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { type Ctx, curried, form, type Mode, make, type OpTable, step, strLit } from "../context";
import type { EffectPhrases } from "../phrases";
import { thunkValue } from "./effect";
import { schemaType } from "./schema";

type Kind = keyof EffectPhrases["config"]["kinds"];

/** A setting name: `"PORT"` reads as PORT, anything else as itself. */
const settingName = (c: Ctx, n: N | undefined) => {
	if (!n) return null;
	const s = strLit(n);
	return s !== null ? mk("l", s) : c.e.noun(n).t;
};

const setting = (c: Ctx, mode: Mode, name: N | undefined, kind: string) => {
	const n = settingName(c, name);
	return n ? D(form(c.say.config.setting, mode, { name: n, kind })) : null;
};

const kindOp = (k: Kind) => make((c, [name], mode) => setting(c, mode, name, c.say.config.kinds[k]));
const kinds = (names: Record<string, Kind>): OpTable => Object.fromEntries(Object.entries(names).map(([m, k]) => [`Config.${m}`, kindOp(k)]));

/** `Config.all({ host: Config.string("HOST"), ... })` / `Config.all([a, b])`. */
const all = make((c, [x], mode) => {
	const u = unwrap(x);
	if (!u) return null;
	const entries =
		u.type === "ObjectExpression"
			? u.properties.map((p: N) => {
					const v = c.e.noun(p.value ?? p);
					return p.key ? D(c.say.common.labeled({ label: c.e.prop(p.key.name ?? String(p.key.value)), value: v.t }), v.kids) : v;
				})
			: u.type === "ArrayExpression"
				? u.elements.map((el: N) => c.e.noun(el))
				: [c.e.noun(u)];
	return D(
		c.say.config.all[mode],
		entries.flatMap((d: Doc) => c.e.bullet(d)),
	);
});

const values = (c: Ctx, xs: N[]) => {
	const flat = xs.length === 1 && unwrap(xs[0]).type === "ArrayExpression" ? unwrap(xs[0]).elements : xs;
	return c.e.g.list(
		flat.map((x: N) => c.e.noun(x).t),
		"or",
	);
};

const source = (c: Ctx, [x]: N[]) => (x ? D(c.say.config.fromSource({ source: c.e.noun(x).t })) : null);

const shared: OpTable = {
	"Config.withDefault": step(1, (c, [v]) => (v ? D(c.say.config.withDefault({ value: c.e.noun(v).t })) : null)),
	"Config.option": step(0, (c) => D(c.say.config.option)),
	"Config.nested": step(1, (c, [p]) => (p ? D(c.say.config.nested({ prefix: settingName(c, p)! })) : null)),
	"Config.orElse": step(1, (c, [x]) => (x ? D(c.say.config.orElse({ other: thunkValue(c, x).t })) : null)),
	"Config.all": all,
	"ConfigProvider.fromEnv": make((c) => D(c.say.config.fromEnv)),
};

const v3: OpTable = {
	...kinds({
		string: "string",
		number: "number",
		integer: "integer",
		boolean: "boolean",
		redacted: "redacted",
		secret: "redacted",
		url: "url",
		duration: "duration",
		date: "date",
		logLevel: "logLevel",
		nonEmptyString: "nonEmptyString",
	}),
	"Config.withDescription": step(1, (c, [d]) => (d ? D(c.say.config.described({ text: c.e.noun(d).t })) : null)),
	/** `Config.literal("dev", "prod")("ENV")`. */
	"Config.literal": curried((c, inner, outer, mode) => (outer?.[0] ? setting(c, mode, outer[0], c.say.config.oneOf({ values: values(c, inner) })) : null)),
	"Config.array": make((c, [item, name], mode) => {
		const k = item ? unwrap(item) : null;
		const kind = k?.type === "CallExpression" && kindOf(c, k) ? kindOf(c, k)! : c.e.noun(item).t;
		return setting(c, mode, name, c.say.config.listOf({ kind }));
	}),
	"ConfigProvider.fromMap": make((c, args) => source(c, args)),
	"ConfigProvider.fromJson": make((c, args) => source(c, args)),
	"Effect.withConfigProvider": step(1, (c, [p]) => (p ? D(c.say.config.withProvider({ provider: c.e.noun(p).t })) : null)),
	"Layer.setConfigProvider": make((c, [p]) => (p ? D(c.say.config.providerLayer({ provider: c.e.noun(p).t })) : null)),
};

const v4: OpTable = {
	...kinds({
		String: "string",
		Number: "number",
		Int: "integer",
		Boolean: "boolean",
		Redacted: "redacted",
		URL: "url",
		Duration: "duration",
		Port: "port",
		Date: "date",
		LogLevel: "logLevel",
		NonEmptyString: "nonEmptyString",
		Finite: "finite",
	}),
	"Config.Literal": make((c, [v, name], mode) => (v ? setting(c, mode, name, c.say.config.oneOf({ values: values(c, [v]) })) : null)),
	"Config.Literals": make((c, [vs, name], mode) => (vs ? setting(c, mode, name, c.say.config.oneOf({ values: values(c, [vs]) })) : null)),
	"Config.schema": make((c, [schema, name], mode) => (schema ? setting(c, mode, name, schemaType(c, schema, false)!) : null)),
	"Config.Array": make((c, [schema, name], mode) => (schema ? setting(c, mode, name, c.say.config.listOf({ kind: schemaType(c, schema, false)! })) : null)),
	"ConfigProvider.fromUnknown": make((c, args) => source(c, args)),
	"ConfigProvider.fromDotEnv": make((c, args) => source(c, args)),
	"ConfigProvider.layer": make((c, [p]) => (p ? D(c.say.config.providerLayer({ provider: c.e.noun(p).t })) : null)),
};

const V3_KINDS: Record<string, Kind> = { string: "string", number: "number", integer: "integer", boolean: "boolean", url: "url", duration: "duration" };
/** `Config.string()` as an item kind inside `Config.array(...)`. */
function kindOf(c: Ctx, call: N): string | null {
	const callee = unwrap(call.callee);
	const m = callee?.type === "MemberExpression" && unwrap(callee.object)?.name === "Config" ? callee.property.name : null;
	return m && V3_KINDS[m] ? c.say.config.kinds[V3_KINDS[m]] : null;
}

/** `Config` settings and `ConfigProvider` sources: v3 uses lower-case constructors, v4 PascalCase ones backed by Schema. */
export const configOps = { shared, v3, v4 };
