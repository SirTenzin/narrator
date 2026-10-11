import { createNarrator } from "@usenarrator/core";
import { autumn } from "@usenarrator/example-autumn";
import { typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en } from "@usenarrator/locale-en";
import { aiSdk } from "@usenarrator/plugin-ai-sdk";
import { betterAuth } from "@usenarrator/plugin-better-auth";
import { bullmq } from "@usenarrator/plugin-bullmq";
import { effect } from "@usenarrator/plugin-effect";
import { effectPlatform } from "@usenarrator/plugin-effect/platform";
import { effectSql } from "@usenarrator/plugin-effect/sql";
import { effectTesting } from "@usenarrator/plugin-effect/testing";
import { elysia } from "@usenarrator/plugin-elysia";
import { express } from "@usenarrator/plugin-express";
import { fastify } from "@usenarrator/plugin-fastify";
import { hono } from "@usenarrator/plugin-hono";
import { inngest } from "@usenarrator/plugin-inngest";
import { nextjs } from "@usenarrator/plugin-nextjs";
import { react } from "@usenarrator/plugin-react";
import { sql } from "@usenarrator/plugin-sql";
import { pgsqlParser } from "@usenarrator/plugin-sql/pgsql";
import { tanstackQuery } from "@usenarrator/plugin-tanstack-query";
import { temporal } from "@usenarrator/plugin-temporal";
import { testing } from "@usenarrator/plugin-testing";
import { triggerDev } from "@usenarrator/plugin-trigger-dev";
import { trpc } from "@usenarrator/plugin-trpc";
import { zod } from "@usenarrator/plugin-zod";

export { main } from "./main";
export { detectPlugins, loadPlugins, PLUGINS } from "./plugins";

/** Every plugin plus the Autumn preset, without dependency detection: the narrator dev tools and parity checks use. */
export const narrator = createNarrator({
	languages: [
		typescript({
			parser: oxcParser,
			plugins: [
				zod(),
				testing(),
				effect(),
				effectPlatform(),
				effectSql(),
				effectTesting(),
				betterAuth(),
				hono(),
				elysia(),
				aiSdk(),
				...nextjs(),
				tanstackQuery(),
				trpc(),
				express(),
				fastify(),
				bullmq(),
				inngest(),
				triggerDev(),
				temporal(),
				autumn(),
				sql({ parser: pgsqlParser }),
			],
		}),
	],
	locale: en,
});
