// Keeps every narration sample in the docs honest: each marked example is re-run against the real SDK.
//   bun docs/scripts/examples.ts          check every marked example (exit 1 on drift)
//   bun docs/scripts/examples.ts --write  rewrite the expected outputs from the current SDK
// Markers: {/* narrate plugins="a,b" path="x.ts" */}, {/* run file="examples/x.ts" */}, {/* cli file="x.ts" */}
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { TsPlugin } from "@usenarrator/lang-ts";
import { aiSdk } from "@usenarrator/plugin-ai-sdk";
import { arktype } from "@usenarrator/plugin-arktype";
import { autumnJs } from "@usenarrator/plugin-autumn-js";
import { betterAuth } from "@usenarrator/plugin-better-auth";
import { bullmq } from "@usenarrator/plugin-bullmq";
import { decimal } from "@usenarrator/plugin-decimal";
import { drizzle } from "@usenarrator/plugin-drizzle";
import { effect } from "@usenarrator/plugin-effect";
import { elysia } from "@usenarrator/plugin-elysia";
import { express } from "@usenarrator/plugin-express";
import { fastify } from "@usenarrator/plugin-fastify";
import { hono } from "@usenarrator/plugin-hono";
import { inngest } from "@usenarrator/plugin-inngest";
import { kysely } from "@usenarrator/plugin-kysely";
import { nextjs } from "@usenarrator/plugin-nextjs";
import { prisma } from "@usenarrator/plugin-prisma";
import { react } from "@usenarrator/plugin-react";
import { sql } from "@usenarrator/plugin-sql";
import { stripe } from "@usenarrator/plugin-stripe";
import { tanstackQuery } from "@usenarrator/plugin-tanstack-query";
import { temporal } from "@usenarrator/plugin-temporal";
import { testing } from "@usenarrator/plugin-testing";
import { triggerDev } from "@usenarrator/plugin-trigger-dev";
import { trpc } from "@usenarrator/plugin-trpc";
import { valibot } from "@usenarrator/plugin-valibot";
import { zod } from "@usenarrator/plugin-zod";
import { narrateWithStats } from "@usenarrator/testkit";
import { Glob } from "bun";
// tsconfig paths only map package roots, so the subpath export is imported by file.
import { pgsqlParser } from "../../plugins/sql/src/pgsql";

const DOCS = `${import.meta.dir}/..`;
const ROOT = `${DOCS}/..`;
const write = process.argv.includes("--write");

const PLUGINS: Record<string, () => TsPlugin | TsPlugin[]> = {
	zod,
	testing,
	decimal,
	drizzle,
	"better-auth": betterAuth,
	effect: () => effect(),
	"effect@3": () => effect({ version: 3 }),
	"effect@4": () => effect({ version: 4 }),
	hono,
	"ai-sdk": () => aiSdk(),
	"ai-sdk@6": () => aiSdk({ version: 6 }),
	"ai-sdk@7": () => aiSdk({ version: 7 }),
	sql: () => sql({ parser: pgsqlParser }),
	"sql-noparser": () => sql(),
	elysia: () => elysia(),
	"elysia@1": () => elysia({ version: 1 }),
	"elysia@2": () => elysia({ version: 2 }),
	react: () => react(),
	nextjs: () => nextjs(),
	"tanstack-query": () => tanstackQuery(),
	"tanstack-query@4": () => tanstackQuery({ version: 4 }),
	"tanstack-query@5": () => tanstackQuery({ version: 5 }),
	trpc,
	express,
	fastify: () => fastify(),
	"fastify@4": () => fastify({ version: 4 }),
	"fastify@5": () => fastify({ version: 5 }),
	bullmq,
	inngest,
	"trigger-dev": triggerDev,
	temporal,
	stripe,
	"autumn-js": () => autumnJs(),
	prisma,
	kysely,
	valibot,
	arktype,
};

type Fence = { open: number; close: number; body: string };
type Marker = { kind: "narrate" | "run" | "cli"; attrs: Record<string, string>; line: number };

const MARKER = /^\s*\{\/\*\s*(narrate|run|cli)\b(.*?)\*\/\}\s*$/;
const attrsOf = (s: string) => Object.fromEntries([...s.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));

