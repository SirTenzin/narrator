import { renderText } from "@usenarrator/core";
import { createNodeNarrator } from "@usenarrator/node";
import { zod } from "@usenarrator/plugin-zod";

const narrator = createNodeNarrator({ plugins: [zod()] });

const source = `
import { z } from "zod";

export const Signup = z.object({ email: z.string().email(), plan: z.enum(["free", "pro"]) });

export function countOpenSeats(team: Team) {
  if (team.plan === "enterprise") return Infinity;
  return team.seatLimit - team.members.length;
}
`;

const { lines } = narrator.narrate(source, "src/signup.ts");
console.log(renderText(lines));
