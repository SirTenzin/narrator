import { type ConditionPhrases, plain } from "@usenarrator/core";
import { grammar, pluralSubject, verbFor } from "../grammar";

/** "there are more than 2 items" for a plain plural; "customer's prices have more than 2 items" otherwise. */
const items = (subject: string, count: number, cmp: string) => {
	const simple = pluralSubject(subject) && !/['’]/.test(plain(subject)) && count !== 1;
	return simple ? `there are ${cmp} ${count} ${subject}` : `${subject} ${verbFor(subject).has} ${cmp} ${count} item${count === 1 ? "" : "s"}`;
};

export const conditions: ConditionPhrases = {
	bool: ({ value }) => (value ? "true" : "false"),
	it: "it",
	onlyCheckedWhen: ({ condition, when }) => `${condition} (only checked when ${when})`,
	ifElse: ({ test, then, otherwise }) => `if ${test}, ${then}; otherwise ${otherwise}`,
	fromCall: ({ call, neg }) => {
		const text = plain(call);
		if (/^whether /.test(text)) return neg ? `not ${call.replace(/whether /, "")}` : call.replace(/whether /, "");
		if (/^(the|a|an) /.test(text)) {
			const rest = call.replace(/^(the|a|an) /, "");
			return neg ? `there is no ${rest}` : `there is ${grammar.article(plain(rest))} ${rest}`;
		}
		return `${call} ${neg ? "gives back nothing" : "gives back something"}`;
	},
	methodPredicate: ({ object, predicate, args }) => `${object !== null ? `${object} ` : ""}${predicate}${args}`,
	subjectPredicate: ({ subject, predicate }) => `${subject} ${predicate}`,
	flag: ({ subject, neg }) => `${subject} ${verbFor(subject).is} ${neg ? "false" : "true"}`,
	isSet: ({ subject, neg }) => `${subject} ${verbFor(subject).is} ${neg ? "missing" : "set"}`,
	calledWithNew: ({ neg }) => `this ${neg ? "was not" : "was"} called with new`,
	isEmpty: ({ subject, neg }) => `${subject} ${isVerb(subject, neg)} empty`,
	afterAssign: ({ action, neg }) => `(after we ${action}) the result ${neg ? "is missing" : "is set"}`,
	allOf: "all of these are true",
	anyOf: "any of these is true",
	typeofNames: {
		string: "text",
		number: "a number",
		boolean: "true/false",
		object: "an object",
		function: "a function",
		undefined: "missing",
		bigint: "a big number",
		symbol: "a symbol",
	},
	isType: ({ subject, type, neg }) => `${subject} ${isVerb(subject, neg)} ${type}`,
	sameAs: ({ left, right, neg }) => `(${left}) ${neg ? "differs from" : "is the same as"} (${right})`,
	equals: ({ left, right, neg }) => `${left} ${isVerb(left, neg)} ${right}`,
	countCompare: {
		"<": ({ subject, count }) => items(subject, count, "fewer than"),
		">": ({ subject, count }) => items(subject, count, "more than"),
		"<=": ({ subject, count }) => items(subject, count, "at most"),
		">=": ({ subject, count }) => items(subject, count, "at least"),
	},
	sign: {
		">": ({ subject }) => `${subject} ${verbFor(subject).is} positive`,
		"<": ({ subject }) => `${subject} ${verbFor(subject).is} negative`,
		">=": ({ subject }) => `${subject} ${verbFor(subject).is} zero or more`,
		"<=": ({ subject }) => `${subject} ${verbFor(subject).is} zero or less`,
	},
	compare: {
		"<": ({ left, right, time }) => `${left} ${verbFor(left).is} ${time ? "before" : "less than"} ${right}`,
		">": ({ left, right, time }) => `${left} ${verbFor(left).is} ${time ? "after" : "more than"} ${right}`,
		"<=": ({ left, right, time }) => `${left} ${verbFor(left).is} ${time ? "at or before" : "at most"} ${right}`,
		">=": ({ left, right, time }) => `${left} ${verbFor(left).is} ${time ? "at or after" : "at least"} ${right}`,
	},
	instanceOf: ({ subject, type, typeWords, neg }) => `${subject} ${isVerb(subject, neg)} ${grammar.article(typeWords)} ${type}`,
	hasKey: ({ object, key, neg }) => `${object} ${neg ? `${verbFor(object).has} no` : `${verbFor(object).has} a`} ${key} key`,
};

function isVerb(subject: string, neg: boolean) {
	const v = verbFor(subject);
	return neg ? v.isNot : v.is;
}
