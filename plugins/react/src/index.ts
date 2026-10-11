import { D, type Doc } from "@usenarrator/core";
import { type CallRule, definePlugin, type Engine, type JsxRule, type MemberRule, type N, type StmtRule, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import { componentHeads, componentStmt, findComponent, type Heads, hookDefStmt, renderComponent, returnStmt } from "./components";
import { en } from "./en";
import { factsReader, reactName } from "./facts";
import { hookDecl, hookStatement } from "./hooks";
import { eachOfDoc, uiDoc } from "./jsx";
import type { DomMethod, ReactPhrases } from "./phrases";
import { type Ctx, type ElementRule, isFn, isJsxMap, nameRef } from "./shared";

export { en } from "./en";
export type { DomEvent, DomMethod, InputType, ReactPhrases, Tag } from "./phrases";
export type { ElementRule, Heads };

export type ReactOptions = {
	/** Readings for host-library elements, keyed by JSX tag (`Link`, `Image`); a rule returns null to pass. */
	elements?: Record<string, ElementRule>;
};

type Site = { node: N; args: N[]; obj: N | null; stmt: boolean };
type Rule = (c: Ctx, site: Site) => Doc | string | null;

/** A React export used as a value; the rule only runs when the callee really is React's. */
const exported =
	(name: string, f: Rule): Rule =>
	(c, site) =>
		reactName({ e: c.e, facts: c.facts }, site.node.callee) === name ? f(c, site) : null;

const contextName = (c: Ctx, n: N) => {
	const u = unwrap(n);
	return u?.type === "Identifier" ? nameRef(u.name) : c.e.text(n);
};

const isContext = (c: Ctx, n: N) => {
	const u = unwrap(n);
	return u?.type === "Identifier" && (c.facts.contexts.has(u.name) || /Context$/.test(u.name));
};

/** `import("./Chart")` inside `lazy(() => …)`. */
const importPath = (c: Ctx, fn: N): string | null => {
	const body = isFn(fn) ? unwrap(c.e.lambdaExpr(unwrap(fn))) : null;
	return body?.type === "ImportExpression" ? c.e.text(body.source) : null;
};

const isRoot = (c: Ctx, n: N) => {
	const u = unwrap(n);
	if (u?.type === "Identifier") return c.facts.roots.has(u.name);
	return u?.type === "CallExpression" && reactName({ e: c.e, facts: c.facts }, u.callee) === "createRoot";
};

const valueRules: Record<string, Rule> = {
	useContext: ({ say, e }, { args }) => say.hooks.context({ context: contextName({ say, e } as Ctx, args[0]) }),
	use: (c, { args }) =>
		isContext(c, args[0]) ? c.say.hooks.context({ context: contextName(c, args[0]) }) : c.say.hooks.usePromise({ promise: c.e.text(args[0]) }),
	useId: ({ say }) => say.hooks.id,
	useDeferredValue: ({ say, e }, { args }) => say.hooks.deferred({ value: e.text(args[0]) }),
	useFormStatus: ({ say }) => say.hooks.formStatus,
	useSyncExternalStore: ({ say, e }, { args }) => say.hooks.externalStore({ subscribe: e.text(args[0]), snapshot: e.text(args[1]) }),
	createContext: ({ say, e }, { args }) => say.dom.createContext({ initial: args[0] ? e.text(args[0]) : null }),
	memo: ({ say, e }, { args }) => say.component.memoOf({ component: e.text(args[0]) }),
	forwardRef: ({ say, e }, { args }) => say.component.forwardRefOf({ component: e.text(args[0]) }),
	lazy: (c, { args }) => {
		const path = importPath(c, args[0]);
		return path ? c.say.component.lazy({ path }) : null;
	},
	createRoot: ({ say, e }, { args }) => say.dom.createRoot({ container: e.text(args[0]) }),
	hydrateRoot: (c, { args }) => {
		const ui = uiDoc(c, args[1]);
		return D(c.say.dom.hydrate({ ui: ui.t, container: c.e.text(args[0]) }), ui.kids);
	},
	createPortal: (c, { args }) => {
		const ui = uiDoc(c, args[0]);
		return D(c.say.ui.portal({ ui: ui.t, container: c.e.text(args[1]) }), ui.kids);
	},
};

/** The rule table; React exports are matched both bare (`useId`) and namespaced (`React.useId`). */
function callRules(): Record<string, Rule> {
	const out: Record<string, Rule> = {};
	for (const [name, f] of Object.entries(valueRules)) {
		out[name] = exported(name, f);
		out[`React.${name}`] = exported(name, f);
		out[`ReactDOM.${name}`] = exported(name, f);
	}
	out["*.map"] = (c, { node }) => (c.facts.active && isJsxMap(node) ? eachOfDoc(c, node) : null);
	out["*.flatMap"] = out["*.map"];
	out["*.render"] = (c, { node, obj, args }) => {
		if (!c.facts.active || !obj || !isRoot(c, obj) || !args[0]) return null;
		const ui = uiDoc(c, args[0]);
		const root = unwrap(obj);
		const where = root.type === "CallExpression" ? c.e.text(root.arguments[0]) : c.e.text(root);
		return D(c.say.dom.render({ ui: ui.t, root: where }), ui.kids);
	};
	for (const m of Object.keys(en.dom.methods) as DomMethod[])
		out[`*.${m}`] = (c, { obj, args }) => {
			const u = unwrap(obj);
			if (args.length || u?.type !== "MemberExpression" || u.computed || u.property.name !== "current") return null;
			const root = unwrap(u.object);
			if (root?.type !== "Identifier" || c.facts.refs.get(root.name) !== "element") return null;
			return c.say.dom.methods[m]({ element: c.say.dom.elementRef({ ref: c.e.ref(root.name) }) });
		};
	out["*.setState"] = (c, { obj, args }) => {
		if (!c.facts.active || unwrap(obj)?.type !== "ThisExpression" || unwrap(args[0])?.type !== "ObjectExpression") return null;
		const items = unwrap(args[0]).properties.map((p: N) => {
			if (p.type === "SpreadElement" || p.computed) return c.e.text(p);
			const key = p.key.name ?? String(p.key.value);
			return c.say.updates.set({ name: c.e.prop(key), value: p.shorthand ? c.e.ref(key) : c.e.text(p.value) });
		});
		return c.say.updates.setState({ changes: c.e.g.list(items) });
	};
	return out;
}

/** `inputRef.current` reads as the element or the kept value. */
const currentRule = (c: Ctx, obj: N): string | null => {
	const u = unwrap(obj);
	const kind = u?.type === "Identifier" ? c.facts.refs.get(u.name) : null;
	if (!kind) return null;
	return kind === "element" ? c.say.dom.elementRef({ ref: c.e.ref(u.name) }) : c.say.dom.refValue({ ref: c.e.ref(u.name) });
};

export type ReactKit = {
	plugin: TsPlugin<ReactPhrases>;
	/** Finds a component a statement declares, for hosts that title it themselves. */
	find: (e: Engine, node: N) => { name: string; fn: N; traits: string[] } | null;
	/** Emits a component under a host's heading (e.g. Next.js pages). */
	render: (e: Engine, args: { fn: N; node: N; d: number; title: string; traits: string[]; heads: Heads }) => void;
	/** The default heading for a named component. */
	heads: (e: Engine, name: string) => Heads;
};

/** React with host options; `react()` is the plain plugin. */
export function createReact(options: ReactOptions = {}): ReactKit {
	const read = factsReader();
	let plugin: TsPlugin<ReactPhrases> | null = null;
	const ctx = (e: Engine, say: ReactPhrases): Ctx => ({ e, say, facts: read(e), elements: options.elements ?? {} });
	const sayOf = (e: Engine) => e.phrasesFor(plugin!) as ReactPhrases;
	const calls: Record<string, CallRule<ReactPhrases>> = {};
	for (const [k, r] of Object.entries(callRules())) calls[k] = ({ e, say, node, args, obj, stmt }) => r(ctx(e, say), { node, args, obj, stmt });
	const stmts = [componentStmt, hookDefStmt, hookDecl, hookStatement, returnStmt];
	const statements: StmtRule<ReactPhrases>[] = stmts.map(
		(s) =>
			({ node, e, d, say }) =>
				s(ctx(e, say), node, d),
	);
	const members: Record<string, MemberRule<ReactPhrases>> = { "*.current": ({ e, say, obj }) => currentRule(ctx(e, say), obj) };
	const inside = new Set<N>();
	const jsx: JsxRule<ReactPhrases> = ({ node, e, say }) => {
		if (inside.has(node) || !(e.usesLibrary("react") || e.usesLibrary("next"))) return null;
		inside.add(node);
		try {
			return uiDoc(ctx(e, say), node);
		} finally {
			inside.delete(node);
		}
	};
	plugin = definePlugin<ReactPhrases>({
		name: "react",
		library: { name: "react", versions: ">=18 <20" },
		phrases: { en },
		calls,
		statements,
		members,
		jsx,
	});
	return {
		plugin,
		find: (e, node) => findComponent(ctx(e, sayOf(e)), node),
		render: (e, args) => renderComponent(ctx(e, sayOf(e)), args),
		heads: (e, name) => componentHeads(ctx(e, sayOf(e)), name),
	};
}

/** React (react.dev): components, JSX as UI, hooks, context, Suspense, React 19 actions and react-dom roots. */
export const react = (options: ReactOptions = {}): TsPlugin<ReactPhrases> => createReact(options).plugin;
