import type { TsPlugin } from "@usenarrator/lang-ts";
import { aiSdk } from "@usenarrator/plugin-ai-sdk";
import { arktype } from "@usenarrator/plugin-arktype";
import { betterAuth } from "@usenarrator/plugin-better-auth";
import { bullmq } from "@usenarrator/plugin-bullmq";
import { decimal } from "@usenarrator/plugin-decimal";
import { drizzle } from "@usenarrator/plugin-drizzle";
import { effect } from "@usenarrator/plugin-effect";
import { effectPlatform } from "@usenarrator/plugin-effect/platform";
import { effectSql } from "@usenarrator/plugin-effect/sql";
import { effectTesting } from "@usenarrator/plugin-effect/testing";
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
import { pgsqlParser } from "@usenarrator/plugin-sql/pgsql";
import { stripe } from "@usenarrator/plugin-stripe";
import { tanstackQuery } from "@usenarrator/plugin-tanstack-query";
import { temporal } from "@usenarrator/plugin-temporal";
import { testing } from "@usenarrator/plugin-testing";
import { triggerDev } from "@usenarrator/plugin-trigger-dev";
import { trpc } from "@usenarrator/plugin-trpc";
import { valibot } from "@usenarrator/plugin-valibot";
import { zod } from "@usenarrator/plugin-zod";

type PluginSpec = {
	create: () => TsPlugin[];
	/** npm packages whose presence in a manifest turns the plugin on. */
	detect: (name: string) => boolean;
};

const oneOf =
	(...names: string[]) =>
	(name: string) =>
		names.includes(name);

/** Every plugin the CLI can load, by the name `--plugins` takes. */
export const PLUGINS: Record<string, PluginSpec> = {
	zod: { create: () => [zod()], detect: oneOf("zod") },
	testing: { create: () => [testing()], detect: oneOf("vitest", "jest", "@jest/globals", "@types/jest", "bun-types", "@types/bun") },
	decimal: { create: () => [decimal()], detect: oneOf("decimal.js", "decimal.js-light") },
	drizzle: { create: () => [drizzle()], detect: oneOf("drizzle-orm") },
	effect: {
		create: () => [effect(), effectPlatform(), effectSql(), effectTesting()],
		detect: (name) => name === "effect" || name.startsWith("@effect/"),
	},
	"better-auth": { create: () => [betterAuth()], detect: oneOf("better-auth") },
	hono: { create: () => [hono()], detect: oneOf("hono") },
	elysia: { create: () => [elysia()], detect: oneOf("elysia") },
	"ai-sdk": { create: () => [aiSdk()], detect: (name) => name === "ai" || name.startsWith("@ai-sdk/") },
	react: { create: () => [react()], detect: (name) => name === "react" || name === "react-dom" },
	nextjs: { create: () => nextjs(), detect: oneOf("next") },
	"tanstack-query": { create: () => [tanstackQuery()], detect: (name) => /^@tanstack\/[a-z-]*query$/.test(name) },
	trpc: { create: () => [trpc()], detect: (name) => name.startsWith("@trpc/") },
	express: { create: () => [express()], detect: oneOf("express") },
	fastify: { create: () => [fastify()], detect: oneOf("fastify") },
	bullmq: { create: () => [bullmq()], detect: oneOf("bullmq", "bullmq-pro") },
	inngest: { create: () => [inngest()], detect: oneOf("inngest") },
	"trigger-dev": { create: () => [triggerDev()], detect: (name) => name.startsWith("@trigger.dev/") },
	temporal: { create: () => [temporal()], detect: (name) => name.startsWith("@temporalio/") },
	stripe: { create: () => [stripe()], detect: oneOf("stripe") },
	prisma: { create: () => [prisma()], detect: oneOf("@prisma/client", "prisma") },
	kysely: { create: () => [kysely()], detect: oneOf("kysely") },
	valibot: { create: () => [valibot()], detect: oneOf("valibot") },
	arktype: { create: () => [arktype()], detect: oneOf("arktype") },
	sql: {
		create: () => [sql({ parser: pgsqlParser })],
		detect: oneOf("postgres", "pg", "better-sqlite3", "@neondatabase/serverless", "kysely", "slonik", "@prisma/client", "mysql2", "bun-types", "@types/bun"),
	},
};

/** Plugin names whose libraries appear in the given dependency names. */
export const detectPlugins = (dependencyNames: Iterable<string>): string[] => {
	const names = [...dependencyNames];
	const found = Object.keys(PLUGINS).filter((plugin) => names.some(PLUGINS[plugin]!.detect));
	// nextjs() already includes a React plugin that knows next/link and next/image.
	return found.includes("nextjs") ? found.filter((p) => p !== "react") : found;
};

/** Resolves plugin names to plugins; throws on an unknown name. */
export const loadPlugins = (names: string[]): TsPlugin[] =>
	names.flatMap((name) => {
		const spec = PLUGINS[name];
		if (!spec) throw new Error(`Unknown plugin "${name}". Available: ${Object.keys(PLUGINS).join(", ")}`);
		return spec.create();
	});
