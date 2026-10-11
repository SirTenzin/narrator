import { D, type Doc, type Line, mk } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import { reactName } from "./facts";
import type { DomEvent, InputType, Tag } from "./phrases";
import { actionOf, bullets, type Ctx, fits, hasJsx, isFn, isJsxMap, isNullish, paramsOf, returnsOf, same, str } from "./shared";

/** One piece of UI; `text` marks a quoted run of text so its parent can read `a heading "Users"`. */
type Item = Doc & { text?: boolean };

/** Styling and plumbing props that say nothing about what the user sees or does. */
const SKIP =
	/^(className|class|style|key|ref|id|tabIndex|role|asChild|htmlFor|data-.*|aria-.*|xmlns.*|viewBox|fill|stroke.*|d|width|height|sizes|loading|decoding|suppressHydrationWarning|dangerouslySetInnerHTML|as|(enter|leave)(From|To)?)$/;
const FLAGS = /^(disabled|checked|hidden|required|readOnly|open|selected|autoFocus|multiple|defaultChecked|loading|isLoading|isDisabled|isOpen)$/;
/** Wrappers that add nothing a reader needs when they carry no behaviour of their own. */
const TRANSPARENT = new Set(["div", "span", "Fragment", "React.Fragment", "StrictMode", "React.StrictMode", "Profiler", "React.Profiler"]);

const tagOf = (c: Ctx, n: N): string => c.e.code(n.openingElement.name);

const attrsOf = (n: N): N[] => n.openingElement.attributes;

function attrOf(n: N, name: string): N | null {
	const a = attrsOf(n).find((x: N) => x.type === "JSXAttribute" && x.name?.name === name);
	if (!a) return null;
	if (!a.value) return { type: "Literal", value: true, raw: "true", start: a.start, end: a.end };
	return a.value.type === "JSXExpressionContainer" ? a.value.expression : a.value;
}

/** A whole piece of UI as one phrase, or a heading with bullets when it has several parts. */
export function uiDoc(c: Ctx, n: N): Doc {
	const items = itemsOf(c, n);
	if (items.length === 1) return items[0]!;
	if (!items.length) return D(c.say.ui.showNothing);
	return D(c.say.ui.group, bullets(c.e, items));
}

/** The items a node contributes where it sits: wrappers and fragments hand over their children. */
export function itemsOf(c: Ctx, node: N): Item[] {
	const n = unwrap(node);
	if (isNullish(n)) return [];
	if (n.type === "JSXFragment") return childItems(c, n.children);
	if (n.type === "JSXElement") {
		const el = elementOf(c, n);
		return el ?? childItems(c, n.children);
	}
	if (n.type === "JSXExpressionContainer") return itemsOf(c, n.expression);
	if (n.type === "LogicalExpression" && n.operator === "&&" && hasJsx(n.right)) return [onlyIf(c, c.e.cond(n.left), n.right)];
	if (n.type === "ConditionalExpression" && hasJsx(n)) return conditional(c, n);
	if (isJsxMap(n)) return [eachDoc(c, n)];
	if (isFn(n) && hasJsx(n)) return [renderFn(c, n)];
	return [c.e.noun(n)];
}

function onlyIf(c: Ctx, cond: Doc, body: N): Item {
	const ui = uiDoc(c, body);
	if (fits(ui) && fits(cond)) return D(c.say.ui.onlyIf({ condition: cond.t, ui: ui.t }));
	return D(c.say.ui.onlyIf({ condition: cond.t, ui: null }), [...cond.kids, ...(ui.kids.length && ui.t === c.say.ui.group ? ui.kids : c.e.bullet(ui))]);
}

function conditional(c: Ctx, n: N): Item[] {
	if (isNullish(n.alternate)) return [onlyIf(c, c.e.cond(n.test), n.consequent)];
	if (isNullish(n.consequent)) return [onlyIf(c, c.e.cond(n.test, true), n.alternate)];
	const cond = c.e.cond(n.test);
	const yes = uiDoc(c, n.consequent);
	const no = uiDoc(c, n.alternate);
	const inline = c.say.ui.either({ condition: cond.t, yes: yes.t, no: no.t });
	if (fits(yes, 50) && fits(no, 50) && fits(cond, 60)) return [D(inline)];
	const branch = (d: Doc) => (d.t === c.say.ui.group ? d.kids : c.e.bullet(d));
	return [D(c.say.ui.ifShow({ condition: cond.t }), [...cond.kids, ...branch(yes)]), D(c.say.ui.otherwise, branch(no))];
}