function fenceAfter(lines: string[], from: number): Fence | null {
	for (let i = from; i < lines.length; i++) {
		const m = /^(\s*)(`{3,})/.exec(lines[i]!);
		if (!m) continue;
		const indent = m[1]!;
		for (let j = i + 1; j < lines.length; j++)
			if (lines[j]!.trim() === m[2])
				return {
					open: i,
					close: j,
					body: lines
						.slice(i + 1, j)
						.map((l) => l.slice(indent.length))
						.join("\n"),
				};
		return null;
	}
	return null;
}

const plugins = (list = "") =>
	list
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.map((name) => {
			const make = PLUGINS[name];
			if (!make) throw new Error(`unknown plugin "${name}" in example marker`);
			return make();
		});

async function expectedFor(m: Marker, code: string): Promise<{ code: string; output: string }> {
	if (m.kind === "narrate") {
		const { text, fallbacks } = narrateWithStats(code, { plugins: plugins(m.attrs.plugins), path: m.attrs.path });
		if (fallbacks && m.attrs.fallbacks !== "ok") console.warn(`  ! ${fallbacks} fallback(s) to raw code`);
		return { code, output: text };
	}
	if (m.kind === "cli") {
		const dir = mkdtempSync(`${tmpdir()}/narrator-docs-`);
		const file = `${dir}/${m.attrs.file}`;
		await Bun.write(file, `${code}\n`);
		const proc = Bun.spawnSync(["bun", `${ROOT}/apps/cli/narrate.ts`, file, "--plain"], { cwd: ROOT, stderr: "pipe" });
		rmSync(dir, { recursive: true, force: true });
		if (proc.exitCode !== 0) throw new Error(`CLI failed on ${m.attrs.file}:\n${proc.stderr.toString()}`);
		return { code, output: proc.stdout.toString().trimEnd() };
	}
	const file = `${DOCS}/${m.attrs.file}`;
	const source = (await Bun.file(file).text()).trimEnd();
	const proc = Bun.spawnSync(["bun", file], { cwd: ROOT, stderr: "pipe" });
	if (proc.exitCode !== 0) throw new Error(`${m.attrs.file} failed:\n${proc.stderr.toString()}`);
	return { code: source, output: proc.stdout.toString().trimEnd() };
}

const replaceFence = (lines: string[], f: Fence, body: string) => {
	const indent = /^(\s*)/.exec(lines[f.open]!)![1]!;
	lines.splice(f.open + 1, f.close - f.open - 1, ...body.split("\n").map((l) => (l ? indent + l : l)));
};

let drift = 0;
let checked = 0;
for await (const rel of new Glob("**/*.mdx").scan(DOCS)) {
	if (rel.startsWith("node_modules")) continue;
	const path = `${DOCS}/${rel}`;
	const lines = (await Bun.file(path).text()).split("\n");
	let changed = false;
	for (let i = 0; i < lines.length; i++) {
		const hit = MARKER.exec(lines[i]!);
		if (!hit) continue;
		const marker: Marker = { kind: hit[1] as Marker["kind"], attrs: attrsOf(hit[2]!), line: i + 1 };
		const codeFence = fenceAfter(lines, i + 1);
		const outFence = codeFence && fenceAfter(lines, codeFence.close + 1);
		if (!codeFence || !outFence) throw new Error(`${rel}:${marker.line}: marker needs a code block and an output block after it`);
		const want = await expectedFor(marker, codeFence.body);
		checked++;
		const ok = want.code === codeFence.body && want.output === outFence.body;
		if (ok) continue;
		if (!write) {
			drift++;
			console.error(`✗ ${rel}:${marker.line}\n--- docs say\n${outFence.body}\n--- SDK says\n${want.output}\n`);
			continue;
		}
		replaceFence(lines, outFence, want.output);
		replaceFence(lines, codeFence, want.code);
		changed = true;
		i = codeFence.open;
	}
	if (changed) {
		await Bun.write(path, lines.join("\n"));
		console.log(`updated ${rel}`);
	}
}
console.log(`${checked} example(s) ${write ? "synced" : "checked"}${drift ? `, ${drift} out of date (run with --write)` : ""}`);
if (drift) process.exit(1);
