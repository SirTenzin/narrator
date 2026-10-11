import type { TsPlugin } from "@usenarrator/lang-ts";
import { aiSdk } from "@usenarrator/plugin-ai-sdk";
import { betterAuth } from "@usenarrator/plugin-better-auth";
import { decimal } from "@usenarrator/plugin-decimal";
import { drizzle } from "@usenarrator/plugin-drizzle";
import { effect } from "@usenarrator/plugin-effect";
import { effectPlatform } from "@usenarrator/plugin-effect/platform";
import { effectSql } from "@usenarrator/plugin-effect/sql";
import { effectTesting } from "@usenarrator/plugin-effect/testing";
import { elysia } from "@usenarrator/plugin-elysia";
import { hono } from "@usenarrator/plugin-hono";
import { sql } from "@usenarrator/plugin-sql";
import { pgsqlParser } from "@usenarrator/plugin-sql/pgsql";
import { testing } from "@usenarrator/plugin-testing";
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
	sql: {
		create: () => [sql({ parser: pgsqlParser })],
		detect: oneOf("postgres", "pg", "better-sqlite3", "@neondatabase/serverless", "kysely", "slonik", "@prisma/client", "mysql2", "bun-types", "@types/bun"),
	},
};

/** Plugin names whose libraries appear in the given dependency names. */
export const detectPlugins = (dependencyNames: Iterable<string>): string[] => {
	const names = [...dependencyNames];
	return Object.keys(PLUGINS).filter((plugin) => names.some(PLUGINS[plugin]!.detect));
};

/** Resolves plugin names to plugins; throws on an unknown name. */
export const loadPlugins = (names: string[]): TsPlugin[] =>
	names.flatMap((name) => {
		const spec = PLUGINS[name];
		if (!spec) throw new Error(`Unknown plugin "${name}". Available: ${Object.keys(PLUGINS).join(", ")}`);
		return spec.create();
	});
