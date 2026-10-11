import { capFirst, D, type Doc, lowerFirst, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { customHook, elementType, reactName } from "./facts";
import { uiDoc } from "./jsx";
import { type Ctx, depsOf, hasJsx, isFn, keyOf, nameRef, paramsOf, stepsOf } from "./shared";

const scope = (c: Ctx) => ({ e: c.e, facts: c.facts });
const hookOf = (c: Ctx, call: N) => (call?.type === "CallExpression" ? reactName(scope(c), call.callee) : null);
const idName = (p: N): string | null => (p?.type === "Identifier" ? p.name : null);

/** A lazy initializer (`() => load()`) reads as what it gives back. */
function initialText(c: Ctx, n: N): string | null {
	const u = unwrap(n);
	if (!u || (u.type === "Identifier" && u.name === "undefined")) return null;
	if (isFn(u)) {
		const ex = c.e.lambdaExpr(u);
		if (ex) return c.e.text(ex);
	}
	return c.e.text(u);
}

/** `const … = useState(…)` and the other hooks that declare something; true once lines are emitted. */
export function hookDecl(c: Ctx, node: N, d: number): boolean {
	if (node.type !== "VariableDeclaration" || node.declarations.length !== 1) return false;
	const decl = node.declarations[0];
	const init = unwrap(decl.init);
	if (!init) return false;
	if (init.type !== "CallExpression") return jsxDecl(c, decl, init, node, d);
	const hook = hookOf(c, init);
	const doc = hook ? builtinDecl(c, hook, decl, init, node, d) : customDecl(c, decl, init);
	if (doc === true) return true;
	if (!doc) return false;
	c.e.emitDoc(d, doc, node);
	return true;
}

function jsxDecl(c: Ctx, decl: N, init: N, node: N, d: number): boolean {
	if (!c.facts.active || decl.id.type !== "Identifier" || isFn(init) || !hasJsx(init)) return false;
	const ui = uiDoc(c, init);
	c.e.emitDoc(d, D(c.say.ui.let({ name: c.e.ref(decl.id.name), ui: ui.t }), ui.kids), node);
	return true;
}

function builtinDecl(c: Ctx, hook: string, decl: N, call: N, node: N, d: number): Doc | true | null {
	const { e, say } = c;
	const [a0, a1, a2] = call.arguments;
	const els: N[] = decl.id.type === "ArrayPattern" ? decl.id.elements : [];
	const ref = (x: N) => (idName(x) ? e.ref(idName(x)!) : null);
	const single = decl.id.type === "Identifier" ? e.ref(decl.id.name) : null;
	switch (hook) {
		case "useState": {
			const name = ref(els[0]) ?? (els[1] ? e.ref(c.facts.setters.get(idName(els[1])!) ?? "state") : null);
			return name ? D(say.hooks.state({ name, initial: initialText(c, a0) })) : null;
		}
		case "useReducer": {
			const name = ref(els[0]);
			if (!name) return null;
			const initial = a2 ? e.text({ ...call, arguments: [a1], callee: a2, type: "CallExpression" }) : (initialText(c, a1) ?? e.say.expressions.nothing);
			return D(say.hooks.reducer({ name, initial, reducer: e.text(a0), dispatch: ref(els[1]) }));
		}
		case "useRef": {
			if (!single) return null;
			if (c.facts.refs.get(decl.id.name) === "element") {
				const t = elementType(call);
				return D(say.hooks.refElement({ name: single, element: t ? (say.dom.elements[t] ?? say.dom.anElement) : null }));
			}
			return D(say.hooks.refValue({ name: single, initial: initialText(c, a0) }));
		}
		case "useMemo":
			return memoDecl(c, decl, call, node, d);
		case "useCallback":
		case "useEffectEvent":
			return callbackDecl(c, hook, decl, call, node, d);
		case "useTransition":
			return els[1] ? D(say.hooks.transition({ pending: ref(els[0]), start: ref(els[1])! })) : null;
		case "useActionState": {
			const name = ref(els[0]);
			const run = ref(els[1]);
			if (!name || !run) return null;
			const fn = unwrap(a0);
			const block = isFn(fn) && !e.lambdaExpr(fn);
			const action = block ? D(say.hooks.steps, stepsOf(e, fn)) : e.noun(a0);
			return D(say.hooks.actionState({ name, initial: initialText(c, a1) ?? e.say.expressions.nothing, action: action.t, run, pending: ref(els[2]) }), action.kids);
		}
		case "useOptimistic": {
			const name = ref(els[0]);
			return name ? D(say.hooks.optimistic({ name, state: e.text(a0), add: ref(els[1]) })) : null;
		}
		default:
			return null;
	}
}

/** `const total = useMemo(() => …, [items])`. */
function memoDecl(c: Ctx, decl: N, call: N, node: N, d: number): Doc | true | null {
	const { e, say } = c;
	const fn = unwrap(call.arguments[0]);
	if (!isFn(fn)) return null;
	const names = e.patternNames(decl.id);
	if (!names.length) return null;
	const name = e.g.list(names);
	const dep = depsOf(e, call.arguments[1]);
	const when = dep.kind === "when" ? say.hooks.recomputed.when({ deps: dep.deps }) : say.hooks.recomputed[dep.kind];
	const ex = e.lambdaExpr(fn);
	if (ex && !hasJsx(ex)) {
		const v = e.looksBoolean(ex) ? e.wrap(e.cond(ex), (t) => e.say.expressions.whether({ condition: t })) : e.noun(ex);
		return D(say.hooks.memo({ name, value: v.t, when }), v.kids);
	}
	if (ex) {
		const ui = uiDoc(c, ex);
		return D(say.hooks.memo({ name, value: ui.t, when }), ui.kids);
	}
	e.emitDoc(d, D(`${say.hooks.memoBlock({ name, when })}:`, e.body(fn.body, 0)), node);
	return true;
}

/** `const onSave = useCallback(async () => …, [id])` reads as a function heading with its steps. */
function callbackDecl(c: Ctx, hook: string, decl: N, call: N, node: N, d: number): true | null {
	const { e, say } = c;
	const fn = unwrap(call.arguments[0]);
	if (!isFn(fn) || decl.id.type !== "Identifier") return null;
	const name = mk("f", capFirst(e.lex.humanize(decl.id.name)), decl.id.name);
	const params = paramsOf(e, fn.params);
	e.localFns.add(decl.id.name);
	let head: string;
	if (hook === "useEffectEvent") head = say.hooks.effectEvent({ name, params });
	else {
		const dep = depsOf(e, call.arguments[1]);
		const when = dep.kind === "when" ? say.hooks.kept.when({ deps: dep.deps }) : say.hooks.kept[dep.kind];
		head = say.hooks.callback({ name, when, params });
	}
	e.emitHead(d, head, name, node);
	for (const l of stepsOf(e, fn)) e.lines.push({ ...l, d: l.d + d + 1 });
	return true;
}

/** `const { data } = useCusQuery()` -> "Get data from useCusQuery." */
function customDecl(c: Ctx, decl: N, call: N): Doc | null {
	const hook = customHook(scope(c), call);
	if (!hook) return null;
	const { e, say } = c;
	const names = e.patternNames(decl.id);
	if (!names.length) return null;
	const args = e.argList(call.arguments);
	const text = say.hooks.custom({ hook: nameRef(hook), args: args.kids.length || !args.t ? null : e.argItems(call.arguments).joined });
	return D(say.hooks.customGet({ names: e.g.list(names), hook: text }), args.kids.length ? [...e.bullet(D(args.t.replace(/:$/, ""), args.kids))] : []);
}

/** Effects, imperative handles, setters, dispatches and transitions used as statements. */
export function hookStatement(c: Ctx, node: N, d: number): boolean {
	if (node.type !== "ExpressionStatement") return false;
	const call = unwrap(node.expression);
	if (call?.type !== "CallExpression") return false;
	const { e, say } = c;
	const hook = hookOf(c, call);
	if (hook === "useEffect" || hook === "useLayoutEffect" || hook === "useInsertionEffect") return effect(c, hook, call, node, d);
	if (hook === "useImperativeHandle") {
		const fn = unwrap(call.arguments[1]);
		const obj = fn && isFn(fn) ? unwrap(e.lambdaExpr(fn)) : null;
		const keys = obj?.type === "ObjectExpression" ? obj.properties.map(keyOf).filter(Boolean) : [];
		if (!keys.length) return false;
		e.emitDoc(d, D(say.hooks.imperativeHandle({ ref: e.text(call.arguments[0]), methods: e.g.list(keys.map((k: string) => e.prop(k))) })), node);
		return true;
	}
	if (hook === "useDebugValue") {
		e.emitDoc(d, D(say.hooks.debugValue({ value: e.text(call.arguments[0]) })), node);
		return true;
	}
	const update = updateDoc(c, call);
	if (update) {
		e.emitDoc(d, update, node);
		return true;
	}
	const callee = unwrap(call.callee);
	const isStart = callee?.type === "Identifier" && (c.facts.transitions.has(callee.name) || c.facts.imports.get(callee.name) === "startTransition");
	if ((isStart || hook === "startTransition") && isFn(call.arguments[0])) {
		e.emitDoc(d, D(`${say.hooks.startTransition}:`, stepsOf(e, call.arguments[0])), node);
		return true;
	}
	const custom = customHook(scope(c), call);
	if (custom) {
		const args = e.argList(call.arguments);
		const text = say.hooks.custom({ hook: nameRef(custom), args: args.kids.length || !args.t ? null : e.argItems(call.arguments).joined });
		e.emitDoc(d, D(say.hooks.customRun({ hook: text }), args.kids.length ? args.kids : []), node);
		return true;
	}
	return false;
}

/** `useEffect(() => { … return () => cleanup() }, [a, b])`. */
function effect(c: Ctx, hook: string, call: N, node: N, d: number): boolean {
	const { e, say } = c;
	const fn = unwrap(call.arguments[0]);
	const dep = depsOf(e, call.arguments[1]);
	const table = hook === "useEffect" ? say.hooks.effect : say.hooks.layoutEffect;
	const head = dep.kind === "when" ? table.when({ deps: dep.deps }) : table[dep.kind];
	if (!isFn(fn)) {
		e.emitDoc(d, D(`${head}:`, e.bullet(e.noun(fn))), node);
		return true;
	}
	e.emit(d, `${capFirst(head)}:`, node);
	const when = dep.kind === "once" ? say.hooks.cleanup.once : say.hooks.cleanup.when;
	const stmts: N[] = fn.body.type === "BlockStatement" ? fn.body.body : [{ type: "ExpressionStatement", expression: fn.body, start: fn.body.start, end: fn.body.end }];
	if (!stmts.length) e.emit(d + 1, `${e.say.statements.doNothing}.`, fn.body, "note");
	for (const st of stmts) {
		if (st.type === "ReturnStatement" && st.argument) {
			cleanup(c, when, st, d + 1);
			continue;
		}
		e.stmt(st, d + 1);
	}
	return true;
}

function cleanup(c: Ctx, when: string, st: N, d: number) {
	const { e, say } = c;
	const arg = unwrap(st.argument);
	if (isFn(arg)) {
		const lines = stepsOf(e, arg);
		if (lines.length === 1 && !lines[0]!.text.endsWith(":")) {
			const action = lines[0]!.text.replace(/\.$/, "");
			e.emit(d, `${capFirst(say.hooks.cleanupWith({ when, action: lowerFirst(action) }))}.`, st);
			return;
		}
		e.emit(d, `${capFirst(when)}:`, st);
		for (const l of lines) e.lines.push({ ...l, d: l.d + d + 1, start: l.start < 0 ? st.start : l.start, end: l.end < 0 ? st.end : l.end });
		return;
	}
	const v = e.noun(arg);
	e.emitDoc(d, D(say.hooks.cleanupWith({ when, action: v.t }), v.kids), st);
}

/** `setCount(c => c + 1)`, `dispatch({ type: "added" })`, `this.setState({ … })`. */
export function updateDoc(c: Ctx, call: N): Doc | null {
	const { e, say, facts } = c;
	const callee = unwrap(call.callee);
	if (callee?.type !== "Identifier") return null;
	const state = facts.setters.get(callee.name);
	if (state) return setterDoc(c, state, call.arguments[0]);
	const reducer = facts.dispatchers.get(callee.name);
	if (reducer) {
		const a = unwrap(call.arguments[0]);
		if (a?.type === "ObjectExpression") {
			const type = a.properties.find((p: N) => keyOf(p) === "type");
			if (type) {
				const fields = e.argItems([{ ...a, properties: a.properties.filter((p: N) => p !== type) }]);
				const t = type.value ? e.text(type.value) : e.ref("type");
				return D(say.updates.dispatch({ action: say.updates.action({ type: t, fields: fields.items.length ? fields.joined : null }) }));
			}
		}
		const v = e.noun(a);
		return D(say.updates.dispatch({ action: v.t }), v.kids);
	}
	return null;
}

function setterDoc(c: Ctx, state: string, arg: N): Doc {
	const { e, say } = c;
	const name = e.ref(state);
	const a = unwrap(arg);
	if (!a) return D(say.updates.set({ name, value: e.say.expressions.nothing }));
	const isToggle = (x: N, param: string) => x?.type === "UnaryExpression" && x.operator === "!" && unwrap(x.argument)?.type === "Identifier" && unwrap(x.argument).name === param;
	if (isToggle(a, state)) return D(say.updates.toggle({ name }));
	if (!isFn(a)) {
		const v = e.looksBoolean(a) ? e.cond(a) : e.noun(a);
		return D(say.updates.set({ name, value: v.t }), v.kids);
	}
	const param = a.params[0]?.type === "Identifier" ? a.params[0].name : null;
	return e.withAlias(
		a,
		() => name,
		() => {
			const body = e.lambdaExpr(a);
			const u = unwrap(body);
			if (!u) return D(`${say.updates.update({ name })}:`, e.body(a.body, 0));
			if (param && isToggle(u, param)) return D(say.updates.toggle({ name }));
			if (param && u.type === "ArrayExpression" && unwrap(u.elements[0])?.type === "SpreadElement" && unwrap(u.elements[0].argument)?.name === param && u.elements.length > 1) {
				const rest = u.elements.slice(1).map((x: N) => e.text(x));
				return D(say.updates.add({ name, value: e.g.list(rest) }));
			}
			const v = e.looksBoolean(u) ? e.cond(u) : e.noun(u);
			return D(say.updates.set({ name, value: v.t }), v.kids);
		},
	);
}
