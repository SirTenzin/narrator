import { definePlugin } from "@usenarrator/lang-ts";
import { narrate } from "@usenarrator/testkit";

const dates = definePlugin({
	name: "dates",
	library: { name: "date-fns", versions: ">=3 <5" },
	calls: {
		addDays: ({ args, e }) => (args.length === 2 ? `${e.text(args[1])} days after ${e.text(args[0])}` : null),
	},
});

const code = `
import { addDays as plus } from "date-fns";
import * as dfn from "date-fns";
const due = plus(issuedAt, 30);
const followUp = dfn.addDays(due, 7);
`;

console.log(narrate(code, { plugins: [dates] }));
