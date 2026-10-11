import { describe, expect, spyOn, test } from "bun:test";
import { createNarrator, extendLocale, type Locale, plain, renderText } from "@usenarrator/core";
import { en } from "@usenarrator/locale-en";
import { narrate, narrateWithStats } from "@usenarrator/testkit";
import { definePlugin, type TsPlugin, typescript } from "../src";
import { oxcParser } from "../src/oxc";

describe("member rules", () => {
	const bindings = definePlugin({
		name: "bindings",
		members: {
			"*.env.*": ({ prop }) => `the ${prop} binding`,
			"cfg.*": ({ prop }) => `the ${prop} setting`,
		},
	});

	test("family keys claim any property under an owner", () => {
		expect(narrate("const db = c.env.DB;\nconst t = cfg.timeout;", { plugins: [bindings] })).toBe("Let DB be the DB binding.\nLet t be the timeout setting.");
	});

	test("a rule on an inner link owns the rest of the chain", () => {
		expect(narrate("const n = c.env.DB.name;", { plugins: [bindings] })).toBe("Let n be the DB binding's name.");
	});
});

describe("robustness", () => {
	test("calls named like Object.prototype members read as plain calls", () => {
		const r = narrateWithStats("constructor(x);\nconst a = y.toString();\nhasOwnProperty(z);");
		expect(r.text).toBe("Run constructor (x).\nLet a be y as text.\nCheck whether z has own property.");
	});

	test("control characters in strings are shown as escapes", () => {
		expect(narrate('const a = "nul\\0"; const b = `a\\tb\\nc`;')).toBe('Let a be "nul\\0".\nLet b be "a\\tb\\nc".');
	});
});

describe("calls", () => {
	test("a result named after its own call reads as just the call", () => {
		expect(narrate("async function f() { const user = await findUser(id); const total = await sumAll(xs); }")).toBe(
			"To f (async):\n  Find user (ID).\n  Sum all (xs), and call the result total.",
		);
	});

	test("catch on a step stays an action", () => {
		expect(narrate("await sendEmail(x).catch(() => {});\nawait sendEmail(x).catch((err) => { log(err); });")).toBe(
			"Send email (x), ignoring any failure.\n\nSend email (x), and if that fails:\n  Log (error).",
		);
	});

	test("unknown tagged templates keep their text; Bun's $ is a shell command", () => {
		expect(narrate('import { $ } from "bun";\nconst r = await client`select ${a}`;\nawait $`ls ${dir}`;')).toBe(
			'Let r be "select {a}", processed by client.\nRun the shell command "ls {dir}".',
		);
	});

	test("joining with newlines reads as lines; a block list joins as 'the following'", () => {
		expect(narrate('const d = ["a", "b"].join("\\n");')).toBe('Let d be a list of "a" and "b", one per line.');
		expect(narrate('const e = [`a long line number one here ${x}`, `another long line number two here ${y}`, "third"].join("\\n");')).toBe(
			'Let e be the following, one per line:\n  • "a long line number one here {x}"\n  • "another long line number two here {y}"\n  • "third"',
		);
	});
});

const narrator = (plugins: TsPlugin[], locale: Locale = en) => createNarrator({ languages: [typescript({ parser: oxcParser, plugins })], locale });

