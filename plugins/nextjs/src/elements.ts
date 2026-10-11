import { mk } from "@usenarrator/core";
import type { Engine, N } from "@usenarrator/lang-ts";
import type { ElementRule } from "@usenarrator/plugin-react";
import type { NextPhrases, ScriptStrategy } from "./phrases";
import { str } from "./shared";

/** Whether a JSX tag is the default export of a `next/*` module (`Link` from `next/link`). */
const from = (e: Engine, tag: string, module: string) => {
	const i = e.imports.get(tag);
	return i?.from === module && i.name === "default";
};

const hrefOf = (e: Engine, n: N, text: (n: N) => string) => {
	const s = str(n);
	return s === null ? text(n) : mk("c", s);
};

/** `next/link`, `next/image`, `next/script`, `next/form` and `next/head` as the React plugin's element readings. */
export function nextElements(sayOf: (e: Engine) => NextPhrases): Record<string, ElementRule> {
	return {
		Link: ({ e, tag, attr, text }) => {
			const href = attr("href");
			if (!from(e, tag, "next/link") || !href) return null;
			return { element: sayOf(e).elements.link({ href: hrefOf(e, href, text) }), consumed: ["href", "prefetch", "scroll", "replace"] };
		},
		Image: ({ e, tag, attr, text }) => {
			if (!from(e, tag, "next/image")) return null;
			const alt = attr("alt");
			return {
				element: sayOf(e).elements.image({ alt: alt && str(alt) !== "" ? text(alt) : null }),
				consumed: ["src", "alt", "priority", "fill", "quality", "placeholder", "blurDataURL", "unoptimized"],
			};
		},
		Script: ({ e, tag, attr, text }) => {
			if (!from(e, tag, "next/script")) return null;
			const say = sayOf(e);
			const src = attr("src");
			const strategy = str(attr("strategy")) as ScriptStrategy | null;
			return {
				element: say.elements.script({ src: src ? hrefOf(e, src, text) : null, strategy: strategy ? (say.elements.strategies[strategy] ?? null) : null }),
				consumed: ["src", "strategy"],
			};
		},
		Form: ({ e, tag, attr, text }) => {
			const action = attr("action");
			if (!from(e, tag, "next/form") || !action) return null;
			return { element: sayOf(e).elements.form({ action: hrefOf(e, action, text) }), consumed: ["action"] };
		},
		Head: ({ e, tag }) => (from(e, tag, "next/head") ? { element: sayOf(e).elements.head, consumed: [] } : null),
	};
}