/** `users.map((u) => <li>…</li>)` -> "for each u in users, an item …". */
export function eachDoc(c: Ctx, call: N): Doc {
	const { e, say } = c;
	const fn = unwrap(call.arguments[0]);
	const coll = e.noun(unwrap(call.callee).object);
	const item = fn.params.length ? e.g.list(e.patternNames(fn.params[0])) : e.say.expressions.item;
	if (fn.body.type !== "BlockStatement") {
		const ui = uiDoc(c, fn.body);
		if (fits(ui) && fits(coll)) return D(say.ui.each({ item, collection: coll.t, ui: ui.t }));
		return D(say.ui.each({ item, collection: coll.t, ui: null }), [...coll.kids, ...(ui.t === say.ui.group ? ui.kids : e.bullet(ui))]);
	}
	for (const r of returnsOf(fn)) c.facts.shows.add(r);
	return D(say.ui.each({ item, collection: coll.t, ui: null }), [...coll.kids, ...e.body(fn.body, 0)]);
}

/** A render function passed as children: `{(field) => <Switch … />}`. */
function renderFn(c: Ctx, fn: N): Doc {
	const { e, say } = c;
	const params = paramsOf(e, fn.params);
	const body = e.lambdaExpr(fn);
	if (body) {
		const ui = uiDoc(c, body);
		if (fits(ui)) return D(say.ui.renderProp({ params, ui: ui.t }));
		return D(say.ui.renderProp({ params, ui: null }), ui.t === say.ui.group ? ui.kids : e.bullet(ui));
	}
	for (const r of returnsOf(fn)) c.facts.shows.add(r);
	return D(say.ui.renderProp({ params, ui: null }), e.body(fn.body, 0));
}

/** The same as a value elsewhere: "an item showing … for each u in users". */
export function eachOfDoc(c: Ctx, call: N): Doc {
	const fn = unwrap(call.arguments[0]);
	const body = fn.body.type === "BlockStatement" ? c.e.lambdaExpr(fn) : fn.body;
	if (body) {
		const ui = uiDoc(c, body);
		const coll = c.e.noun(unwrap(call.callee).object);
		const item = fn.params.length ? c.e.g.list(c.e.patternNames(fn.params[0])) : c.e.say.expressions.item;
		if (fits(ui) && fits(coll)) return D(c.say.ui.eachOf({ item, collection: coll.t, ui: ui.t }));
	}
	return eachDoc(c, call);
}

/** JSX text as React renders it: lines trimmed, blank lines dropped, joined by spaces. */
function jsxText(raw: string): string {
	if (!raw.includes("\n")) return raw;
	const lines = raw.split("\n");
	return lines
		.map((l, i) => (i === 0 ? l.trimEnd() : i === lines.length - 1 ? l.trimStart() : l.trim()))
		.filter((l, i) => l || i === 0 || i === lines.length - 1)
		.filter(Boolean)
		.join(" ");
}

/** Children in order; text and the values inside it read as one quoted run: `"Clicked {count} times"`. */
function childItems(c: Ctx, children: N[]): Item[] {
	const out: Item[] = [];
	let run: (string | N)[] = [];
	const flush = () => {
		const parts = run;
		run = [];
		const hasText = parts.some((p) => typeof p === "string" && p.trim());
		if (!hasText) {
			for (const p of parts) if (typeof p !== "string") out.push(c.e.noun(p));
			return;
		}
		const segs: (string | N)[] = [];
		for (const p of parts) {
			if (typeof p === "string" && typeof segs.at(-1) === "string") segs[segs.length - 1] += p;
			else segs.push(p);
		}
		if (typeof segs[0] === "string") segs[0] = segs[0].trimStart();
		if (typeof segs.at(-1) === "string") segs[segs.length - 1] = (segs.at(-1) as string).trimEnd();
		const body = segs.map((p) => (typeof p === "string" ? p : `{${c.e.text(p)}}`));
		const quoted = segs.map((p, i) => {
			const text = typeof p === "string" ? p : null;
			const open = i === 0 ? '"' : "";
			const close = i === segs.length - 1 ? '"' : "";
			if (text !== null) return mk("l", `${open}${text}${close}`);
			return `${open ? mk("l", open) : ""}${body[i]}${close ? mk("l", close) : ""}`;
		});
		out.push(Object.assign(D(quoted.join("")), { text: true }));
	};
	for (const ch of children) {
		if (ch.type === "JSXText") {
			const t = jsxText(ch.value);
			if (t) run.push(t);
			continue;
		}
		if (ch.type === "JSXExpressionContainer") {
			const ex = unwrap(ch.expression);
			if (!ex || ex.type === "JSXEmptyExpression") continue;
			const s = str(ex);
			if (s !== null) {
				run.push(s);
				continue;
			}
			if (!hasJsx(ex)) {
				run.push(ex);
				continue;
			}
		}
		flush();
		out.push(...itemsOf(c, ch));
	}
	flush();
	return out;
}

