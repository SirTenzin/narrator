// Inline markup: \uE000kind\uE001payload\uE001text\uE002. Kinds: v=value name, f=function ref, t=type ref, l=literal, c=raw code.
const S = "\uE000";
const SEP = "\uE001";
const E = "\uE002";
const RE = /\uE000(\w)\uE001([^\uE001]*)\uE001([^\uE002]*)\uE002/g;

export const mk = (kind: "v" | "f" | "t" | "l" | "c", text: string, payload = "") =>
	`${S}${kind}${SEP}${payload}${SEP}${text}${E}`;

export const plain = (s: string) => s.replace(RE, (_, k, _p, t) => (k === "t" ? `(${t})` : t));
export const vlen = (s: string) => s.replace(RE, (_, _k, _p, t) => t).length;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function toHtml(s: string, resolve: (name: string, kind: string) => string | null): string {
	let out = "";
	let last = 0;
	for (const m of s.matchAll(RE)) {
		out += esc(s.slice(last, m.index));
		const [, kind, payload, text] = m;
		const href = kind === "f" || kind === "v" ? resolve(payload!, kind!) : null;
		const name = payload!.split("|")[0]!;
		const inner = `<span class="${kind}"${kind === "v" ? ` data-n="${esc(name)}"` : ""}>${esc(text!)}</span>`;
		out += href ? `<a href="${href}" title="${esc(payload!)}">${inner}</a>` : inner;
		last = m.index! + m[0].length;
	}
	return out + esc(s.slice(last));
}

const ANSI: Record<string, string> = { v: "\x1b[36m", f: "\x1b[1;33m", t: "\x1b[2m", l: "\x1b[32m", c: "\x1b[2;35m" };
export const toAnsi = (s: string) => s.replace(RE, (_, k, _p, t) => `${ANSI[k]}${k === "t" ? `(${t})` : t}\x1b[0m`);
