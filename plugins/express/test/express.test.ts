import { describe, expect, test } from "bun:test";
import { narrate, narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { type ExpressPhrases, en, express } from "../src";

const plugins = [express()];
const EX = `import express from "express";\nconst app = express();\n`;

/** Narrates with the plugin and asserts nothing fell back to raw code. */
const read = (code: string) => {
	const { text, fallbacks } = narrateWithStats(code, { plugins });
	expect(fallbacks).toBe(0);
	return text;
};

describe("apps and routes", () => {
	test("the hello-world app", () => {
		expect(
			read(`const express = require("express");
const app = express();
const port = 3000;
app.get("/", (req, res) => {
  res.send("Hello World!");
});
app.listen(port, () => {
  console.log(\`Example app listening on port \${port}\`);
});`),
		).toBe(
			[
				"Let app be a new Express app.",
				"Let port be 3000.",
				"",
				"Answer GET /:",
				`  Reply with "Hello World!".`,
				"",
				"Start app listening on port port:",
				"  • Once it is listening:",
				'    Log "Example app listening on port {port}".',
			].join("\n"),
		);
	});

	test("a one-line handler reads inline; middleware before it reads as 'after'", () => {
		expect(read(`${EX}app.get("/", (req, res) => res.send("Hello World!"));`)).toContain(`Answer GET / with "Hello World!".`);
		expect(read(`${EX}const router = express.Router();\nrouter.post("/login", validate(loginSchema), authController.login);`)).toContain(
			"Answer POST /login with auth controller's login, after validate (login schema).",
		);
	});

	test("a handler's request reads, status replies and next(err)", () => {
		const text = read(`${EX}app.get("/users/:id", auth, async (req, res, next) => {
  const { page } = req.query;
  const token = req.get("Authorization");
  try {
    const user = await db.find(id);
    if (!user) return res.sendStatus(404);
    res.status(200).json(user);
  } catch (err) {
    next(err);
  }
});`);
		expect(text).toBe(
			[
				"Let app be a new Express app.",
				"",
				"Answer GET /users/:id, after auth:",
				"  From the query parameters, take page.",
				"  Let token be the Authorization request header.",
				"  Try the following:",
				"    Find DB (ID), and call the result user.",
				"    If user is missing, reply with status 404 Not Found.",
				"    Reply with user as JSON (status 200 OK).",
				"  If anything fails (call the problem error):",
				"    Pass error to the error handler.",
			].join("\n"),
		);
	});

	test("app.route chains one path's methods", () => {
		expect(read(`${EX}app.route("/book").get((req, res) => res.send("Get a random book")).post(createBook);`)).toContain(
			["For /book:", `  • Answer GET with "Get a random book"`, "  • Answer POST with create book"].join("\n"),
		);
	});

	test("Express 5 path patterns are kept in full", () => {
		expect(read(`${EX}app.get("/*splat", (req, res) => res.sendStatus(404));\napp.get("/user{/:id}", show);`)).toContain(
			["Answer GET /*splat with status 404 Not Found.", "Answer GET /user{/:id} with show."].join("\n"),
		);
	});
});

describe("middleware", () => {
	test("built-in and common middleware by name", () => {
		const text = read(`import express from "express";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import userRoutes from "./routes/users";
const app = express();
app.use(cors({ origin: "https://example.com", credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet());
app.use(morgan("dev"));
app.use(express.static("public"));
app.use("/api/users", userRoutes);`);
		expect(text).toBe(
			[
				"Let app be a new Express app.",
				`Run CORS (origin: "https://example.com"; credentials: yes) on every request.`,
				"Run JSON body parsing on every request.",
				"Run form body parsing (extended: yes) on every request.",
				"Run security headers on every request.",
				"Run request logging in the dev format on every request.",
				"Run static files from public on every request.",
				"Mount user routes under /api/users.",
			].join("\n"),
		);
	});

	test("inline middleware and the four-parameter error handler", () => {
		const text = read(`${EX}app.use("/admin", (req, res, next) => {
  if (!req.user) return res.redirect("/login");
  next();
});
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});`);
		expect(text).toBe(
			[
				"Let app be a new Express app.",
				"",
				"For requests under /admin:",
				`  If request's user is missing, redirect to "/login".`,
				"  Let the next handler run.",
				"",
				"When a request fails:",
				"  Log an error (with error's stack).",
				`  Reply with "Something broke!" (status 500 Internal Server Error).`,
			].join("\n"),
		);
	});

	test("settings", () => {
		expect(read(`${EX}app.set("view engine", "pug");\napp.disable("x-powered-by");\nconst env = app.get("env");`)).toBe(
			["Let app be a new Express app.", `Set the view engine setting to "pug".`, "Turn off the x-powered-by setting.", "Let env be the env setting."].join(
				"\n",
			),
		);
	});
});

describe("responses", () => {
	test("cookies, redirects and rendering in a typed controller", () => {
		const text = read(`import type { Request, Response } from "express";
export const login = async (req: Request, res: Response) => {
  res.cookie("token", token, { httpOnly: true });
  res.set("Cache-Control", "no-store");
  res.redirect(301, "/dashboard");
};
export const page = (req: Request, res: Response) => res.render("profile", { user: req.user });`);
		expect(text).toContain(`Set the token cookie to token (HTTP only: yes).`);
		expect(text).toContain(`Set the Cache-Control response header to "no-store".`);
		expect(text).toContain(`Redirect to "/dashboard" (status 301 Moved Permanently).`);
		expect(text).toContain("the profile page, rendered with an object with user: request's user");
	});
});

describe("guards", () => {
	test("Map and other objects named like apps are left alone without Express", () => {
		const src = `const app = createApp();\napp.get("/x", handler);\napp.use(plugin);\nres.json(data);`;
		expect(narrate(src, { plugins })).toBe(narrate(src));
	});

	test("Map#get/set in an Express file", () => {
		const src = `const cache = new Map();\ncache.set("a", 1);\nconst v = cache.get("a");`;
		expect(
			narrate(EX + src, { plugins })
				.split("\n")
				.slice(1),
		).toEqual(narrate(src).split("\n"));
	});
});

describe("phrasebook", () => {
	test("English is complete against its own type", () => {
		expect(phrasebookGaps(en, en satisfies ExpressPhrases)).toEqual({ missing: [], extra: [] });
	});
});
