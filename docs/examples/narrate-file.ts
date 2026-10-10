import { createNarrator, renderText } from "@usenarrator/core";
import { typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en } from "@usenarrator/locale-en";
import { zod } from "@usenarrator/plugin-zod";

const narrator = createNarrator({
	languages: [typescript({ parser: oxcParser, plugins: [zod()] })],
	locale: en,
});

const source = `
export const Signup = z.object({ email: z.string().email(), plan: z.enum(["free", "pro"]) });

export function countOpenSeats(team: Team) {
  if (team.plan === "enterprise") return Infinity;
  return team.seatLimit - team.members.length;
}
`;

const { lines } = narrator.narrate(source, "signup.ts");
console.log(renderText(lines));
