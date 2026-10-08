import { type ChangedFile, createNarrator, type Line, toHtml } from "@narrate/core";
import { autumn } from "@narrate/example-autumn";
import { type Engine, TypeExplainer, typeRefName, typescript, unwrap } from "@narrate/lang-ts";
import { oxcParser as parseSync } from "@narrate/lang-ts/oxc";
import { en } from "@narrate/locale-en";
import { testing } from "@narrate/plugin-testing";
import { zod } from "@narrate/plugin-zod";
import { Glob } from "bun";

/** Teaches the engine a called function's declared return type by following it across files. */
const crossFileTypes = ({ engine, path }: { engine: Engine; path: string }) => {
	engine.typeOfCall = null;
	if (!fileExists(path)) return;
	engine.typeOfCall = (fn) => {
		try {
			const def = symbolIndex.has(fn) ? findDefinition(fn, path) : null;
			return def ? (fileInfo(def.file).returnTypes.get(fn) ?? null) : null;
		} catch {
			return null;
		}
	};
};
const ts = typescript({ parser: parseSync, plugins: [zod(), testing(), autumn()], setup: crossFileTypes });
const narrator = createNarrator({ languages: [ts], locale: en });

const ROOT = process.env.ROOT ?? "/workspace/autumn";
const PORT = Number(process.env.PORT ?? 4477);

const files: string[] = [];
for await (const f of new Glob("**/*.{ts,tsx,js,jsx,mjs}").scan({ cwd: ROOT, onlyFiles: true }))
	if (!/node_modules|\/dist\/|\.d\.ts$|\/\.|^\./.test(f)) files.push(f);
files.sort();

/** name -> files that declare it at top level (cheap regex pass). */
const symbolIndex = new Map<string, string[]>();
const DECL = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
await Promise.all(
	files.map(async (f) => {
		const text = await Bun.file(`${ROOT}/${f}`).text();
		for (const m of text.matchAll(DECL)) {
			const list = symbolIndex.get(m[1]!) ?? [];
			list.push(f);
			symbolIndex.set(m[1]!, list);
		}
	}),
);

type Info = {
	src: string;
	lineStarts: number[];
	decls: Map<string, { start: number; end: number }>;
	imports: Map<string, string>;
	returnTypes: Map<string, string>;
};
type Narrated = Info & { lines: Line[] };
const infoCache = new Map<string, Info>();
const cache = new Map<string, Narrated>();

/** Parse-only facts about a file: declarations, imports, declared return types. */
function fileInfo(file: string): Info {
	const hit = infoCache.get(file);
	if (hit) return hit;
	const src = require("node:fs").readFileSync(`${ROOT}/${file}`, "utf8") as string;
	const lineStarts = [0];
	for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
	const { program } = parseSync(file.replace(/\.(m|c)?js$/, ".ts"), src) as any;
	const decls = new Map<string, { start: number; end: number }>();
	const imports = new Map<string, string>();
	const returnTypes = new Map<string, string>();
	const code = (n: any) => src.slice(n.start, n.end);
	for (const st of program.body) {
		const s = st.type.startsWith("Export") && st.declaration ? st.declaration : st;
		if (s.type === "ImportDeclaration") {
			for (const sp of s.specifiers) imports.set(sp.local.name, s.source.value);
			continue;
		}
		if (s.id?.name) decls.set(s.id.name, { start: st.start, end: st.end });
		if (s.type === "FunctionDeclaration" && s.id?.name) {
			const t = typeRefName(s.returnType?.typeAnnotation, code);
			if (t) returnTypes.set(s.id.name, t);
		}
		if (s.type === "VariableDeclaration")
			for (const v of s.declarations) {
				if (!v.id?.name) continue;
				decls.set(v.id.name, { start: st.start, end: st.end });
				const fn = v.init && unwrap(v.init);
				const t = fn?.returnType ? typeRefName(fn.returnType.typeAnnotation, code) : null;
				if (t) returnTypes.set(v.id.name, t);
			}
		if (s.type === "ClassDeclaration") for (const m of s.body.body) if (m.key?.name) decls.set(`${s.id.name}.${m.key.name}`, { start: m.start, end: m.end });
	}
	const info = { src, lineStarts, decls, imports, returnTypes };
	infoCache.set(file, info);
	return info;
}

function narrateFile(file: string): Narrated {
	const hit = cache.get(file);
	if (hit) return hit;
	const info = fileInfo(file);
	const { lines } = narrator.narrate(info.src, file);
	const n = { ...info, lines };
	cache.set(file, n);
	return n;
}

