import type { MNode } from "./markup";

type Attrs = Record<string, string | number | false | null | undefined>;
export type Child = Node | string | null | undefined | false | Child[];

/** Builds an element: attributes set one by one (falsy ones skipped), children appended as nodes or text. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	for (const [name, value] of Object.entries(attrs)) if (value !== false && value !== null && value !== undefined) el.setAttribute(name, String(value));
	append(el, children);
	return el;
}

export function append(parent: Node, children: Child[]) {
	for (const c of children) {
		if (c === null || c === undefined || c === false) continue;
		if (Array.isArray(c)) append(parent, c);
		else parent.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
	}
}

/** DOM nodes for parsed markup; tags and attributes were allowlisted by `parseMarkup`. */
export const render = (nodes: MNode[]): Node[] =>
	nodes.map((n) => (typeof n === "string" ? document.createTextNode(n) : h(n.tag as keyof HTMLElementTagNameMap, n.attrs, render(n.children))));
