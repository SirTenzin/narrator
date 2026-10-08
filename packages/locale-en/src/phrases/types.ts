import type { TypePhrases } from "@narrate/core";
import { grammar } from "../grammar";

const orNothing = (optional: boolean) => (optional ? " (or nothing)" : "");
const quoted = (doc: string | null) => (doc ? ` — “${doc}”` : "");

export const types: TypePhrases = {
	unknown: "something",
	string: "text",
	number: "a number",
	boolean: "true/false",
	nothing: "nothing",
	any: "anything",
	object: "an object",
	function: "a function",
	listOf: ({ item }) => `a list of ${item}`,
	lookup: ({ key, value }) => `a lookup of ${key} to ${value}`,
	map: ({ key, value }) => `a map of ${key} to ${value}`,
	set: ({ item }) => `a set of ${item}`,
	reference: ({ type, name }) => `${grammar.article(name)} ${type}`,
	oneOf: ({ options, optional }) => `one of ${options}${orNothing(optional)}`,
	union: ({ options, optional }) => `${options}${orNothing(optional)}`,
	objectWith: ({ members }) => `an object with ${members}`,
	tuple: ({ items }) => `a pair of ${items}`,
	predicate: ({ subject, type }) => `whether ${subject} is ${type}`,
	member: ({ name, optional }) => `${name}${optional ? " (optional)" : ""}`,
	explain: {
		object: ({ name, bases }) => `${name} is an object${bases !== null ? ` (plus everything in ${bases})` : ""} with`,
		oneOf: ({ name }) => `${name} is one of`,
		class: ({ name }) => `${name} is a class with`,
		method: "a method",
		field: "a field",
		member: ({ name, type, optional, doc }) => `${name}${optional ? " (optional)" : ""}: ${type}${quoted(doc)}`,
		enumMember: ({ name, value, doc }) => `${name}${value !== null ? ` (${value})` : ""}${quoted(doc)}`,
		option: ({ value, doc }) => `${value}${quoted(doc)}`,
		schemaShape: ({ name, schema }) => `${name} is the shape of the schema ${schema}`,
		intersection: ({ name, bases }) => `${name} is ${bases !== null ? `everything in ${bases}, plus` : "an object with"}`,
		is: ({ name, type }) => `${name} is ${type}`,
		fromSchema: ({ name, schema }) => `${name} (from the schema ${schema})`,
		schemaField: ({ described }) =>
			described
				.replace(/optional(, )?/, "")
				.replace(/ \(\)$/, "")
				.replace(/, \)$/, ")"),
		nullable: "can be null",
		list: "a list",
		defaultsTo: ({ value }) => `defaults to ${value}`,
		modified: ({ base, modifiers }) => `${base}${modifiers.length ? ` (${modifiers.join(", ")})` : ""}`,
	},
};
