// Parity check against the pre-SDK baseline. `bun tools/dev/golden.ts` compares; `--write` re-snapshots.
import { narrator } from "@narrate/cli";
import { commitFiles, corpusFiles, AUTUMN, GOLDEN, TEST_COMMITS } from "./corpus";

const write = process.argv.includes("--write");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

const narrateRows: string[] = [];
for (const f of await corpusFiles()) {
	if (only && !f.includes(only)) continue;
	const src = await Bun.file(`${AUTUMN}/${f}`).text();
	try {
		const { lines } = narrator.narrate(src, f);
		narrateRows.push(JSON.stringify({ f, lines: lines.map((l) => [l.d, l.kind, l.start, l.end, l.text]) }));
	} catch (e) {
		narrateRows.push(JSON.stringify({ f, error: String(e) }));
	}
}
const diffs: Record<string, unknown> = {};
if (!only) for (const sha of TEST_COMMITS) diffs[sha] = narrator.diff(await commitFiles(sha));

if (write) {
	await Bun.write(`${GOLDEN}/golden.jsonl.gz`, Bun.gzipSync(new TextEncoder().encode(narrateRows.join("\n"))));
	await Bun.write(`${GOLDEN}/diffs.json`, JSON.stringify(diffs));
	console.log("wrote golden", narrateRows.length);
	process.exit(0);
}

const golden = new Map<string, string>();
for (const row of new TextDecoder().decode(Bun.gunzipSync(await Bun.file(`${GOLDEN}/golden.jsonl.gz`).bytes())).split("\n")) golden.set(JSON.parse(row).f, row);
let same = 0;
const changed: string[] = [];
const plain = (s: string) => s.replace(/\uE000\w\uE001[^\uE001]*\uE001([^\uE002]*)\uE002/g, "$1");
for (const row of narrateRows) {
	const { f } = JSON.parse(row);
	const want = golden.get(f);
	if (want === row) {
		same++;
		continue;
	}
	const a = want ? JSON.parse(want) : { lines: [] };
	const b = JSON.parse(row);
	const i = (b.lines ?? []).findIndex((l: unknown, k: number) => JSON.stringify(l) !== JSON.stringify(a.lines?.[k]));
	changed.push(`${f}${b.error ? ` ERROR ${b.error}` : ""}\n   was: ${plain(String(a.lines?.[i]?.[4] ?? a.lines?.[i] ?? "(none)"))}\n   now: ${plain(String(b.lines?.[i]?.[4] ?? "(none)"))}`);
}
let diffSame = true;
if (!only) {
	const goldenDiffs = await Bun.file(`${GOLDEN}/diffs.json`).json();
	for (const sha of TEST_COMMITS) if (JSON.stringify(goldenDiffs[sha]) !== JSON.stringify(diffs[sha])) {
		diffSame = false;
		console.log(`diff report changed for ${sha}`);
	}
}
console.log(changed.slice(0, Number(process.env.SHOW ?? 15)).join("\n"));
console.log({ files: narrateRows.length, same, changed: changed.length, diffReportsSame: diffSame });
process.exit(changed.length || !diffSame ? 1 : 0);
