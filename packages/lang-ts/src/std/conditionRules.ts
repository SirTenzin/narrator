import { D } from "@usenarrator/core";
import type { CondRule } from "../plugin";
import { includes, isIn, someEvery } from "./arrayRules";
import type { StdPhrases } from "./phrases";

export const conditionRules: Record<string, CondRule<StdPhrases>> = {
	"*.includes": ({ obj, args, e, neg, say }) => includes({ e, say, obj, args, neg }),
	"*.has": ({ obj, args, e, neg, say }) => isIn({ e, say, obj, args, neg }),
	"*.some": ({ obj, args, e, neg, say }) => someEvery({ e, say, obj, args, neg, kind: "some" }),
	"*.every": ({ obj, args, e, neg, say }) => someEvery({ e, say, obj, args, neg, kind: "every" }),
	"*.startsWith": ({ obj, args, e, neg, say }) => D(say.text.startsWith({ value: e.text(obj), prefix: e.text(args[0]), neg })),
	"*.endsWith": ({ obj, args, e, neg, say }) => D(say.text.endsWith({ value: e.text(obj), suffix: e.text(args[0]), neg })),
	"*.test": ({ obj, args, e, neg, say }) => D(say.text.matches({ value: e.text(args[0]), pattern: e.text(obj), neg })),
	"Array.isArray": ({ args, e, neg, say }) => D(say.isList({ value: e.text(args[0]), neg })),
	"Number.isFinite": ({ args, e, neg, say }) => D(say.number.isFinite({ value: e.text(args[0]), neg })),
	"Number.isNaN": ({ args, e, neg, say }) => D(say.number.isNaN({ value: e.text(args[0]), neg })),
	"Number.isInteger": ({ args, e, neg, say }) => D(say.number.isInteger({ value: e.text(args[0]), neg })),
	Boolean: ({ args, e, neg }) => e.cond(args[0], neg),
	"Object.keys": () => null,
};
