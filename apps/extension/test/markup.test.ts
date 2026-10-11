import { expect, test } from "bun:test";
import { toHtml } from "@usenarrator/core";
import { githubify, type MNode, parseMarkup, splitDetails, textOf } from "../src/markup";

const show = (nodes: MNode[]): string =>
	nodes
		.map((n) => {
			if (typeof n === "string") return JSON.stringify(n);
			const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}=${JSON.stringify(v)}`);
			return `<${n.tag}${attrs.join("")}>${show(n.children)}</${n.tag}>`;
		})
		.join("");

test("core's inline html parses into spans with decoded text", () => {
	const html = toHtml('call \uE000f\uE001save\uE001save\uE002 with \uE000l\uE001\uE001"a & b"\uE002', () => null);
	expect(show(githubify(parseMarkup(html)))).toBe('"call "<span class="pl-en">"save"</span>" with "<span class="pl-s">"\\"a & b\\""</span>');
});

test("literal spans that aren't strings and type refs get GitHub's classes", () => {
	expect(show(githubify(parseMarkup('<span class="l">42</span><span class="t">User</span><span class="c">x</span>')))).toBe(
		'<span class="pl-c1">"42"</span><span class="pl-smi pe-type">"User"</span><span class="pl-c1">"x"</span>',
	);
});

test("changed-token marks become GitHub's word-diff spans", () => {
	expect(show(githubify(parseMarkup('a <mark class="chg">b</mark>')))).toBe('"a "<span class="x x-first x-last">"b"</span>');
});

test("script, handlers and unsafe links never survive", () => {
	const nodes = parseMarkup(
		'<img src=x onerror="alert(1)"><script>alert(2)</script><span class="v" onclick="x()">ok</span><a href="javascript:alert(3)">l</a>',
	);
	expect(show(nodes)).toBe('"alert(2)"<span class="v">"ok"</span><a>"l"</a>');
});

test("safe links keep their href", () => {
	expect(show(parseMarkup('<a href="https://example.com/x" title="t">x</a>'))).toBe('<a href="https://example.com/x" title="t">"x"</a>');
});

test("heading details split at the marker, cloning a mark that straddles it", () => {
	const nodes = parseMarkup('save <mark class="chg">user<wbr data-details="">(takes id)</mark> rest');
	const { before, after } = splitDetails(nodes);
	expect(show(before)).toBe('"save "<mark class="chg">"user"</mark>');
	expect(show(after!)).toBe('<mark class="chg">"(takes id)"</mark>" rest"');
});

test("no details marker leaves the heading whole", () => {
	const { before, after } = splitDetails(parseMarkup("plain"));
	expect(textOf(before)).toBe("plain");
	expect(after).toBeNull();
});

test("numeric and named entities decode, unknown ones stay literal", () => {
	expect(textOf(parseMarkup("&lt;a&gt; &#39;b&#x27; &bogus;"))).toBe("<a> 'b' &bogus;");
});
