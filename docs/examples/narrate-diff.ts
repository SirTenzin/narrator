import { createNarrator } from "@usenarrator/core";
import { typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en } from "@usenarrator/locale-en";

const narrator = createNarrator({ languages: [typescript({ parser: oxcParser })], locale: en });

const before = `
export function countOpenSeats(team: Team) {
  if (team.plan === "enterprise") return Infinity;
  return team.seatLimit - team.members.length;
}
`;
const after = `
export function countOpenSeats(team: Team) {
  if (team.plan === "enterprise" || team.isTrial) return Infinity;
  const used = team.members.filter((m) => !m.isGuest).length;
  return Math.max(0, team.seatLimit - used);
}
`;

const [file] = narrator.diff([{ path: "team.ts", oldPath: null, status: "modified", oldSrc: before, newSrc: after }]);
const text = (html: string) =>
	html
		.replace(/<span class="t">(.*?)<\/span>/g, "($1)")
		.replace(/<[^>]+>/g, "")
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">");

for (const unit of file!.units) {
	console.log(`${unit.title} (${unit.status}, +${unit.adds} -${unit.dels})`);
	for (const row of unit.rows) {
		if (row.kind === "same") console.log(`    ${text(row.right!.html)}`);
		if (row.left && row.kind !== "same") console.log(`  - ${text(row.left.html)}`);
		if (row.right && row.kind !== "same") console.log(`  + ${text(row.right.html)}`);
	}
}
