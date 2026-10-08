import { capFirst, D, type Doc } from "@narrate/core";
import { type N, unwrap } from "@narrate/lang-ts";
import { act, type Ctx, calleeKey, curriedCall, isFn, isPascal, memberKey, noun, objProp } from "./context";
import { afterLines, serviceName } from "./ops/effect";
import { structFields } from "./ops/schema";

const delegate = (n: N) => {
	const u = unwrap(n);
	return u?.type === "YieldExpression" && u.delegate ? unwrap(u.argument) : null;
};

const FAILS = new Set(["Effect.fail", "Effect.failSync", "Effect.die", "Effect.dieMessage", "Effect.interrupt"]);
const FORKS = new Set(["Effect.fork", "Effect.forkDaemon", "Effect.forkScoped", "Effect.forkChild", "Effect.forkDetach", "Effect.forkIn"]);
const endsTheProgram = (arg: N) => arg.type === "NewExpression" || FAILS.has(calleeKey(arg) ?? "");

/** What `yield* arg` does, as an action. */
function yieldAction(c: Ctx, arg: N): Doc {
	const y = c.say.yield;
	if (arg.type === "NewExpression") {
		const err = c.e.noun(arg);
		return D(y.failWith({ error: err.t }), err.kids);
	}
	if (arg.type === "Identifier") {
		const name = c.e.ref(arg.name);
		if (c.state.fibers.has(arg.name)) return D(y.awaitFiber({ fiber: name }));
		if (c.state.refs.has(arg.name)) return D(y.readRef({ ref: name }));
		if (c.state.deferreds.has(arg.name)) return D(y.awaitDeferred({ deferred: name }));
		if (isPascal(arg)) return D(y.service({ service: serviceName(c, arg) }));
	}
	return act(c, arg);
}

/** v3 fibers, refs and deferreds are effects themselves, so a later `yield* x` waits on or reads them. */
function remember(c: Ctx, name: string, arg: N) {
	if (c.version === 4) return;
	const key = calleeKey(arg) ?? "";
	if (FORKS.has(key)) c.state.fibers.add(name);
	if (key === "Ref.make" || key === "SynchronizedRef.make") c.state.refs.add(name);
	if (key === "Deferred.make") c.state.deferreds.add(name);
}

/** `const x = yield* X`, `yield* X;`, `return yield* X`: each reads as one step. */
export function yieldStatement(c: Ctx, n: N, d: number): boolean {
	const y = c.say.yield;
	if (n.type === "ExpressionStatement") {
		const arg = delegate(n.expression);
		if (!arg) return false;
		c.e.emitDoc(d, yieldAction(c, arg), n);
		return true;
	}
	if (n.type === "ReturnStatement") {
		const arg = delegate(n.argument);
		if (!arg) return false;
		const a = yieldAction(c, arg);
		c.e.emitDoc(d, endsTheProgram(arg) ? a : D(y.giveBack({ action: a.t }), a.kids), n);
		return true;
	}
	if (n.type !== "VariableDeclaration" || n.declarations.length !== 1) return false;
	const decl = n.declarations[0];
	const arg = delegate(decl.init);
	if (!arg) return false;
	const id = decl.id;
	if (id.type === "Identifier") {
		remember(c, id.name, arg);
		const name = c.e.ref(id.name);
		if (arg.type === "Identifier" && isPascal(arg) && !c.state.fibers.has(arg.name)) {
			c.e.emitDoc(d, D(y.bindService({ service: serviceName(c, arg), name })), n);
			return true;
		}
		const a = yieldAction(c, arg);
		c.e.emitDoc(d, D(y.bind({ action: a.t, name }), a.kids), n);
		return true;
	}
	const names = c.e.g.list(c.e.patternNames(id));
	const a = yieldAction(c, arg);
	const phrase = id.type === "ArrayPattern" ? y.bindAll : y.bindFields;
	c.e.emitDoc(d, D(phrase({ action: a.t, names }), a.kids), n);
	return true;
}

