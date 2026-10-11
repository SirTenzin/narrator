import { capFirst, D, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { reactName } from "./facts";
import { uiDoc } from "./jsx";
import { type Ctx, fits, hasJsx, isFn, isNullish, paramsOf, returnsJsx, returnsOf } from "./shared";

/** How a component's heading reads; hosts like Next.js pass their own ("the page at /users/:id"). */
export type Heads = {
	head: (p: { props: string | null; trait: string | null }) => string;
	inline: (p: { props: string | null; trait: string | null; ui: string }) => string;
};

export type Component = { name: string; fn: N; traits: string[] };

const isComponentName = (name: string | undefined) => !!name && /^[A-Z]/.test(name);

/** Peels `memo(…)` and `forwardRef(…)` off a component, noting what each adds. */
function unwrapComponent(c: Ctx, n: N, traits: string[] = []): { fn: N; traits: string[] } | null {
	const u = unwrap(n);
	if (isFn(u)) return returnsJsx(u) ? { fn: u, traits } : null;
	if (u?.type !== "CallExpression") return null;
	const kind = reactName({ e: c.e, facts: c.facts }, u.callee);
	if (kind !== "memo" && kind !== "forwardRef") return null;
	const inner = unwrapComponent(c, u.arguments[0], traits);
	if (!inner) return null;
	if (kind === "memo") return { fn: inner.fn, traits: [...inner.traits, c.say.component.memo] };
	const ref = inner.fn.params[1];
	return { fn: inner.fn, traits: ref ? [...inner.traits, c.say.component.forwardRef({ ref: c.e.text(ref) })] : inner.traits };
}

/** The component a top-level statement declares: `function Card()`, `const Card = memo(() => …)`, `export default …`. */
export function findComponent(c: Ctx, node: N): Component | null {
	if (!c.facts.active) return null;
	if (node.type === "ExportNamedDeclaration") return node.declaration ? findComponent(c, node.declaration) : null;
	if (node.type === "ExportDefaultDeclaration") {
		const decl = node.declaration;
		const name = decl.id?.name ?? c.e.say.declarations.names.defaultExport;
		if (decl.type === "FunctionDeclaration") return returnsJsx(decl) && (!decl.id || isComponentName(decl.id.name)) ? { name, fn: decl, traits: [] } : null;
		const found = unwrapComponent(c, decl);
		return found ? { name: found.fn.id?.name ?? name, ...found } : null;
	}
	if (node.type === "FunctionDeclaration") return isComponentName(node.id?.name) && returnsJsx(node) ? { name: node.id.name, fn: node, traits: [] } : null;
	if (node.type === "VariableDeclaration" && node.declarations.length === 1) {
		const decl = node.declarations[0];
		if (decl.id.type !== "Identifier" || !isComponentName(decl.id.name) || !decl.init) return null;
		const found = unwrapComponent(c, decl.init);
		return found ? { name: decl.id.name, ...found } : null;
	}
	return null;
}

/** "user ID and on select", or "its props" for a `props` object, or null when it takes none. */
function propsOf(c: Ctx, p: N): string | null {
	if (!p) return null;
	const u = p.type === "AssignmentPattern" ? p.left : p;
	if (u.type === "Identifier") return u.name === "props" ? c.say.component.props : c.e.ref(u.name);
	return paramsOf(c.e, [p]);
}

/** Emits a component: one line when it is a single short piece of UI, else a heading and its steps. */
export function renderComponent(c: Ctx, { fn, node, d, title, heads, traits }: { fn: N; node: N; d: number; title: string; heads: Heads; traits: string[] }) {
	const { e, say } = c;
	e.recordParamTypes(fn.params);
	e.collectTypes(fn);
	const props = propsOf(c, fn.params[0]);
	const trait = traits.length ? e.g.list(traits) : null;
	const block = fn.body.type === "BlockStatement" ? fn.body.body : null;
	const only = block?.length === 1 && block[0].type === "ReturnStatement" ? block[0].argument : null;
	const ex = block ? only : fn.body;
	if (ex && hasJsx(ex)) {
		const ui = uiDoc(c, ex);
		if (fits(ui, 100)) {
			const text = capFirst(heads.inline({ props, trait, ui: ui.t }));
			e.headTitles.set(`${text}:`, title);
			e.emit(d, `${text}.`, node, "head");
			return;
		}
		e.emitHead(d, capFirst(heads.head({ props, trait })), title, node);
		e.emitDoc(d + 1, D(say.ui.show({ ui: ui.t }), ui.kids), ex);
		return;
	}
	for (const r of returnsOf(fn)) c.facts.shows.add(r);
	e.emitHead(d, capFirst(heads.head({ props, trait })), title, node);
	e.block(fn.body, d + 1);
}

/** The default heading: "UserList: a component that takes user ID and on select". */
export const componentHeads = (c: Ctx, name: string): Heads => {
	const ref = mk("f", name, name);
	return {
		head: (p) => c.say.component.head({ name: ref, ...p }),
		inline: (p) => c.say.component.inline({ name: ref, ...p }),
	};
};

export function componentStmt(c: Ctx, node: N, d: number): boolean {
	const found = findComponent(c, node);
	if (!found) return false;
	renderComponent(c, { fn: found.fn, node, d, title: found.name, heads: componentHeads(c, found.name), traits: found.traits });
	return true;
}

/** `function useCounter(initial) { … }` reads as a custom hook. */
export function hookDefStmt(c: Ctx, node: N, d: number): boolean {
	if (!c.facts.active) return false;
	const inner = node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration" ? node.declaration : node;
	let name: string | null = null;
	let fn: N = null;
	if (inner?.type === "FunctionDeclaration") [name, fn] = [inner.id?.name, inner];
	else if (inner?.type === "VariableDeclaration" && inner.declarations.length === 1 && inner.declarations[0].id.type === "Identifier") {
		const init = unwrap(inner.declarations[0].init);
		if (isFn(init)) [name, fn] = [inner.declarations[0].id.name, init];
	}
	if (!name || !fn || !/^use[A-Z0-9]/.test(name)) return false;
	const { e, say } = c;
	e.recordParamTypes(fn.params);
	e.collectTypes(fn);
	e.emitHead(d, capFirst(say.component.hook({ name: mk("f", name, name), params: paramsOf(e, fn.params) })), name, node);
	if (fn.body.type === "BlockStatement") e.block(fn.body, d + 1);
	else e.returnLike(fn.body, d + 1, fn.body);
	return true;
}

/** `return <…/>` reads as what the component shows; elsewhere as what the function gives back. */
export function returnStmt(c: Ctx, node: N, d: number): boolean {
	if (node.type !== "ReturnStatement" || !c.facts.active) return false;
	const { e, say } = c;
	const shows = c.facts.shows.has(node);
	const arg = unwrap(node.argument);
	if (isNullish(arg)) {
		if (!shows || (arg && arg.type === "Identifier")) return false;
		e.emit(d, `${capFirst(say.ui.showNothing)}.`, node);
		return true;
	}
	if (!hasJsx(arg) || isFn(arg)) return false;
	const verb = shows ? say.ui.show : say.ui.giveBack;
	if (arg.type === "ConditionalExpression" && !isNullish(arg.consequent) && !isNullish(arg.alternate)) {
		const yes = uiDoc(c, arg.consequent);
		const no = uiDoc(c, arg.alternate);
		const cond = e.cond(arg.test);
		if (!(fits(yes, 50) && fits(no, 50) && fits(cond, 60))) {
			e.emitDoc(d, D(`${say.ui.ifShow({ condition: cond.t })}:`, cond.kids), arg.test);
			e.emitDoc(d + 1, D(verb({ ui: yes.t }), yes.kids), arg.consequent);
			e.emit(d, `${capFirst(say.ui.otherwise)}:`, arg.alternate);
			e.emitDoc(d + 1, D(verb({ ui: no.t }), no.kids), arg.alternate);
			return true;
		}
	}
	const ui = uiDoc(c, arg);
	e.emitDoc(d, D(verb({ ui: ui.t }), ui.kids), node);
	return true;
}