describe("rule isolation", () => {
	const broken = definePlugin({
		name: "broken",
		calls: {
			explode: () => {
				throw new Error("rule bug");
			},
			answer: () => 42 as unknown as string,
			"*.save": ({ e }) => {
				e.emit(0, "half a line", null);
				throw new Error("late bug");
			},
		},
		conditions: { ready: () => ({ nope: true }) as unknown as string },
		members: { "cfg.port": () => [] as unknown as string },
		jsx: () => {
			throw new Error("jsx bug");
		},
		statements: [
			({ node }) => {
				if (node.type === "ThrowStatement") throw new Error("statement bug");
				return false;
			},
		],
		describeSchema: () => {
			throw new Error("schema bug");
		},
	});
	const fallback = definePlugin({ name: "fallback", calls: { explode: () => "the fallback rule's words" } });

	test("a throwing rule falls through to the next rule, and the file still narrates", () => {
		const r = narrator([fallback, broken]).narrate("explode(a);\nwork();", "x.ts");
		expect(renderText(r.lines)).toBe("The fallback rule's words.\nRun work.");
		expect(r.stats.ruleErrors).toEqual([{ plugin: "broken", rule: 'calls["explode"]', message: "rule bug", count: 1, line: 1 }]);
		expect(r.problems).toEqual([
			{ path: "x.ts", message: "rule bug", severity: "warning", source: "plugin", plugin: "broken", rule: 'calls["explode"]', line: 1 },
		]);
	});

	test("testkit still fails loudly on a broken rule", () => {
		expect(() => narrate("explode(a);", { plugins: [broken] })).toThrow(/rule bug/);
	});

	test("every rule kind falls back to default narration, and bad return values are reported", () => {
		const r = narrator([broken]).narrate(
			'answer(1);\nif (ready()) go();\nconst p = cfg.port;\nuser.save();\nconst el = <div />;\nthrow new Error("x");',
			"x.tsx",
		);
		expect(renderText(r.lines)).toBe(
			[
				"Run answer (1).",
				"If there is a result of ready, run go.",
				"Let p be config's port.",
				"Save user.",
				"Let el be <div>.",
				'Fail with an error: "x".',
			].join("\n"),
		);
		expect(r.stats.ruleErrors?.map((x) => `${x.rule}: ${x.message}`)).toEqual([
			'calls["answer"]: returned number 42; expected a Doc, a string or null',
			'conditions["ready"]: returned an object; expected a Doc, a string or null',
			'members["cfg.port"]: returned an array; expected a Doc, a string or null',
			'calls["*.save"]: late bug',
			"jsx: jsx bug",
			"statements[0]: statement bug",
		]);
	});

	test("a throwing describeSchema is skipped", () => {
		const e = typescript({ parser: oxcParser, plugins: [broken] }).engine(en);
		e.narrate("const S = z.object({});", "x.ts");
		expect(e.schemaText(e.program.body[0].declarations[0].init)).toBeNull();
		expect(e.stats.ruleErrors).toEqual([{ plugin: "broken", rule: "describeSchema", message: "schema bug", count: 1, line: 1 }]);
	});
});