const lineOf = (n: Info, off: number) => {
	let lo = 0;
	let hi = n.lineStarts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (n.lineStarts[mid]! <= off) lo = mid;
		else hi = mid - 1;
	}
	return lo + 1;
};

function resolveImport(from: string, spec: string): string | null {
	const tryPaths = (base: string) => {
		for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
			const p = (base + ext).replace(/\.js$/, ".ts");
			if (files.includes(p)) return p;
			const p2 = base.replace(/\.js$/, "") + ext;
			if (files.includes(p2)) return p2;
		}
		return null;
	};
	if (spec.startsWith(".")) {
		const dir = from.split("/").slice(0, -1);
		for (const part of spec.split("/")) {
			if (part === "..") dir.pop();
			else if (part !== ".") dir.push(part);
		}
		return tryPaths(dir.join("/"));
	}
	if (spec.startsWith("@/")) {
		const pkg = from.split("/")[0];
		return tryPaths(`${pkg}/src/${spec.slice(2)}`) ?? tryPaths(`server/src/${spec.slice(2)}`);
	}
	return null;
}

function findDefinition(name: string, from: string): { file: string; start: number; end: number } | null {
	const local = fileInfo(from);
	const own = local.decls.get(name);
	if (own) return { file: from, ...own };
	const spec = local.imports.get(name);
	if (spec) {
		const target = resolveImport(from, spec);
		if (target) {
			const d = fileInfo(target).decls.get(name);
			if (d) return { file: target, ...d };
			const reexport = findReexport(name, target);
			if (reexport) return reexport;
		}
	}
	const cands = symbolIndex.get(name) ?? [];
	const ranked = [...cands].sort((a, b) => sharedPrefix(b, from) - sharedPrefix(a, from));
	for (const f of ranked) {
		const d = fileInfo(f).decls.get(name);
		if (d) return { file: f, ...d };
	}
	return null;
}

/** Follows `import { X } from "./barrel"` one hop into the barrel's own imports. */
function findReexport(name: string, barrel: string): { file: string; start: number; end: number } | null {
	const spec = fileInfo(barrel).imports.get(name);
	const target = spec ? resolveImport(barrel, spec) : null;
	const d = target ? fileInfo(target).decls.get(name) : null;
	return target && d ? { file: target, ...d } : null;
}

const sharedPrefix = (a: string, b: string) => {
	let i = 0;
	while (i < a.length && a[i] === b[i]) i++;
	return i;
};

function linesJson(
	file: string,
	n: { lines: Line[]; decls: Map<string, unknown>; imports: Map<string, string>; lineStarts: number[] },
	range?: { start: number; end: number },
) {
	const known = (x: string) => n.decls.has(x) || n.imports.has(x) || symbolIndex.has(x);
	const resolve = (payload: string, kind: string) => {
		const [name, type] = payload.split("|");
		if (kind === "t") return known(name!) ? `#type:${name}` : null;
		if (kind === "v" && type) {
			const field = type.startsWith("@") ? type.slice(1).split(".") : null;
			const tname = field ? field[0]! : type;
			if (!known(tname)) return null;
			return field ? `#type:${tname}#${field[1]}` : `#type:${tname}`;
		}
		if (n.decls.has(name!) || n.imports.has(name!)) return `#def:${name}`;
		return kind === "f" && symbolIndex.has(name!) ? `#def:${name}` : null;
	};
	return n.lines
		.filter((l) => !range || (l.start >= range.start && l.end <= range.end && l.start >= 0) || (range && l.start < 0 && false))
		.map((l) => ({
			d: l.d,
			kind: l.kind,
			html: toHtml(l.text, resolve),
			from: l.start >= 0 ? lineOf(n as unknown as Info, l.start) : null,
			to: l.end >= 0 ? lineOf(n as unknown as Info, Math.max(l.start, l.end - 1)) : null,
		}));
}

/** Lines inside a range, keeping kid lines (start -1) that follow an included line. */
function sliceLines(n: Narrated, range: { start: number; end: number }) {
	const out: Line[] = [];
	let inside = false;
	let baseDepth = 0;
	for (const l of n.lines) {
		if (l.start >= 0) inside = l.start >= range.start && l.end <= range.end;
		if (!inside || l.kind === "blank") continue;
		if (!out.length) baseDepth = l.d;
		out.push({ ...l, d: l.d - baseDepth });
	}
	return out;
}