/** An element as one item, or null when it is a wrapper that only passes its children through. */
function elementOf(c: Ctx, n: N): Item[] | null {
	const { e, say } = c;
	const tag = tagOf(c, n);
	const head = headOf(c, n, tag);
	const details = detailsOf(c, n, head.consumed);
	if (head.transparent && !details.items.length && !details.kids.length) return null;
	const kids = head.leaf ? [] : childItems(c, n.children);
	if (head.wrap) {
		const one = kids.length === 1 && fits(kids[0]!, 60) ? kids[0]! : null;
		return [D(head.wrap(one ? one.t : say.ui.group), one ? details.kids : [...details.kids, ...bullets(e, kids)])];
	}
	const element = say.ui.element({ element: head.element, details: details.items });
	const only = kids[0];
	if (kids.length === 1 && only?.text && !only.kids.length)
		return [D(say.ui.element({ element: say.ui.withText({ element: head.element, text: only.t }), details: details.items }), details.kids)];
	if (!kids.length) return [D(element, details.kids)];
	if (kids.length === 1 && fits(only!, 70) && !details.kids.length) return [D(say.ui.showing({ element, child: only!.t }))];
	return [D(say.ui.containing({ element }), [...details.kids, ...bullets(e, kids)])];
}

/** `wrap` elements read around their content: "Chart, showing Spinner while it loads". */
type Head = { element: string; consumed: string[]; transparent?: boolean; leaf?: boolean; wrap?: (ui: string) => string };

/** What an element is called: a host rule, React's own components, an HTML tag, or the component's name. */
function headOf(c: Ctx, n: N, tag: string): Head {
	const { e, say, facts } = c;
	const attr = (name: string) => attrOf(n, name);
	const rule = c.elements[tag]?.({ e, tag, node: n, attr, text: (x) => e.text(x) });
	if (rule) return rule;
	const base = tag.split(".").at(-1)!;
	const react = reactName({ e, facts }, { type: "Identifier", name: tag.split(".")[0] }) ?? (tag.startsWith("React.") ? "React" : null);
	if (base === "Suspense" && react) {
		const fb = attr("fallback");
		const fallback = fb && !isNullish(fb) ? uiDoc(c, fb).t : e.say.expressions.nothing;
		return { element: say.ui.group, consumed: ["fallback"], wrap: (ui) => say.ui.suspense({ fallback, ui }) };
	}
	if (TRANSPARENT.has(tag) || (TRANSPARENT.has(base) && react)) return { element: say.ui.container, consumed: [], transparent: true };
	const ctxName = tag.endsWith(".Provider") ? tag.slice(0, -9) : facts.contexts.has(tag) ? tag : null;
	if (ctxName && attr("value")) {
		const value = e.text(attr("value"));
		return { element: say.ui.group, consumed: ["value"], wrap: (ui) => say.ui.provide({ value, context: mk("f", ctxName, ctxName), ui }) };
	}
	if (/^[a-z][\w-]*$/.test(tag) || tag.startsWith("motion.")) return htmlHead(c, n, tag);
	return { element: mk("f", tag, tag), consumed: [] };
}

/** framer-motion's animation props; they describe motion, not content. */
const MOTION = /^(initial|animate|exit|transition|variants|while[A-Z]\w*|layout|layoutId|custom|drag\w*|viewport)$/;

function htmlHead(c: Ctx, n: N, tagName: string): Head {
	const { e, say } = c;
	const motion = tagName.startsWith("motion.");
	const tag = motion ? tagName.slice(7) : tagName;
	const head = htmlTag(c, n, tag);
	if (!motion) return head;
	const extra = attrsOf(n)
		.map((a: N) => a.name?.name)
		.filter((k: string) => k && MOTION.test(k));
	return { ...head, consumed: [...head.consumed, ...extra] };
}

