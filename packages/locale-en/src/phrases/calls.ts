import type { CallPhrases } from "@usenarrator/core";
import { grammar, sp } from "../grammar";

const ownerOf = (object: string | null) => (object !== null ? `${grammar.possessive(object)} ` : "");

export const calls: CallPhrases = {
	superCall: ({ args }) => `set up the parent class${args}`,
	run: ({ fn, owner, args }) => `run ${fn}${sp(owner)}${args}`,
	trigger: ({ fn, owner, args }) => `trigger ${fn}${sp(owner)}${args}`,
	action: ({ fn, owner, args }) => `${fn}${sp(owner)}${args}`,
	resultOf: ({ fn, owner, args }) => `the result of ${fn}${sp(owner)}${args}`,
	noun: ({ fn, words, plural, owner, args }) => `${plural ? "" : `${grammar.article(words)} `}${fn}${sp(owner)}${args}`,
	prepositional: ({ fn, args, owner }) => `the ${fn} ${args}${sp(owner)}`,
	convert: ({ target, subject, owner, given }) => `the ${target} of ${subject}${sp(owner)}${given !== null ? ` (given ${given})` : ""}`,
	convertArgs: ({ target, source, owner, args }) => `the ${target} of ${source}${sp(owner)}${args}`,
	checkWhether: ({ condition }) => `check whether ${condition}`,
	predicate: ({ subject, predicate, owner, given }) =>
		`${subject !== null ? `${subject} ` : ""}${predicate}${sp(owner)}${given !== null ? ` (given ${given})` : ""}`,
	methodPredicate: ({ object, predicate, args, action }) =>
		`${action ? "check whether " : "whether "}${object !== null ? `${object} ` : ""}${predicate}${args}`,
	methodVerb: ({ verb, object, rest, args }) => `${verb}${object !== null ? ` ${object}` : ""}${rest !== null ? ` ${rest}` : ""}${args}`,
	method: ({ object, method, args }) => `${ownerOf(object)}${method}${args}`,
	methodRun: ({ object, method, args }) => `run ${ownerOf(object)}${method}${args}`,
	methodTrigger: ({ object, method, args }) => `trigger ${ownerOf(object)}${method}${args}`,
	callValue: ({ callee, args }) => `the result of ${callee}${args}`,
	callAction: ({ callee, args }) => `run ${callee}${args}`,
	newInstance: ({ ctor, args }) => `a new ${ctor}${args}`,
};