const git = (...args: string[]) => {
	const r = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
	if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString().trim()}`);
	return r.stdout.toString();
};
const gitMaybe = (...args: string[]) => {
	try {
		return git(...args);
	} catch {
		return null;
	}
};

function listCommits(limit = 60) {
	const out = git("log", `-n${limit}`, "--first-parent", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%cr", "HEAD");
	return out
		.trim()
		.split("\n")
		.map((l) => {
			const [sha, short, subject, author, when] = l.split("\x1f");
			return { sha, short, subject, author, when };
		});
}

const diffCache = new Map<string, unknown>();

function diffRange(base: string, head: string) {
	const key = `${base}..${head}`;
	if (diffCache.has(key)) return diffCache.get(key);
	const status = git("diff", "--name-status", "-M", base, head, "--", "*.ts", "*.tsx", "*.js", "*.jsx");
	const changed: ChangedFile[] = status
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((l) => {
			const parts = l.split("\t");
			const code = parts[0]![0]!;
			const path = parts[parts.length - 1]!;
			const oldPath = code === "A" ? null : parts[1]!;
			return {
				path,
				oldPath,
				status: code === "A" ? "added" : code === "D" ? "deleted" : code === "R" ? "renamed" : "modified",
				oldSrc: oldPath ? (gitMaybe("show", `${base}:${oldPath}`) ?? "") : "",
				newSrc: code === "D" ? "" : (gitMaybe("show", `${head}:${path}`) ?? ""),
			} as ChangedFile;
		})
		.filter((f) => narrator.canNarrate(f.path));
	const resolve = (payload: string, kind: string) => {
		const [name, type] = payload.split("|");
		if (kind === "t") return symbolIndex.has(name!) ? `#type:${name}` : null;
		if (kind === "v" && type) {
			const field = type.startsWith("@") ? type.slice(1).split(".") : null;
			const tname = field ? field[0]! : type;
			if (!symbolIndex.has(tname)) return null;
			return field ? `#type:${tname}#${field[1]}` : `#type:${tname}`;
		}
		return kind === "f" && symbolIndex.has(name!) ? `#def:${name}` : null;
	};
	const meta = gitMaybe("log", "-1", "--format=%h%x1f%s%x1f%an%x1f%cr", head)?.trim().split("\x1f") ?? [];
	const out = {
		base,
		head,
		subject: meta[1] ?? "",
		author: meta[2] ?? "",
		when: meta[3] ?? "",
		short: meta[0] ?? head,
		files: narrator.diff(changed, { resolve }),
	};
	diffCache.set(key, out);
	return out;
}

const fileExists = (p: string) => files.includes(p);

Bun.serve({
	port: PORT,
	hostname: "0.0.0.0",
	async fetch(req) {
		const url = new URL(req.url);
		try {
			const asset = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
			if (/^(index\.html|style\.css|app\.js)$/.test(asset))
				return new Response(Bun.file(`${import.meta.dir}/public/${asset}`), { headers: { "cache-control": "no-store" } });
			if (url.pathname === "/api/files") return Response.json(files);
			if (url.pathname === "/api/narrate") {
				const file = url.searchParams.get("file")!;
				const n = narrateFile(file);
				return Response.json({ file, src: n.src, lines: linesJson(file, n) });
			}
			if (url.pathname === "/api/def") {
				const name = url.searchParams.get("name")!;
				const from = url.searchParams.get("from")!;
				const def = findDefinition(name, from);
				if (!def) return Response.json({ found: false });
				const n = narrateFile(def.file);
				const sliced = { ...n, lines: sliceLines(n, def) };
				return Response.json({ found: true, file: def.file, line: lineOf(n, def.start), lines: linesJson(def.file, sliced) });
			}
			if (url.pathname === "/api/commits") return Response.json(listCommits());
			if (url.pathname === "/api/diff") {
				let base = url.searchParams.get("base");
				let head = url.searchParams.get("head");
				const commit = url.searchParams.get("commit");
				if (commit) {
					head = commit;
					base = `${commit}^1`;
				}
				if (!base || !head) return Response.json({ error: "need ?commit= or ?base=&head=" }, { status: 400 });
				return Response.json(diffRange(base, head));
			}
			if (url.pathname === "/api/type") {
				const name = url.searchParams.get("name")!;
				const from = url.searchParams.get("from")!;
				const def = findDefinition(name, from);
				if (!def) return Response.json({ found: false });
				const info = fileInfo(def.file);
				const ex = new TypeExplainer(ts.engine(en), info.src, def.file);
				const lines = ex.explain(name);
				if (!lines) return Response.json({ found: false });
				return Response.json({ found: true, file: def.file, line: lineOf(info, def.start), lines: linesJson(def.file, { ...info, lines }) });
			}
			return new Response("not found", { status: 404 });
		} catch (err: any) {
			return Response.json({ error: String(err?.stack ?? err) }, { status: 500 });
		}
	},
});
void unwrap;
console.log(`viewer on :${PORT}, ${files.length} files, ${symbolIndex.size} symbols`);
