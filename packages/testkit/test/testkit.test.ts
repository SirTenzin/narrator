import { expect, test } from "bun:test";
import { hono } from "@usenarrator/plugin-hono";
import { narrate } from "../src";

test("dependencies switch plugins on without an import in the snippet", () => {
	const code = `app.get("/", (c) => c.text("hi"));\nconst app = new Hono();`;
	expect(narrate(code, { plugins: [hono()] })).not.toContain("Answer GET");
	expect(narrate(code, { plugins: [hono()], dependencies: { hono: "^4.6.0" } })).toContain("Answer GET /");
});
