/** A strict reader for the inline HTML core's report emits (spans, links, marks, a details marker), as plain data. */

export type MElement = { tag: string; attrs: Record<string, string>; children: MNode[] };
export type MNode = string | MElement;

const TAGS = new Set(["span", "a", "mark", "wbr", "del", "ins", "b"]);
const VOID = new Set(["wbr", "br"]);
const ATTRS = new Set(["class", "title", "href", "data-n", "data-details"]);
const SAFE_HREF = /^(https:\/\/|\/(?!\/)|#)/;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
export const decodeEntities = (s: string) =>
	s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
		if (e[0] === "#") {
			const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
			return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
		}
		return ENTITIES[e.toLowerCase()] ?? m;
	});

const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;
const ATTR = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function readAttrs(src: string, tag: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of src.matchAll(ATTR)) {
		const name = m[1]!.toLowerCase();
		const value = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
		if (!ATTRS.has(name) || (name === "href" && (tag !== "a" || !SAFE_HREF.test(value)))) continue;
		out[name] = value;
	}
	return out;
}

/** Parses into allowlisted elements and text; other tags are dropped (their text kept), so nothing executable survives. */
export function parseMarkup(html: string): MNode[] {
	const root: MElement = { tag: "#root", attrs: {}, children: [] };
	const stack: MElement[] = [root];
	const top = () => stack[stack.length - 1]!;
	const text = (s: string) => {
		if (!s) return;
		const t = decodeEntities(s);
		const kids = top().children;
		if (typeof kids[kids.length - 1] === "string") kids[kids.length - 1] += t;
		else kids.push(t);
	};
	let last = 0;
	for (const m of html.matchAll(TAG)) {
		text(html.slice(last, m.index));
		last = m.index! + m[0].length;
		const [, close, rawTag, attrs, selfClose] = m;
		const tag = rawTag!.toLowerCase();
		if (!TAGS.has(tag)) continue;
		if (close) {
			const at = stack.findLastIndex((el) => el.tag === tag);
			if (at > 0) stack.length = at;
			continue;
		}
		const el: MElement = { tag, attrs: readAttrs(attrs ?? "", tag), children: [] };
		top().children.push(el);
		if (!VOID.has(tag) && !selfClose) stack.push(el);
	}
	text(html.slice(last));
	return root.children;
}

const firstText = (nodes: MNode[]): string => {
	for (const n of nodes) {
		if (typeof n === "string") return n;
		const t = firstText(n.children);
		if (t) return t;
	}
	return "";
};

/** Our inline markup kinds mapped onto GitHub's syntax-highlight classes. */
export function githubify(nodes: MNode[]): MNode[] {
	return nodes.map((n) => {
		if (typeof n === "string") return n;
		const children = githubify(n.children);
		const cls = n.attrs.class;
		if (n.tag === "mark" && cls === "chg") return { tag: "span", attrs: { ...n.attrs, class: "x x-first x-last" }, children };
		if (n.tag !== "span") return { ...n, children };
		const mapped =
			cls === "f"
				? "pl-en"
				: cls === "t"
					? "pl-smi pe-type"
					: cls === "c"
						? "pl-c1"
						: cls === "l"
							? firstText(n.children).startsWith('"')
								? "pl-s"
								: "pl-c1"
							: cls;
		return { ...n, attrs: mapped === undefined ? n.attrs : { ...n.attrs, class: mapped }, children };
	});
}

const isDetails = (n: MNode): boolean => typeof n !== "string" && n.tag === "wbr" && "data-details" in n.attrs;

/** Splits at a heading's details marker, cloning any element that straddles it; `after` is null when there's no marker. */
export function splitDetails(nodes: MNode[]): { before: MNode[]; after: MNode[] | null } {
	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i]!;
		if (isDetails(n)) return { before: nodes.slice(0, i), after: nodes.slice(i + 1) };
		if (typeof n === "string") continue;
		const inner = splitDetails(n.children);
		if (inner.after === null) continue;
		const before = [...nodes.slice(0, i), ...(inner.before.length ? [{ ...n, children: inner.before }] : [])];
		const after = [...(inner.after.length ? [{ ...n, children: inner.after }] : []), ...nodes.slice(i + 1)];
		return { before, after };
	}
	return { before: nodes, after: null };
}

export const textOf = (nodes: MNode[]): string => nodes.map((n) => (typeof n === "string" ? n : textOf(n.children))).join("");
