import { createNarrator, renderDiffText } from "@usenarrator/core";
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

const files = narrator.diffFiles([{ path: "team.ts", oldPath: null, status: "modified", oldSrc: before, newSrc: after }]);
console.log(renderDiffText({ files }));
