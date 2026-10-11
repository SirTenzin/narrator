// Every changed line vs the golden baseline, bucketed by a rough reason, for reviewing intentional re-baselines.
import { narrator } from "./narrator";
import { AUTUMN, corpusFiles, GOLDEN } from "./corpus";

const plain = (s: string) => s.replace(/\uE000\w\uE001[^\uE001]*\uE001([^\uE002]*)\uE002/g, "$1");
const golden = new Map<string, string[]>();
for (const row of new TextDecoder().decode(Bun.gunzipSync(await Bun.file(`${GOLDEN}/golden.jsonl.gz`).bytes())).split("\n")) {
	const r = JSON.parse(row);
	golden.set(
		r.f,
		(r.lines ?? []).map((l: unknown[]) => plain(String(l[4]))),
	);
}
const buckets: Record<string, { f: string; was: string; now: string }[]> = {};
for (const f of await corpusFiles()) {
	const was = golden.get(f) ?? [];
	const now = narrator.narrate(await Bun.file(`${AUTUMN}/${f}`).text(), f).lines.map((l) => plain(l.text));
	if (was.join("\n") === now.join("\n")) continue;
	const wasSet = new Set(was);
	const nowSet = new Set(now);
	const gone = was.filter((l) => !nowSet.has(l));
	const added = now.filter((l) => !wasSet.has(l));
	const a = gone[0] ?? "";
	const b = added[0] ?? "";
	const reason = a.includes("\u0000")
		? "nul-them"
		: a.includes("…") && b.length > a.length
			? "untruncated"
			: /auth|session|sign/i.test(b)
				? "better-auth?"
				: /SQL|row|transaction|table|first|newest|oldest|ignoring case/i.test(b)
					? "drizzle?"
					: "other";
	(buckets[reason] ??= []).push({ f, was: a, now: b });
}
for (const [k, v] of Object.entries(buckets)) {
	console.log(`\n## ${k}: ${v.length}`);
	for (const x of v.slice(0, Number(process.env.SHOW ?? 6))) console.log(`- ${x.f}\n  was: ${x.was.slice(0, 220)}\n  now: ${x.now.slice(0, 220)}`);
}
