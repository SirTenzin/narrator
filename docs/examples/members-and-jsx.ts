import { definePlugin } from "@usenarrator/lang-ts";
import { narrate } from "@usenarrator/testkit";

const platform = definePlugin({
	name: "platform",
	members: {
		// `env.STRIPE_KEY` -> "the STRIPE_KEY setting"
		"env.*": ({ prop }) => `the ${prop} setting`,
		// `req.session.user` on any receiver -> "the signed-in user"
		"*.session.user": () => "the signed-in user",
	},
	calls: {
		// A tagged template: `` gql`...` ``
		"gql``": ({ e }) => (e.usesLibrary("graphql-tag") ? "a GraphQL query" : null),
	},
	jsx: ({ node, e }) => {
		const name = node.openingElement?.name?.name;
		if (name !== "Feature") return null;
		const flag = node.openingElement.attributes.find((a: any) => a.name?.name === "flag");
		return `the children, only when the ${e.text(flag.value)} flag is on`;
	},
});

const code = `
import gql from "graphql-tag";
const key = env.STRIPE_KEY;
await audit(req.session.user, "export");
const Query = gql\`query { viewer { id } }\`;
const banner = <Feature flag="new-nav"><Nav /></Feature>;
`;

console.log(narrate(code, { plugins: [platform], path: "app.tsx" }));