/** `const getUser = Effect.fn("getUser")(function* (id) {...})` reads like a function definition. */
export function effectFnDeclaration(c: Ctx, n: N, d: number): boolean {
	if (n.type !== "VariableDeclaration" || n.declarations.length !== 1) return false;
	const decl = n.declarations[0];
	const init = unwrap(decl.init);
	if (decl.id.type !== "Identifier" || init?.type !== "CallExpression") return false;
	const inner = unwrap(init.callee);
	const curriedFn = inner.type === "CallExpression" && /^Effect\.fn(Untraced)?$/.test(calleeKey(inner) ?? "");
	const directFn = /^Effect\.fn(Untraced)?$/.test(calleeKey(init) ?? "") && isFn(init.arguments[0]);
	if (!curriedFn && !directFn) return false;
	const [fn, ...pipes] = init.arguments;
	if (!isFn(fn)) return false;
	c.e.fnDecl(decl.id.name, unwrap(fn), n, d);
	for (const l of afterLines(c, pipes)) c.e.lines.push({ ...l, d: l.d + d + 1, start: n.start, end: n.end });
	return true;
}

/** Statements whose value is a curried Effect builder the engine can't dispatch on its own. */
export function curriedStatement(c: Ctx, n: N, d: number): boolean {
	const p = c.say.common;
	if (n.type === "ReturnStatement" && n.argument) {
		const v = curriedCall(c, n.argument, "noun");
		if (!v) return false;
		c.e.emitDoc(d, D(p.giveBack({ value: v.t }), v.kids), n);
		return true;
	}
	if (n.type === "ExpressionStatement") {
		const v = curriedCall(c, n.expression, "act");
		if (!v) return false;
		c.e.emitDoc(d, v, n);
		return true;
	}
	if (n.type !== "VariableDeclaration" || n.declarations.length !== 1) return false;
	const decl = n.declarations[0];
	if (decl.id.type !== "Identifier" || !decl.init) return false;
	const v = curriedCall(c, decl.init, "noun");
	if (!v) return false;
	c.e.emitDoc(d, D(p.letBe({ name: c.e.ref(decl.id.name), value: v.t }), v.kids), n);
	return true;
}

type ClassInfo = { heading: string; extra: Doc[]; error?: boolean };

/** Fields of a type literal like `<{ readonly id: string; note?: string }>`. */
function typeFields(c: Ctx, t: N): string | null {
	if (t?.type !== "TSTypeLiteral" || !t.members.length) return null;
	return c.e.g.list(
		t.members
			.filter((m: N) => m.key)
			.map((m: N) => {
				const key = m.key.name ?? String(m.key.value);
				const name = c.e.prop(key);
				const type = c.e.typeText(m.typeAnnotation?.typeAnnotation);
				return m.optional ? c.say.data.optionalField({ name, type }) : c.say.data.field({ name, type });
			}),
	);
}

const typeArgs = (n: N): N[] => n?.typeArguments?.params ?? n?.typeParameters?.params ?? [];

function serviceInfo(c: Ctx, name: string, shape: N | null, opts: N | null): ClassInfo {
	const s = c.say.service;
	const members = shape?.type === "TSTypeLiteral" ? shape.members.filter((m: N) => m.key).map((m: N) => c.e.prop(m.key.name ?? String(m.key.value))) : [];
	const heading = members.length ? s.offering({ name, members: c.e.g.list(members) }) : s.heading({ name });
	const extra: Doc[] = [];
	const built = objProp(opts, "effect") ?? objProp(opts, "scoped") ?? objProp(opts, "make");
	if (built) {
		const v = noun(c, built);
		extra.push(D(s.built({ effect: v.t }), v.kids));
	}
	const succeed = objProp(opts, "succeed");
	if (succeed) {
		const v = noun(c, succeed);
		extra.push(D(s.alwaysProvides({ value: v.t }), v.kids));
	}
	const sync = objProp(opts, "sync");
	if (sync) {
		const ex = isFn(sync) ? c.e.lambdaExpr(unwrap(sync)) : null;
		const v = noun(c, ex ?? sync);
		extra.push(D(s.computed({ value: v.t }), v.kids));
	}
	const deps = objProp(opts, "dependencies");
	if (deps && unwrap(deps).type === "ArrayExpression" && unwrap(deps).elements.length)
		extra.push(D(s.needs({ deps: c.e.g.list(unwrap(deps).elements.map((x: N) => noun(c, x).t)) })));
	return { heading, extra };
}

