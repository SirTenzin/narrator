/** Plugin selection and version detection from a change's dependencies; pure so it tests without a browser. */
import type { Dependencies } from "@usenarrator/core";

type Deps = Dependencies;

const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** `a/b/c.ts` -> ["a/b", "a", ""]: the directories whose manifests can apply to a file. */
export function ancestorDirs(path: string): string[] {
	const out: string[] = [];
	for (let dir = dirOf(path); dir; dir = dirOf(dir)) out.push(dir);
	out.push("");
	return out;
}

/** The major a range declares: "^4.0.0-beta.3" -> 4, "npm:effect@~3.1" -> 3; null for `workspace:*`, `latest`, URLs. */
export function majorOf(range: string | undefined): number | null {
	if (!range || /^(workspace|link|file|git|github|https?):/.test(range)) return null;
	const m = /^(?:npm:(?:@[^/]+\/)?[^@]+@)?[\s^~>=v]*(\d+)/.exec(range);
	return m ? Number(m[1]) : null;
}

export type PluginId =
	| "zod"
	| "testing"
	| "drizzle"
	| "betterAuth"
	| "effect"
	| "effectTesting"
	| "hono"
	| "elysia"
	| "aiSdk"
	| "decimal"
	| "autumn"
	| "react"
	| "nextjs"
	| "tanstackQuery"
	| "trpc"
	| "express"
	| "fastify"
	| "bullmq"
	| "inngest"
	| "triggerDev"
	| "temporal"
	| "stripe"
	| "autumnJs"
	| "prisma"
	| "kysely"
	| "valibot"
	| "arktype";

const uses = (deps: Deps, names: (string | RegExp)[]) => Object.keys(deps).some((d) => names.some((n) => (typeof n === "string" ? d === n : n.test(d))));

const LIBRARIES: Record<Exclude<PluginId, "testing" | "autumn">, (string | RegExp)[]> = {
	zod: ["zod"],
	drizzle: ["drizzle-orm"],
	betterAuth: ["better-auth"],
	effect: ["effect", /^@effect\//],
	effectTesting: ["@effect/vitest"],
	hono: ["hono"],
	elysia: ["elysia"],
	aiSdk: ["ai", /^@ai-sdk\//],
	decimal: ["decimal.js", "decimal.js-light"],
	react: ["react", "react-dom"],
	nextjs: ["next"],
	tanstackQuery: [/^@tanstack\/[a-z-]*query$/],
	trpc: [/^@trpc\//],
	express: ["express"],
	fastify: ["fastify"],
	bullmq: ["bullmq", "bullmq-pro"],
	inngest: ["inngest"],
	triggerDev: [/^@trigger\.dev\//],
	temporal: [/^@temporalio\//],
	stripe: ["stripe"],
	autumnJs: ["autumn-js", "@useautumn/sdk"],
	prisma: ["@prisma/client", "prisma"],
	kysely: ["kysely"],
	valibot: ["valibot"],
	arktype: ["arktype"],
};
const TEST_RUNNERS = ["vitest", "jest", "mocha", "ava", "@jest/globals", "@types/jest", "@types/mocha", "@types/bun", "bun-types", "@playwright/test"];
const TEST_FILE = /(\.|\/|^)(test|spec)s?\.[cm]?[jt]sx?$|(^|\/)__tests__\//;

/** Plugins worth loading for a change whose packages declare `union`; everything when no manifest was found (`union` null). */
export function selectPlugins({ union, paths, owner }: { union: Deps | null; paths: string[]; owner: string }): Set<PluginId> {
	const all = Object.keys(LIBRARIES) as PluginId[];
	if (!union) return new Set([...all.filter((id) => id !== "react"), "testing", "autumn"]);
	const out = new Set(all.filter((id) => uses(union, LIBRARIES[id as keyof typeof LIBRARIES])));
	if (uses(union, TEST_RUNNERS) || paths.some((p) => TEST_FILE.test(p))) out.add("testing");
	if (owner.toLowerCase() === "useautumn") out.add("autumn");
	if (out.has("nextjs")) out.delete("react");
	return out;
}

/** Plugin options that depend on the declared major, so one narrator serves every file in a package. */
export type PluginVersions = { effect?: 3 | 4; elysia?: 1 | 2; aiSdk?: 6 | 7 };

const pick = <T extends number>(n: number | null, allowed: T[]) => (allowed.includes(n as T) ? (n as T) : undefined);

export const versionsFor = (deps: Deps): PluginVersions => ({
	effect: pick(majorOf(deps.effect), [3, 4]),
	elysia: pick(majorOf(deps.elysia), [1, 2]),
	aiSdk: pick(majorOf(deps.ai), [6, 7]),
});

/** Text that looks like it holds SQL: a quote or backtick followed by a statement keyword. */
const SQL_TEXT =
	/[`'"]\s*\(?\s*(select\s[\s\S]{0,400}?\sfrom\b|insert\s+(or\s+\w+\s+)?into\s|update\s+\S+\s+set\s|delete\s+from\s|with\s+\w+\s+as\s*\(|create\s+(table|index|unique|view|function|trigger|schema|extension)\b|alter\s+table\s|drop\s+(table|index|view)\b|truncate\s|pragma\s)/i;
export const looksLikeSqlSource = (src: string) => SQL_TEXT.test(src);
