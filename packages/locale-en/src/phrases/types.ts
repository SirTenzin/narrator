import type { TypePhrases } from "@usenarrator/core";
import { grammar } from "../grammar";

const orNothing = (optional: boolean) => (optional ? " (or nothing)" : "");
const quoted = (doc: string | null) => (doc ? ` (“${doc}”)` : "");

const ORDINALS = ["first", "second", "third", "fourth", "fifth"];

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
	intersection: ({ parts }) => parts.join(", plus "),
	indexed: ({ type, key }) => `the type of ${type}'s ${key}`,
	typeOf: ({ value }) => `the type of ${value}`,
	keyOf: ({ type }) => `a key of ${type}`,
	itemOf: ({ type }) => `an item of ${type}`,
	pick: ({ type, fields }) => `the ${fields} of ${type}`,
	omit: ({ type, fields }) => `${type} without ${fields}`,
	returnOf: ({ fn }) => `what ${fn} gives back`,
	paramsOf: ({ fn, index }) => (index === null ? `the inputs of ${fn}` : `the ${ORDINALS[index] ?? `#${index + 1}`} input of ${fn}`),
	bigint: "a big number",
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
