import { type ConditionPhrases, plain } from "@usenarrator/core";
import { grammar } from "../grammar";

const missingOrSet = (neg: boolean) => (neg ? "is missing" : "is set");

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
	flag: ({ subject, neg }) => `${subject} is ${neg ? "false" : "true"}`,
	isSet: ({ subject, neg }) => `${subject} ${missingOrSet(neg)}`,
	calledWithNew: ({ neg }) => `this ${neg ? "was not" : "was"} called with new`,
	isEmpty: ({ subject, neg }) => `${subject} ${neg ? "is not empty" : "is empty"}`,
	afterAssign: ({ action, neg }) => `(after we ${action}) the result ${missingOrSet(neg)}`,
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
	isType: ({ subject, type, neg }) => `${subject} ${neg ? "is not" : "is"} ${type}`,
	sameAs: ({ left, right, neg }) => `(${left}) ${neg ? "differs from" : "is the same as"} (${right})`,
	equals: ({ left, right, neg }) => `${left} ${neg ? "is not" : "is"} ${right}`,
	countCompare: {
		"<": ({ subject, count }) => `${subject} has fewer than ${count} item${count === 1 ? "" : "s"}`,
		">": ({ subject, count }) => `${subject} has more than ${count} item${count === 1 ? "" : "s"}`,
		"<=": ({ subject, count }) => `${subject} has at most ${count} item${count === 1 ? "" : "s"}`,
		">=": ({ subject, count }) => `${subject} has at least ${count} item${count === 1 ? "" : "s"}`,
	},
	sign: {
		">": ({ subject }) => `${subject} is positive`,
		"<": ({ subject }) => `${subject} is negative`,
		">=": ({ subject }) => `${subject} is zero or more`,
		"<=": ({ subject }) => `${subject} is zero or less`,
	},
	compare: {
		"<": ({ left, right, time }) => `${left} ${time ? "is before" : "is less than"} ${right}`,
		">": ({ left, right, time }) => `${left} ${time ? "is after" : "is more than"} ${right}`,
		"<=": ({ left, right, time }) => `${left} ${time ? "is at or before" : "is at most"} ${right}`,
		">=": ({ left, right, time }) => `${left} ${time ? "is at or after" : "is at least"} ${right}`,
	},
	instanceOf: ({ subject, type, typeWords, neg }) => `${subject} ${neg ? "is not" : "is"} ${grammar.article(typeWords)} ${type}`,
	hasKey: ({ object, key, neg }) => `${object} ${neg ? "has no" : "has a"} ${key} key`,
};