function htmlTag(c: Ctx, n: N, tag: string): Head {
	const { e, say } = c;
	const attr = (name: string) => attrOf(n, name);
	if (tag === "a" && attr("href")) return { element: say.ui.linkTo({ href: hrefText(c, attr("href")) }), consumed: ["href", "target", "rel"] };
	if (tag === "img") return { element: say.ui.imageOf({ alt: attr("alt") ? e.text(attr("alt")) : null }), consumed: ["src", "alt"] };
	if (tag === "input") {
		const t = str(attr("type")) as InputType | null;
		return { element: (t && say.ui.input[t]) || say.ui.tags.input, consumed: ["type"] };
	}
	if (tag === "button" && str(attr("type")) === "submit") return { element: say.ui.input.submit, consumed: ["type"] };
	if (tag === "form" && attr("action") && !str(attr("action")) && !isFn(attr("action")))
		return { element: say.ui.formAction({ action: e.text(attr("action")) }), consumed: ["action"] };
	if (tag === "div" || tag === "span") return { element: say.ui.container, consumed: [], transparent: true };
	if (tag === "svg") return { element: say.ui.tags.svg, consumed: attrsOf(n).map((a: N) => a.name?.name), leaf: true };
	if (tag === "html" || tag === "body") return { element: say.ui.container, consumed: attrsOf(n).map((a: N) => a.name?.name), transparent: true };
	return { element: say.ui.tags[tag as Tag] ?? mk("c", `<${tag}>`), consumed: [] };
}

/** A link target in full, as code when it's a plain path. */
export function hrefText(c: Ctx, n: N): string {
	const s = str(n);
	return s === null ? c.e.text(n) : mk("c", s);
}

/** Props worth reading: handlers, flags and values; styling is dropped. */
function detailsOf(c: Ctx, n: N, consumed: string[]): { items: string[]; kids: Line[] } {
	const { e, say } = c;
	const items: string[] = [];
	const kids: Line[] = [];
	for (const a of attrsOf(n)) {
		if (a.type === "JSXSpreadAttribute") {
			items.push(say.ui.everythingIn({ value: e.text(a.argument) }));
			continue;
		}
		const key = typeof a.name.name === "string" ? a.name.name : e.code(a.name);
		if (SKIP.test(key) || consumed.includes(key)) continue;
		const name = e.prop(key);
		if (!a.value) {
			items.push(name);
			continue;
		}
		const v = a.value.type === "JSXExpressionContainer" ? unwrap(a.value.expression) : a.value;
		if (/^on[A-Z]/.test(key) || ((key === "action" || key === "formAction") && isFn(v))) {
			const h = handlerOf(c, key, v);
			if (h.kids.length) kids.push(...e.bullet(h));
			else items.push(h.t);
			continue;
		}
		const d = valueOf(c, key, v);
		if (d.kids.length) kids.push(...e.bullet(d));
		else items.push(d.t);
	}
	return { items, kids };
}

function valueOf(c: Ctx, key: string, v: N): Doc {
	const { e, say } = c;
	const name = e.prop(key);
	if (v.type === "Literal" && typeof v.value === "boolean") return D(v.value ? name : say.ui.labeled({ name, value: e.text(v) }));
	if (v.type === "Identifier" && same(e, e.ref(v.name), key)) return D(name);
	if (FLAGS.test(key) && !hasJsx(v)) {
		const cond = e.cond(v);
		return D(say.ui.flagWhen({ flag: name, condition: cond.t }), cond.kids);
	}
	const fn = isFn(v) ? unwrap(v) : null;
	const body = fn ? e.lambdaExpr(fn) : v;
	if (body && hasJsx(body)) {
		const ui = uiDoc(c, body);
		return ui.t === say.ui.group ? D(name, ui.kids) : D(say.ui.labeled({ name, value: ui.t }), ui.kids);
	}
	if (fn && hasJsx(fn)) {
		for (const r of returnsOf(fn)) c.facts.shows.add(r);
		return D(name, e.body(fn.body, 0));
	}
	if (fn && body) {
		const d = e.looksBoolean(body) ? e.cond(body) : e.noun(body);
		return D(say.ui.labeled({ name, value: d.t }), d.kids);
	}
	const d = e.noun(v);
	if (same(e, d.t, key)) return d;
	return D(say.ui.labeled({ name, value: d.t }), d.kids);
}

/** `onClick={() => setOpen(true)}` -> "when clicked, set open to true". */
function handlerOf(c: Ctx, key: string, v: N): Doc {
	const { e, say } = c;
	const event = key === "action" || key === "formAction" ? "onSubmit" : key;
	const when = say.ui.events[event as DomEvent] ?? say.ui.customEvent({ name: e.lex.humanize(key.slice(2)) });
	if (isFn(v)) {
		const a = actionOf(e, v);
		return a.kids.length ? D(say.ui.handler({ when, action: null }), a.kids) : D(say.ui.handler({ when, action: a.t }));
	}
	const d = e.noun(v);
	return D(say.ui.handler({ when, action: d.t }), d.kids);
}

export { attrOf };
