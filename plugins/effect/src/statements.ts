import { capFirst, D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import {
	act,
	type Ctx,
	calleeKey,
	delegate,
	endsTheProgram,
	FORKS,
	isFn,
	isPascal,
	isServiceTag,
	layerNoun,
	memberKey,
	objProp,
	serviceName,
	strLit,
	yieldAction,
} from "./context";
import { afterLines } from "./ops/effect";
import { structFields } from "./ops/schema";

const QUEUES = new Set(["Queue.bounded", "Queue.unbounded", "Queue.dropping", "Queue.sliding", "PubSub.subscribe"]);

/** v3 fibers, refs, deferreds and queues are effects themselves, so a later `yield* x` waits on or reads them. */
function remember(c: Ctx, name: string, arg: N) {
	if (c.version === 4) return;
	const key = calleeKey(arg) ?? "";
	if (FORKS.has(key)) c.state.fibers.add(name);
	if (key === "Ref.make" || key === "SynchronizedRef.make" || key === "SubscriptionRef.make") c.state.refs.add(name);
	if (key === "Deferred.make") c.state.deferreds.add(name);
	if (QUEUES.has(key)) c.state.queues.add(name);
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
		if ((arg.type === "Identifier" && isPascal(arg) && !c.state.fibers.has(arg.name)) || isServiceTag(arg)) {
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
	const at = c.e.lines.length;
	c.e.fnDecl(decl.id.name, unwrap(fn), n, d);
	const span = curriedFn ? strLit(inner.arguments[0]) : null;
	if (span !== null && span !== decl.id.name)
		c.e.lines.splice(at + 1, 0, {
			d: d + 1,
			text: `${c.say.span.fnSpan({ name: c.e.literal({ type: "Literal", value: span }) })}.`,
			start: n.start,
			end: n.end,
			kind: "stmt",
		});
	for (const l of afterLines(c, pipes)) c.e.lines.push({ ...l, d: l.d + d + 1, start: n.start, end: n.end });
	return true;
}

type ClassInfo = { heading: string; extra: Doc[] };

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
		const v = c.e.noun(built);
		extra.push(D(s.built({ effect: v.t }), v.kids));
	}
	const succeed = objProp(opts, "succeed");
	if (succeed) {
		const v = c.e.noun(succeed);
		extra.push(D(s.alwaysProvides({ value: v.t }), v.kids));
	}
	const sync = objProp(opts, "sync");
	if (sync) {
		const ex = isFn(sync) ? c.e.lambdaExpr(unwrap(sync)) : null;
		const v = c.e.noun(ex ?? sync);
		extra.push(D(s.computed({ value: v.t }), v.kids));
	}
	const deps = objProp(opts, "dependencies");
	if (deps && unwrap(deps).type === "ArrayExpression" && unwrap(deps).elements.length)
		extra.push(D(s.needs({ deps: c.e.g.list(unwrap(deps).elements.map((x: N) => layerNoun(c, x))) })));
	if (unwrap(objProp(opts, "accessors"))?.value === true) extra.push(D(s.accessors({ name })));
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
			return { heading: f ? d.errorTypeFields({ name, fields: f }) : d.errorType({ name }), extra: [] };
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
			return { heading: f ? d.errorTypeFields({ name, fields: f }) : d.errorType({ name }), extra: [] };
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