describe("rule keys and imports", () => {
	const dates = definePlugin({
		name: "dates",
		library: { name: "date-fns", versions: ">=3" },
		calls: {
			addDays: ({ args, e }) => `${e.text(args[1])} days after ${e.text(args[0])}`,
			"new Interval": () => "a new interval",
			"z.object": () => "an object schema",
		},
	});
	const zodish = definePlugin({ name: "zodish", library: { name: "zod", versions: "*" }, calls: { "z.object": () => "an object schema" } });

	test("an aliased import still matches the library's rule", () => {
		expect(narrate('import { addDays as plus } from "date-fns";\nconst due = plus(d, 3);', { plugins: [dates] })).toBe("Let due be 3 days after d.");
	});

	test("namespace and default imports match by member name", () => {
		const code =
			'import * as dfn from "date-fns";\nimport df from "date-fns/fp";\nconst a = dfn.addDays(d, 1);\nconst b = df.addDays(d, 2);\nconst i = new dfn.Interval();';
		expect(narrate(code, { plugins: [dates] })).toBe("Let a be 1 days after d.\nLet b be 2 days after d.\nLet i be a new interval.");
	});

	test("an aliased object import matches `Obj.method` keys", () => {
		expect(narrate('import { z as zod } from "zod";\nconst S = zod.object({});', { plugins: [zodish] })).toBe("Let S be an object schema.");
	});

	test("aliases only match plugins for the library they came from", () => {
		expect(narrate('import { addDays as plus } from "other-dates";\nconst due = plus(d, 3);', { plugins: [dates] })).toBe(
			"Let due be the result of plus (d and 3).",
		);
		const noLibrary = definePlugin({ name: "nolib", calls: { addDays: () => "matched" } });
		expect(narrate('import { addDays as plus } from "date-fns";\nconst due = plus(d, 3);', { plugins: [noLibrary] })).toBe(
			"Let due be the result of plus (d and 3).",
		);
	});

	test("keys no code can match warn once at load", () => {
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		const bad = definePlugin({
			name: "badkeys",
			calls: { "Foo..bar": () => null, "a b": () => null, "*.ok": () => null, "new *.x": () => null },
			members: { prop: () => null },
		});
		narrator([bad]).narrate("x;", "a.ts");
		narrator([bad]).narrate("x;", "b.ts");
		expect(warn.mock.calls.map((c) => String(c[0]).match(/keyed "([^"]+)"/)?.[1])).toEqual(["Foo..bar", "a b", "new *.x", "prop"]);
		warn.mockRestore();
	});
});

describe("syntax errors", () => {
	test("statements around the error still narrate, with a note where it was", () => {
		const r = narrator([]).narrate("const a = 1;\nfoo(a);\nconst b = ;\nbar(b);\n", "x.ts");
		expect(r.errors).toBe(1);
		expect(renderText(r.lines)).toBe("Let a be 1.\nRun foo (a).\nLine 3 has a syntax error, so it's left out.\nRun bar (b).");
	});

	test("an unfinished block at the end keeps everything before it", () => {
		expect(narrate("function f() {\n  return 1;\n}\nif (x) {\n  y(\n")).toBe("To f:\n  Give back 1.\nLines 4 to 5 have a syntax error, so they're left out.");
	});

	test("several broken spots each get a note", () => {
		expect(narrate("const x = {\n  a: 1,\n  b: ,\n};\nexport function g() {\n  go();\n}\nconst q = )\nlast();")).toBe(
			"Let x be an object with a: 1.\n\nLine 3 has a syntax error, so it's left out.\nTo g:\n  Run go.\n\nLine 8 has a syntax error, so it's left out.\nRun last.",
		);
	});

	test("a broken line deep inside a class only loses that line", () => {
		const methods = Array.from({ length: 6 }, (_, i) => `  m${i}() {\n    step${i}();\n  }`);
		methods.splice(3, 0, "  m9() {\n    const = ;\n  }");
		expect(narrate(`class Big {\n${methods.join("\n")}\n}`)).toBe(
			[
				"Class Big:",
				...[0, 1, 2].flatMap((i) => [`  M${i}:`, `    Run step${i}.`]),
				"  M9:",
				"    Do nothing.",
				"  Line 12 has a syntax error, so it's left out.",
				...[3, 4, 5].flatMap((i) => [`  M${i}:`, `    Run step${i}.`]),
			].join("\n"),
		);
	});

	test("errors oxc recovers from itself are narrated as before", () => {
		expect(narrate("if (!ok) return legacy();\nconst x = ;\ngo();")).toBe(
			"If ok is missing, give back the result of legacy.\nLine 2 has a syntax error, so it's left out.\nRun go.",
		);
	});

	test("units still line up for diffs", () => {
		const units = narrator([]).fileNarrator("x.ts").units("export function a() {\n  one();\n}\nconst = ;\nexport function b() {\n  two();\n}\n", "x.ts");
		expect(units.map((u) => [u.key, u.lines.map((l) => plain(l.text))])).toEqual([
			["a", ["To a:", "Run one."]],
			["b", ["Line 4 has a syntax error, so it's left out.", "To b:", "Run two."]],
		]);
	});
});

describe("variable names", () => {
	test("a result keeps its name unless it is exactly what the verb acts on", () => {
		expect(
			narrate(
				"async function f() {\n  const session = await getServerSession(authOptions);\n  const posts = await getPosts();\n  const user = await findUserById(id);\n  return session.user.id === id;\n}",
			),
		).toBe(
			"To f (async):\n  Get server session (auth options), and call the result session.\n  Get posts.\n  Find user by ID (ID).\n  Give back whether session's user's ID is ID.",
		);
	});

	test("destructured reduce parameters are introduced", () => {
		expect(narrate("const r = Object.entries(o).reduce((acc, [key, value]) => { acc[key] = value; return acc; }, {});")).toBe(
			"Let r be the key/value pairs of o combined into one value, starting from an empty object; for each key and value (with the result so far as total so far):\n  Set total so far's entry for key to value.\n  Give back total so far.",
		);
	});

	test("constructor parameter properties say they are kept", () => {
		expect(narrate("class Repo {\n  constructor(private readonly db: Db, public name: string, plain: number) {}\n}")).toBe(
			"Class Repo:\n  When created, given DB, name, and plain:\n    Keep DB and name as fields.",
		);
	});
});

describe("flags", () => {
	test("option-style names read as one setting", () => {
		expect(narrate("if (onlyAdults) go();\nif (opts.includeDeleted) all();\nif (!skipCache) fetch();")).toBe(
			"If only adults is true, run go.\nIf options' include deleted is true, run all.\nIf skip cache is false, fetch.",
		);
	});
});

describe("translations", () => {
	type GreetPhrases = { hello: (p: { who: string }) => string; bye: { soon: string; later: string } };
	const greet = definePlugin<GreetPhrases>({
		name: "greet",
		phrases: {
			en: { hello: ({ who }) => `say hello to ${who}`, bye: { soon: "say bye for now", later: "say bye for later" } },
			fr: { bye: { soon: "dire à bientôt" } } as GreetPhrases,
		},
		calls: {
			hello: ({ args, e, say }) => say.hello({ who: e.text(args[0]) }),
			byeSoon: ({ say }) => say.bye.soon,
			byeLater: ({ say }) => say.bye.later,
		},
	});
	const code = "hello(friend);\nbyeSoon();\nbyeLater();";

	test("extendLocale merges core phrases key by key", () => {
		const es = extendLocale(en, { id: "es", phrases: { statements: { ifThen: ({ condition, action }) => `Si ${condition}, ${action}` } } });
		expect(narrate("if (ok) go();\nconst a = 1;", { locale: es })).toBe("Si ok is set, run go.\nLet a be 1.");
	});

	test("a partial locale override of a plugin falls back to English per key", () => {
		const es = extendLocale(en, { id: "es", plugins: { greet: { bye: { later: "decir adiós" } } } });
		expect(narrate(code, { plugins: [greet], locale: es })).toBe("Say hello to friend.\nSay bye for now.\nDecir adiós.");
	});

	test("a plugin's own partial translation falls back to English per key, under the locale's overrides", () => {
		expect(narrate(code, { plugins: [greet], locale: extendLocale(en, { id: "fr" }) })).toBe("Say hello to friend.\nDire à bientôt.\nSay bye for later.");
		const fr = extendLocale(en, { id: "fr", plugins: { greet: { hello: ({ who }: { who: string }) => `saluer ${who}` } } });
		expect(narrate(code, { plugins: [greet], locale: fr })).toBe("Saluer friend.\nDire à bientôt.\nSay bye for later.");
	});

	test("extendLocale layers on another extended locale", () => {
		const base = extendLocale(en, { id: "es", plugins: { greet: { bye: { soon: "hasta pronto" } } } });
		const mx = extendLocale(base, { id: "es-MX", plugins: { greet: { bye: { later: "nos vemos" } } } });
		expect(narrate(code, { plugins: [greet], locale: mx })).toBe("Say hello to friend.\nHasta pronto.\nNos vemos.");
	});
});
