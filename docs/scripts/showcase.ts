// Generates snippets/showcase-data.jsx: real narrations (with markup and source mapping) for the landing showpiece.
//   bun docs/scripts/showcase.ts
import { createNarrator, DETAILS, type Line } from "@usenarrator/core";
import { type TsPlugin, typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en } from "@usenarrator/locale-en";
import { betterAuth } from "@usenarrator/plugin-better-auth";
import { drizzle } from "@usenarrator/plugin-drizzle";
import { effect } from "@usenarrator/plugin-effect";
import { hono } from "@usenarrator/plugin-hono";
import { react } from "@usenarrator/plugin-react";

type Example = { id: string; label: string; file: string; plugins: TsPlugin[]; code: string };

const EXAMPLES: Example[] = [
	{
		id: "react",
		label: "React",
		file: "Cart.tsx",
		plugins: [react()],
		code: `import { useState } from "react";

export function Cart({ items, onCheckout }) {
  const [coupon, setCoupon] = useState("");
  const total = items.reduce((sum, item) => sum + item.price, 0);
  if (items.length === 0) return <p>Your cart is empty.</p>;
  return (
    <form onSubmit={() => onCheckout(coupon)}>
      <input value={coupon} onChange={(e) => setCoupon(e.target.value)} />
      <button type="submit" disabled={total === 0}>Pay</button>
    </form>
  );
}`,
	},
	{
		id: "plain",
		label: "TypeScript",
		file: "renew.ts",
		plugins: [],
		code: `export async function renew(account: Account, now: Date) {
  if (account.status === "canceled") return;
  const plan = plans.find((p) => p.id === account.planId);
  if (!plan) throw new NotFoundError("Unknown plan");
  for (const seat of account.seats) {
    if (seat.expiresAt < now) await releaseSeat(seat);
  }
  await sendReceipt({ to: account.ownerEmail, amount: plan.price });
}`,
	},
	{
		id: "drizzle",
		label: "Drizzle",
		file: "users.ts",
		plugins: [drizzle()],
		code: `export async function findActiveUsers(orgId: string) {
  return db
    .select()
    .from(users)
    .where(and(eq(users.orgId, orgId), isNull(users.deletedAt)))
    .orderBy(desc(users.createdAt))
    .limit(50);
}`,
	},
	{
		id: "effect",
		label: "Effect",
		file: "program.ts",
		plugins: [effect()],
		code: `import { Effect, Schedule } from "effect";

const program = Effect.gen(function* () {
  const db = yield* Database;
  const rows = yield* db.query("select * from users");
  if (rows.length === 0) return yield* new UserNotFound({ id: "1" });
  yield* Effect.log("loaded users");
  return rows;
}).pipe(
  Effect.retry(Schedule.exponential("100 millis")),
  Effect.timeout("5 seconds"),
);`,
	},
	{
		id: "auth",
		label: "Better Auth",
		file: "auth.ts",
		plugins: [betterAuth()],
		code: `export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  session: { expiresIn: 60 * 60 * 24 * 7 },
  plugins: [twoFactor(), organization()],
});`,
	},
	{
		id: "hono",
		label: "Hono",
		file: "api.ts",
		plugins: [hono()],
		code: `import { Hono } from "hono";

const app = new Hono();

app.get("/users/:id", async (c) => {
  const id = c.req.param("id");
  const user = await findUser(id);
  if (!user) return c.notFound();
  return c.json(user);
});

export default app;`,
	},
];

const MARKUP = /\uE000(\w)\uE001[^\uE001]*\uE001([^\uE002]*)\uE002/g;

/** Splits a markup string into `[kind, text]` segments; kind "" is plain prose. */
function segments(text: string): [string, string][] {
	const out: [string, string][] = [];
	let last = 0;
	for (const m of text.matchAll(MARKUP)) {
		if (m.index! > last) out.push(["", text.slice(last, m.index)]);
		out.push([m[1]!, m[1] === "t" ? `(${m[2]})` : m[2]!]);
		last = m.index! + m[0].length;
	}
	if (last < text.length) out.push(["", text.slice(last)]);
	return out;
}

const KEYWORDS = /^(?:export|async|function|const|let|return|if|for|of|await|throw|new|import|from|yield|true|false|null|undefined)$/;
const TOKEN = /(\/\/.*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|(.)/g;

/** A deliberately small highlighter: keywords, strings, numbers, calls, types. */
function highlight(line: string): [string, string][] {
	const out: [string, string][] = [];
	for (const m of line.matchAll(TOKEN)) {
		const [tok, comment, str, num, ident] = m;
		const next = line.slice(m.index! + tok.length);
		if (comment) out.push(["cm", tok]);
		else if (str) out.push(["st", tok]);
		else if (num) out.push(["nu", tok]);
		else if (ident && KEYWORDS.test(ident)) out.push(["kw", tok]);
		else if (ident && /^\s*\(/.test(next)) out.push(["fn", tok]);
		else if (ident && /^[A-Z]/.test(ident)) out.push(["ty", tok]);
		else if (out.at(-1)?.[0] === "") out.at(-1)![1] += tok;
		else out.push(["", tok]);
	}
	return out;
}

const lineOf = (src: string, offset: number) => src.slice(0, offset).split("\n").length;

function build(ex: Example) {
	const narrator = createNarrator({ languages: [typescript({ parser: oxcParser, plugins: ex.plugins })], locale: en });
	const { lines, stats } = narrator.narrate(ex.code, ex.file);
	if (stats.fallbacks) throw new Error(`${ex.id}: ${stats.fallbacks} fallback(s) to raw code`);
	return {
		id: ex.id,
		label: ex.label,
		file: ex.file,
		code: ex.code.split("\n").map(highlight),
		english: lines.map((l: Line) =>
			l.kind === "blank"
				? null
				: {
						d: l.d,
						kind: l.kind,
						from: l.start < 0 ? null : lineOf(ex.code, l.start),
						to: l.end < 0 ? null : lineOf(ex.code, l.end),
						s: segments(l.text.replaceAll(DETAILS, "")),
					},
		),
	};
}

const ORDER = ["plain", "react", "drizzle", "hono"];
const data = ORDER.map((id) => build(EXAMPLES.find((e) => e.id === id)!));
const out = `${import.meta.dir}/../snippets/showcase-data.jsx`;
await Bun.write(out, `// Generated by docs/scripts/showcase.ts from real narrations. Do not edit by hand.\nexport const showcase = ${JSON.stringify(data)};\n`);
Bun.spawnSync(["bunx", "biome", "format", "--write", out]);
console.log(`wrote ${data.length} examples to snippets/showcase-data.jsx`);
for (const ex of data) console.log(`\n# ${ex.label}\n${ex.english.map((l) => (l ? "  ".repeat(l.d) + l.s.map((x) => x[1]).join("") : "")).join("\n")}`);
