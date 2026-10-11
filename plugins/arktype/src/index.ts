import { D, mk } from "@usenarrator/core";
import { type CallRule, type CondRule, definePlugin, type Engine, type N, type StmtRule, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { parseDef, type Shape } from "./dsl";
import { en } from "./en";
import type { ArkTypePhrases as __PluginPhrases, ArkTypePhrases } from "./phrases";

export { en } from "./en";
export type { ArkTypePhrases } from "./phrases";

type Say = ArkTypePhrases;

/** The local name `type` (or an alias) imported from arktype. */
function typeName(e: Engine): string | null {
	for (const [local, { from, name }] of e.imports) if (from === "arktype" && (name === "type" || name === "ark")) return local;
	return null;
}

const literalString = (n: N): string | null => {
	const u = unwrap(n);
	if (u?.type === "Literal" && typeof u.value === "string") return u.value;
	if (u?.type === "TemplateLiteral" && !u.expressions.length) return u.quasis[0].value.cooked;
	return null;
};

/** `a.b(x).c(y)` -> root `a`, steps `[b(x), c(y)]`. */
function chainOf(node: N): { root: N; steps: { m: string; args: N[] }[] } {
	const steps: { m: string; args: N[] }[] = [];
	let cur = unwrap(node);
	while (cur?.type === "CallExpression" && unwrap(cur.callee).type === "MemberExpression" && !unwrap(cur.callee).computed) {
		const c = unwrap(cur.callee);
		steps.unshift({ m: c.property.name, args: cur.arguments });
		cur = unwrap(c.object);
	}
	return { root: cur, steps };
}

const STATICS = new Set(["enumerated", "unit", "instanceOf", "or", "and", "merge", "pipe", "raw"]);
const METHODS = new Set([
	"array",
	"or",
	"and",
	"merge",
	"pipe",
	"narrow",
	"to",
	"optional",
	"default",
	"describe",
	"brand",
	"configure",
	"onUndeclaredKey",
	"onDeepUndeclaredKey",
]);

/** A definition value: a string DSL, an object, a tuple expression, or another schema. */
function defShape(e: Engine, say: Say, n: N): Shape {
	const u = unwrap(n);
	const s = literalString(u);
	if (s !== null) return parseDef(e, say, s);
	if (u?.type === "ObjectExpression") return { type: objectText(e, say, u), modifiers: [] };
	if (u?.type === "ArrayExpression") return tupleShape(e, say, u.elements.filter(Boolean));
	return shape(e, say, n) ?? { type: e.text(n), modifiers: [] };
}

const describeDef = (e: Engine, say: Say, n: N) => say.withModifiers(defShape(e, say, n));

/** Tuple expressions: `["string", "=", "x"]`, `["string", "|", "number"]`, `["number", "%", 2]`, `["instanceof", Date]`, or a real tuple. */
function tupleShape(e: Engine, say: Say, els: N[]): Shape {
	const m = say.modifiers;
	const head = literalString(els[0]);
	if (els.length === 2 && head === "instanceof") return { type: say.instance({ name: e.text(els[1]) }), modifiers: [] };
	if (els.length === 2 && head === "===") return { type: say.literal({ value: e.text(els[1]) }), modifiers: [] };
	const op = literalString(els[1]);
	const inner = () => defShape(e, say, els[0]);
	const add = (x: string) => {
		const s = inner();
		return { type: s.type, modifiers: [...s.modifiers, x] };
	};
	const operand = () => describeDef(e, say, els[2]);
	if (els.length === 2 && op === "?") return add(m.optional);
	if (els.length === 2 && op === "[]") return { type: say.array({ item: describeDef(e, say, els[0]) }), modifiers: [] };
	if (els.length === 3 && op !== null) {
		if (op === "=") return add(m.default({ value: e.text(els[2]) }));
		if (op === "|") return { type: say.union({ options: e.g.list([describeDef(e, say, els[0]), operand()], "or") }), modifiers: [] };
		if (op === "&") return { type: say.intersection({ types: e.g.list([describeDef(e, say, els[0]), operand()]) }), modifiers: [] };
		if (op === "=>") return add(m.pipe);
		if (op === ":") return add(m.narrow);
		if (op === "%") return add(m.divisibleBy({ value: e.text(els[2]) }));
		if (op === "@") return add(m.description({ text: e.text(els[2]) }));
		const bound = BOUND_OPS.get(op);
		if (bound) return add((m[lengthy(els[0]) ? bound[1] : bound[0]] as (p: { value: string }) => string)({ value: e.text(els[2]) }));
	}
	return { type: say.tuple({ items: e.g.list(els.map((x) => describeDef(e, say, x))) }), modifiers: [] };
}

type BoundMod =
	| "atLeast"
	| "atMost"
	| "moreThan"
	| "lessThan"
	| "exactly"
	| "lengthAtLeast"
	| "lengthAtMost"
	| "lengthMoreThan"
	| "lengthLessThan"
	| "lengthExactly";
const BOUND_OPS = new Map<string, [BoundMod, BoundMod]>([
	[">=", ["atLeast", "lengthAtLeast"]],
	["<=", ["atMost", "lengthAtMost"]],
	[">", ["moreThan", "lengthMoreThan"]],
	["<", ["lessThan", "lengthLessThan"]],
	["==", ["exactly", "lengthExactly"]],
]);

/** Bounds on text and lists are lengths. */
const lengthy = (n: N) => {
	const s = literalString(n);
	return s !== null && (s.startsWith("string") || s.endsWith("[]"));
};

/** Bound methods (`.atLeast(1)`, `.atMostLength(50)`, `.divisibleBy(2)`) by name. */
const BOUND_METHODS = new Map<string, BoundMod | "divisibleBy" | "matching">([
	["atLeast", "atLeast"],
	["atMost", "atMost"],
	["moreThan", "moreThan"],
	["lessThan", "lessThan"],
	["atOrAfter", "atLeast"],
	["atOrBefore", "atMost"],
	["laterThan", "moreThan"],
	["earlierThan", "lessThan"],
	["atLeastLength", "lengthAtLeast"],
	["atMostLength", "lengthAtMost"],
	["moreThanLength", "lengthMoreThan"],
	["lessThanLength", "lengthLessThan"],
	["exactlyLength", "lengthExactly"],
	["divisibleBy", "divisibleBy"],
	["matching", "matching"],
]);

/** `{ name: "string", "age?": "number" }` -> "an object with name and age". */
function objectText(e: Engine, say: Say, o: N): string {
	const fields: string[] = [];
	const extras: string[] = [];
	for (const p of o.properties) {
		if (p.type === "SpreadElement") {
			fields.push(e.say.expressions.everythingIn({ value: e.text(p.argument) }));
			continue;
		}
		const key = p.computed ? null : p.key?.type === "Identifier" ? p.key.name : p.key?.type === "Literal" ? String(p.key.value) : null;
		if (key === null) continue;
		if (key === "+") {
			const mode = literalString(p.value);
			if (mode === "reject") extras.push(say.rejectsOthers);
			else if (mode === "delete") extras.push(say.dropsOthers);
			continue;
		}
		if (key === "...") {
			fields.push(e.say.expressions.everythingIn({ value: e.text(p.value) }));
			continue;
		}
		const index = key.match(/^\[(.+)\]$/);
		if (index) {
			fields.push(say.anyKey({ key: say.withModifiers(parseDef(e, say, index[1]!)), value: describeDef(e, say, p.value) }));
			continue;
		}
		const name = key.replace(/\?$/, "");
		fields.push(mk("v", e.lex.humanize(name), name));
	}
	if (!fields.length) return say.withModifiers({ type: say.emptyObject, modifiers: extras });
	return say.withModifiers({ type: say.object({ fields: e.g.list(fields) }), modifiers: extras });
}

/** An ArkType schema expression: `type(...)`, `type.enumerated(...)`, and chained `.array()`, `.or()`, `.narrow()`... */
function shape(e: Engine, say: Say, n: N): Shape | null {
	const t = typeName(e);
	if (!t) return null;
	const u = unwrap(n);
	if (u?.type !== "CallExpression") return null;
	const { root, steps } = chainOf(u);
	let s: Shape | null = null;
	let rest = steps;
	const rootCall = rootCallOf(u);
	if (rootCall && unwrap(rootCall.callee)?.type === "Identifier" && unwrap(rootCall.callee).name === t) {
		const args = rootCall.arguments;
		s = args.length > 1 ? tupleShape(e, say, args) : defShape(e, say, args[0]);
	} else if (root?.type === "Identifier" && root.name === t && steps.length && STATICS.has(steps[0]!.m)) {
		const [first, ...more] = steps;
		rest = more;
		const m = first!.m;
		const args = first!.args;
		if (m === "enumerated")
			s = {
				type: say.oneOf({
					options: e.g.list(
						args.map((a: N) => e.text(a)),
						"or",
					),
				}),
				modifiers: [],
			};
		else if (m === "unit") s = { type: say.literal({ value: e.text(args[0]) }), modifiers: [] };
		else if (m === "instanceOf") s = { type: say.instance({ name: e.text(args[0]) }), modifiers: [] };
		else if (m === "or")
			s = {
				type: say.union({
					options: e.g.list(
						args.map((a: N) => describeDef(e, say, a)),
						"or",
					),
				}),
				modifiers: [],
			};
		else if (m === "and" || m === "merge") s = { type: say.intersection({ types: e.g.list(args.map((a: N) => describeDef(e, say, a))) }), modifiers: [] };
		else s = { type: say.modifiers.pipe, modifiers: [] };
	} else if (root?.type === "Identifier" && schemaVars(e).has(root.name) && steps.length && steps.every((x) => METHODS.has(x.m))) {
		s = { type: e.ref(root.name), modifiers: [] };
	}
	if (!s) return null;
	for (const step of rest) s = applyMethod(e, say, s, step);
	return s;
}

/** The innermost call of a chain, e.g. `type({...})` in `type({...}).array().optional()`. */
function rootCallOf(n: N): N | null {
	let cur = unwrap(n);
	while (cur?.type === "CallExpression" && unwrap(cur.callee)?.type === "MemberExpression" && unwrap(unwrap(cur.callee).object)?.type === "CallExpression")
		cur = unwrap(unwrap(cur.callee).object);
	return cur?.type === "CallExpression" && unwrap(cur.callee)?.type === "Identifier" ? cur : null;
}

function applyMethod(e: Engine, say: Say, s: Shape, step: { m: string; args: N[] }): Shape {
	const m = say.modifiers;
	const add = (x: string) => ({ type: s.type, modifiers: [...s.modifiers, x] });
	const whole = say.withModifiers(s);
	switch (step.m) {
		case "array":
			return { type: say.array({ item: whole }), modifiers: [] };
		case "or":
			return { type: say.union({ options: e.g.list([whole, ...step.args.map((a) => describeDef(e, say, a))], "or") }), modifiers: [] };
		case "and":
			return { type: say.intersection({ types: e.g.list([whole, ...step.args.map((a) => describeDef(e, say, a))]) }), modifiers: [] };
		case "merge":
			return { type: say.merged({ type: whole, extra: describeDef(e, say, step.args[0]) }), modifiers: [] };
		case "pipe":
			return add(m.pipe);
		case "narrow":
			return add(m.narrow);
		case "to":
			return add(m.to({ type: describeDef(e, say, step.args[0]) }));
		case "optional":
			return add(m.optional);
		case "default":
			return add(m.default({ value: e.text(step.args[0]) }));
		case "describe":
			return add(m.description({ text: e.text(step.args[0]) }));
		case "brand":
			return add(m.brand({ name: e.text(step.args[0]) }));
		case "partial":
		case "required":
			return { type: say[step.m]({ type: whole }), modifiers: [] };
		case "pick":
		case "omit":
			return {
				type: say[step.m]({ type: whole, keys: e.g.list(step.args.map((a) => (literalString(a) !== null ? e.prop(literalString(a)!) : e.text(a)))) }),
				modifiers: [],
			};
		case "keyof":
			return { type: say.keyof({ type: whole }), modifiers: [] };
		case "onUndeclaredKey":
		case "onDeepUndeclaredKey": {
			const mode = literalString(step.args[0]);
			return mode === "reject" ? add(say.rejectsOthers) : mode === "delete" ? add(say.dropsOthers) : s;
		}
		default: {
			const bound = BOUND_METHODS.get(step.m);
			if (!bound) return s;
			const value = e.text(step.args[0]);
			return add(bound === "matching" ? m.matching({ pattern: value }) : (m[bound] as (p: { value: string }) => string)({ value }));
		}
	}
}

export const describe = (e: Engine, n: N, say: Say): string | null => {
	const s = shape(e, say, n);
	return s && say.withModifiers(s);
};

const schemaCache = new WeakMap<object, Set<string>>();

/** Names this file binds to an ArkType schema: `const User = type({...})`. */
function schemaVars(e: Engine): Set<string> {
	const program = e.program;
	if (!program) return new Set();
	const hit = schemaCache.get(program);
	if (hit) return hit;
	const names = new Set<string>();
	schemaCache.set(program, names);
	const t = typeName(e);
	if (!t) return names;
	const visit = (n: N) => {
		if (!n || typeof n !== "object") return;
		if (Array.isArray(n)) return n.forEach(visit);
		if (n.type === "VariableDeclarator" && n.id?.type === "Identifier") {
			const root = rootCallOf(n.init) ?? unwrap(n.init);
			const callee = unwrap(root?.callee);
			const head = callee?.type === "MemberExpression" ? unwrap(callee.object) : callee;
			if (head?.type === "Identifier" && head.name === t) names.add(n.id.name);
		}
		for (const k in n) if (n[k] && typeof n[k] === "object") visit(n[k]);
	};
	visit(program.body);
	return names;
}

/** ArkType (arktype.io), v2: string-DSL definitions, objects, unions and chained methods read like the Zod plugin, plus validating by calling a schema. */
export const arktype = (): TsPlugin<Say> => {
	const schemaRule: CallRule<Say> = ({ node, e, say }) => {
		const t = describe(e, node, say);
		return t ? D(say.schema({ type: t })) : null;
	};
	const onSchema =
		(f: (p: { e: Engine; say: Say; schema: string; args: N[]; stmt: boolean }) => string | null): CallRule<Say> =>
		({ e, say, obj, args, stmt }) => {
			const o = unwrap(obj);
			if (o?.type !== "Identifier" || !schemaVars(e).has(o.name)) return null;
			const t = f({ e, say, schema: e.ref(o.name), args, stmt });
			return t ? D(t) : null;
		};
	const assertRule = onSchema(({ e, say, schema, args, stmt }) => (stmt ? say.validate.assertStep : say.validate.assert)({ value: e.text(args[0]), schema }));
	const allows: CondRule<Say> = ({ e, say, obj, args, neg }) => {
		const o = unwrap(obj);
		if (o?.type !== "Identifier" || !schemaVars(e).has(o.name)) return null;
		return D(say.validate.allows({ value: e.text(args[0]), schema: e.ref(o.name), neg }));
	};
	/** `const out = User(data)`: calling a schema validates. */
	const checkStmt: StmtRule<Say> = ({ node, e, say, d }) => {
		if (node.type !== "VariableDeclaration" || node.declarations.length !== 1) return false;
		const v = node.declarations[0];
		const init = unwrap(v.init);
		const callee = unwrap(init?.callee);
		if (
			v.id?.type !== "Identifier" ||
			init?.type !== "CallExpression" ||
			callee?.type !== "Identifier" ||
			!schemaVars(e).has(callee.name) ||
			init.arguments.length !== 1
		)
			return false;
		const value = say.validate.check({ value: e.text(init.arguments[0]), schema: e.ref(callee.name) });
		e.emitDoc(d, D(e.say.declarations.let({ name: e.ref(v.id.name), value })), node);
		return true;
	};
	const calls: Record<string, CallRule<Say>> = { type: schemaRule };
	for (const m of STATICS) calls[`type.${m}`] = schemaRule;
	for (const m of METHODS) calls[`*.${m}`] = schemaRule;
	calls["*.assert"] = assertRule;
	calls["*.allows"] = onSchema(({ e, say, schema, args }) => say.validate.allows({ value: e.text(args[0]), schema, neg: false }));
	calls["*.export"] = ({ e, say, obj }) => {
		const o = unwrap(obj);
		const callee = unwrap(o?.callee);
		const scope =
			o?.type === "CallExpression" &&
			callee?.type === "Identifier" &&
			e.imports.get(callee.name)?.from === "arktype" &&
			e.imports.get(callee.name)?.name === "scope";
		const defs = scope ? unwrap(o.arguments[0]) : null;
		if (defs?.type !== "ObjectExpression") return null;
		const names = defs.properties.map((p: N) => {
			if (p.type === "SpreadElement") return e.say.expressions.everythingIn({ value: e.text(p.argument) });
			const key = p.key?.type === "Identifier" ? p.key.name : String(p.key?.value ?? e.code(p.key));
			return mk("v", e.lex.humanize(key.replace(/^#/, "")), key);
		});
		return D(say.scope({ names: e.g.list(names) }));
	};
	return definePlugin<Say>({
		name: "arktype",
		library: { name: "arktype", versions: ">=2 <3" },
		phrases: { en },
		calls,
		conditions: { "*.allows": allows },
		statements: [checkStmt],
		members: { "type.errors": ({ e, say }) => (typeName(e) === "type" ? D(say.errors) : null) },
		describeSchema: describe,
	});
};

declare module "@usenarrator/core" {
	interface PluginPhrases {
		arktype: __PluginPhrases;
	}
}
