import { describe, expect, test } from "bun:test";
import { narrate, narrateWithStats } from "@usenarrator/testkit";
import { definePlugin } from "../src";

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
