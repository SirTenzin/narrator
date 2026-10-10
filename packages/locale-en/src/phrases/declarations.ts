import type { DeclarationPhrases } from "@usenarrator/core";

export const declarations: DeclarationPhrases = {
	names: { defaultExport: "default export", anonymous: "anonymous", anonymousClass: "anonymous class" },
	type: ({ name, shape }) => `Type ${name}: ${shape}`,
	enum: ({ name, members }) => `Enum ${name}: ${members}`,
	uninitialized: ({ name }) => `Start with no ${name} yet`,
	letMean: ({ name, condition }) => `Let ${name} mean ${condition}`,
	callInto: ({ call, name }) => `${call} → ${name}`,
	callAs: ({ call, name }) => `${call}, and call the result ${name}`,
	letStart: ({ name, value }) => `Let ${name} start as ${value}`,
	let: ({ name, value }) => `Let ${name} be ${value}`,
	declare: ({ names }) => `Declare ${names}`,
	callTake: ({ call, names }) => `${call}, and take its ${names}`,
	takeFrom: ({ source, names }) => `From ${source}, take ${names}`,
	skipped: "(skip)",
	parallel: "Do these at the same time",
	callTakeFirst: ({ call, name }) => `${call}, and take the first result as ${name}`,
	letFirst: ({ name, value }) => `Let ${name} be the first of ${value}`,
	split: ({ value, names }) => `Split ${value} into ${names}`,
	title: {
		converter: ({ from, to }) => `${from} → ${to}`,
		predicate: ({ words }) => `${words}?`,
		component: ({ name }) => `${name} (component)`,
		toType: ({ target }) => `To turn into ${target}`,
		action: ({ action }) => `To ${action}`,
	},
	signature: ({ title, params, returns, async }) => {
		const parts = [params !== null && `given ${params}`, returns !== null && `gives back ${returns}`].filter(Boolean);
		return `${title}${async ? " (async)" : ""}${parts.length ? `, ${parts.join("; ")}` : ""}`;
	},
	class: ({ name, base }) => `Class ${name}${base !== null ? ` (extends ${base})` : ""}`,
	constructor: ({ params }) => `When created${params !== null ? `, given ${params}` : ""}`,
	fieldInit: ({ field, value }) => `Field ${field} starts as ${value}`,
	field: ({ field }) => `Field ${field}`,
};
