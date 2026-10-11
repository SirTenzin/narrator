import { createNarrator } from "@usenarrator/core";
import { autumn } from "@usenarrator/example-autumn";
import { typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en } from "@usenarrator/locale-en";
import { aiSdk } from "@usenarrator/plugin-ai-sdk";
import { betterAuth } from "@usenarrator/plugin-better-auth";
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
				autumn(),
				sql({ parser: pgsqlParser }),
			],
		}),
	],
	locale: en,
});