/** Recognises Effect base classes: services, tagged errors, data and schema classes. */
function classInfo(c: Ctx, n: N): ClassInfo | null {
	const sc = unwrap(n.superClass);
	if (!sc || !n.id) return null;
	const name = c.e.fnRef(n.id.name, n.id.name);
	const d = c.say.data;
	const superArgs = typeArgs({ typeArguments: n.superTypeArguments, typeParameters: n.superTypeParameters });
	const dataLike = (key: string | null) => {
		if (key === "Data.TaggedError" || key === "Data.Error") {
			const f = typeFields(c, superArgs[0]);
			return { heading: f ? d.errorTypeFields({ name, fields: f }) : d.errorType({ name }), extra: [], error: true };
		}
		if (key === "Data.TaggedClass" || key === "Data.Class") {
			const f = typeFields(c, superArgs[0]);
			return { heading: f ? d.dataTypeFields({ name, fields: f }) : d.dataType({ name }), extra: [] };
		}
		return null;
	};
	if (sc.type === "MemberExpression") return dataLike(memberKey(sc));
	if (sc.type !== "CallExpression") return null;
	const direct = dataLike(calleeKey(sc));
	if (direct) return direct;
	const inner = unwrap(sc.callee);
	const key = inner.type === "CallExpression" ? calleeKey(inner) : null;
	const fieldsFrom = (obj: N) => structFields(c, obj);
	switch (key) {
		case "Context.Tag":
		case "Effect.Tag":
			return serviceInfo(c, name, typeArgs(sc)[1] ?? null, null);
		case "Effect.Service":
			return serviceInfo(c, name, null, sc.arguments[1] ?? null);
		case "Context.Service":
		case "ServiceMap.Service":
			return serviceInfo(c, name, typeArgs(inner)[1] ?? null, sc.arguments[1] ?? null);
		case "Context.Reference": {
			const def = objProp(sc.arguments[1], "defaultValue");
			if (!def) return serviceInfo(c, name, typeArgs(inner)[1] ?? null, null);
			const ex = isFn(def) ? c.e.lambdaExpr(unwrap(def)) : null;
			return { heading: c.say.service.reference({ name, value: c.e.noun(ex ?? def).t }), extra: [] };
		}
		case "Schema.TaggedError":
		case "Schema.TaggedErrorClass": {
			const f = fieldsFrom(sc.arguments[1]);
			return { heading: f ? d.errorTypeFields({ name, fields: f }) : d.errorType({ name }), extra: [], error: true };
		}
		case "Schema.Class":
		case "Schema.TaggedClass": {
			const f = fieldsFrom(sc.arguments[key === "Schema.Class" ? 0 : 1]);
			return { heading: f ? d.schemaClass({ name, fields: f }) : d.dataType({ name }), extra: [] };
		}
	}
	return null;
}

/** Effect base classes get a one-line heading; any class members are narrated beneath it as usual. */
export function classStatement(c: Ctx, n: N, d: number): boolean {
	if (n.type !== "ClassDeclaration") return false;
	const info = classInfo(c, n);
	if (!info) return false;
	if (info.error) c.e.errorNames.add(n.id.name);
	const at = c.e.lines.length;
	const outer = c.state.currentClass;
	c.state.currentClass = n.id.name;
	const members = n.body.body.length > 0;
	const block = members || info.extra.length > 0;
	if (members) {
		c.e.classDecl({ ...n, superClass: null }, d);
		c.e.lines[at] = { ...c.e.lines[at]!, text: `${capFirst(info.heading)}:`, kind: "head" };
	} else c.e.emit(d, `${capFirst(info.heading)}${block ? ":" : "."}`, n, block ? "head" : "note");
	const rest = c.e.lines.splice(at + 1);
	for (const doc of info.extra) c.e.emitDoc(d + 1, doc, n);
	c.e.lines.push(...rest);
	c.state.currentClass = outer;
	return true;
}

/** v4 `Service.use((svc) => ...)` / `useSync`. */
export function useRule(c: Ctx, obj: N | null, args: N[], mode: "noun" | "act"): Doc | null {
	if (!obj || !isPascal(obj) || !isFn(args[0])) return null;
	const fn = unwrap(args[0]);
	const p = fn.params[0];
	const ex = c.e.lambdaExpr(fn);
	const action = ex ? act(c, ex) : D(c.say.common.doThis, c.e.body(fn.body, 0));
	const service = serviceName(c, obj);
	if (p?.type === "Identifier") return D(c.say.service.use[mode]({ service, name: c.e.ref(p.name), action: action.t }), action.kids);
	return D(c.say.service.useAnon[mode]({ service, action: action.t }), action.kids);
}
