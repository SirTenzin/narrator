import type { FileKind } from "./phrases";

/** What a file's path says about it: which router, which special file, and the URL it serves. */
export type FileInfo = { router: "app" | "pages"; kind: FileKind | "route" | "api" | "middleware" | "proxy" | null; route: string };

const APP_FILES: Record<string, FileKind | "route"> = {
	page: "page",
	layout: "layout",
	template: "template",
	loading: "loading",
	error: "error",
	"global-error": "globalError",
	"not-found": "notFound",
	"global-not-found": "notFound",
	default: "default",
	forbidden: "forbidden",
	unauthorized: "unauthorized",
	route: "route",
	"opengraph-image": "socialImage",
	"twitter-image": "socialImage",
	icon: "icon",
	"apple-icon": "icon",
	sitemap: "sitemap",
	robots: "robots",
	manifest: "manifest",
};

const EXT = /\.(tsx|ts|jsx|js|mjs|mdx)$/;

/** `[id]` -> `:id`, `[...slug]` -> `:slug+`, `[[...slug]]` -> `:slug*`, the `:param` notation Next.js matchers use. */
function segment(s: string): string | null {
	if (/^\(.*\)$/.test(s) || s.startsWith("@")) return null;
	const seg = s.replace(/^(\(\.{1,3}\))+/, "");
	const optional = /^\[\[\.\.\.(.+)\]\]$/.exec(seg);
	if (optional) return `:${optional[1]}*`;
	const catchAll = /^\[\.\.\.(.+)\]$/.exec(seg);
	if (catchAll) return `:${catchAll[1]}+`;
	const dyn = /^\[(.+)\]$/.exec(seg);
	return dyn ? `:${dyn[1]}` : seg;
}

const routeOf = (dirs: string[]) =>
	`/${dirs
		.map(segment)
		.filter((x) => x !== null)
		.join("/")}`;

/** Reads a file path under `app/` or `pages/` (optionally inside `src/`); null for anything else. */
export function fileInfo(path: string | null): FileInfo | null {
	if (!path || !EXT.test(path)) return null;
	const parts = path.replace(/\\/g, "/").split("/");
	const file = parts.at(-1)!.replace(EXT, "");
	const root = parts.length === 1 || (parts.length === 2 && parts[0] === "src");
	if (root && (file === "middleware" || file === "proxy")) return { router: "app", kind: file, route: "/" };
	const app = parts.lastIndexOf("app");
	const pages = parts.lastIndexOf("pages");
	if (app >= 0 && app > pages) {
		const kind = APP_FILES[file] ?? null;
		const dirs = parts.slice(app + 1, -1);
		if (kind === "layout" && !dirs.some((d) => segment(d) !== null)) return { router: "app", kind: "rootLayout", route: "/" };
		return { router: "app", kind, route: routeOf(dirs) };
	}
	if (pages >= 0) {
		const rest = parts.slice(pages + 1);
		rest[rest.length - 1] = file;
		if (rest.length === 1 && file === "_app") return { router: "pages", kind: "app", route: "/" };
		if (rest.length === 1 && file === "_document") return { router: "pages", kind: "document", route: "/" };
		if (rest.length === 1 && file === "404") return { router: "pages", kind: "notFound", route: "/" };
		if (rest[rest.length - 1] === "index") rest.pop();
		return { router: "pages", kind: rest[0] === "api" ? "api" : "page", route: routeOf(rest) };
	}
	return null;
}
