import { plain } from "@usenarrator/core";
import type { StdPhrases } from "./phrases";

/** "250ms", "2 seconds", "config's delay ms", "delay milliseconds". */
const duration = (ms: string) => {
	const t = plain(ms).replace(/,/g, "");
	if (/^\d+$/.test(t)) {
		const n = Number(t);
		if (n >= 1000 && n % 1000 === 0) return n === 1000 ? "1 second" : `${(n / 1000).toLocaleString("en-US")} seconds`;
		return `${ms}ms`;
	}
	return /\bms$/i.test(t) ? ms : `${ms} milliseconds`;
};

/** "x is in seen" with item "x" -> "is in seen"; null when the condition isn't about the item itself. */
const afterItem = (cond: string, item: string) => (cond.startsWith(`${item} `) && !/ (and|or) /.test(plain(cond)) ? cond.slice(item.length + 1) : null);
const whoseOf = (cond: string, item: string) => (cond.startsWith(`${item}'s `) ? cond.slice(item.length + 3) : null);

const not = (neg: boolean) => (neg ? "not " : "");
const sameTime = (settled: boolean) => `at the same time${settled ? " (carrying on even if some fail)" : ""}`;
const firstOrLast = (last: boolean) => (last ? "last" : "first");
const logLine =
	(verb: string) =>
	({ message, details }: { message: string | null; details: string | null }) =>
		`${verb}${message ? ` ${message}` : ""}${details ? ` (with ${details})` : ""}`;

export const en: StdPhrases = {
	item: "item",
	each: ({ item }) => `each ${item}`,
	whether: ({ cond }) => `whether ${cond}`,
	nothing: "nothing",
	someCssClasses: "some CSS classes",
	constants: {
		"Number.MAX_SAFE_INTEGER": "the largest possible number",
		"Number.POSITIVE_INFINITY": "infinity",
		Infinity: "infinity",
		NaN: "not-a-number",
		"Number.EPSILON": "a tiny number",
		"Number.NaN": "not-a-number",
		"Number.NEGATIVE_INFINITY": "negative infinity",
		"Number.MIN_SAFE_INTEGER": "the smallest possible number",
	},
	map: {
		passedThrough: ({ list, fn }) => `${list}, each passed through ${fn}`,
		pluck: ({ props, list }) => `the ${props} of ${list}`,
		eachIn: ({ value, list }) => `${value} in ${list}`,
		forEach: ({ value, item, list }) => `${value}, for each ${item} in ${list}`,
		eachInto: ({ list, value }) => `${list}, each turned into ${value}`,
		withEachInto: ({ list, item, value }) => `${list}, with each ${item} turned into ${value}`,
		withEachIntoBlock: ({ list, item }) => `${list}, with each ${item} turned into the result of`,
	},
	flatMap: {
		pluck: ({ props, list }) => `all the ${props} across ${list}`,
		eachIn: ({ value, list }) => `${value} in ${list}, combined into one list`,
		forEach: ({ value, item, list }) => `everything in ${value}, for each ${item} in ${list}`,
		into: ({ item, list, value }) => `all results, combined, of turning each ${item} in ${list} into ${value}`,
		intoBlock: ({ item, list }) => `all results, combined, of turning each ${item} in ${list} into`,
	},
	filter: {
		dropEmpty: ({ list }) => `${list}, minus any empty values`,
		passing: ({ list, fn }) => `the ${list} that pass ${fn}`,
		where: ({ list, cond }) => `${list}, keeping only those where ${cond}`,
		whose: ({ list, cond }) => `${list}, keeping only those whose ${cond}`,
		checkBlock: ({ list, items }) => `${list}, keeping only the ${items} that pass this check`,
	},
	find: {
		whose: ({ list, cond }) => `the one in ${list} whose ${cond}`,
		firstWhere: ({ item, list, cond }) => `the first ${item} in ${list} where ${cond}`,
		firstCheckBlock: ({ item, list }) => `the first ${item} in ${list} that passes this check`,
		lastWhere: ({ item, list, cond }) => `the last ${item} in ${list} where ${cond}`,
		indexWhere: ({ item, list, cond }) => `the position of the first ${item} in ${list} where ${cond} (or -1)`,
	},
	some: {
		passes: ({ list, fn, neg }) => (neg ? `none of ${list} pass ${fn}` : `at least one of ${list} passes ${fn}`),
		checkBlock: ({ item, list, neg }) => `${neg ? "no" : "at least one"} ${item} in ${list} passes this check`,
		whose: ({ list, cond, neg }) => `${list} ${neg ? "has no item" : "has an item"} whose ${cond}`,
		where: ({ item, list, cond, neg, article }) => {
			const whose = whoseOf(cond, item);
			if (whose) return `${list} ${neg ? "has no" : `has ${article}`} ${item} whose ${whose}`;
			return `${list} ${neg ? "has no" : `has ${article}`} ${item} where ${cond}`;
		},
	},
	every: {
		passes: ({ list, fn, neg }) => `${neg ? "not all of" : "all of"} ${list} pass ${fn}`,
		checkBlock: ({ item, list, neg }) => `${neg ? "not every" : "every"} ${item} in ${list} passes this check`,
		whose: ({ list, cond, neg }) => `${neg ? "not every one" : "every one"} of ${list} has ${cond}`,
		where: ({ item, list, cond, neg }) => {
			const rest = afterItem(cond, item);
			if (rest) return `${neg ? "not every" : "every"} ${item} in ${list} ${rest}`;
			return neg ? `not every ${item} in ${list} satisfies: ${cond}` : `${cond} for every ${item} in ${list}`;
		},
	},
	isIn: ({ value, list, neg }) => `${value} ${neg ? "is not in" : "is in"} ${list}`,
	isOneOf: ({ value, options, neg }) => `${value} ${neg ? "is none of" : "is one of"} ${options}`,
	isList: ({ value, neg }) => `${value} is ${not(neg)}a list`,
	reduce: {
		totalProp: ({ prop, list }) => `the total ${prop} across ${list}`,
		total: ({ value, list }) => `the total of ${value} across ${list}`,
		sum: ({ list }) => `the sum of ${list}`,
		plusStart: ({ start, total }) => `${start} plus ${total}`,
		firstItem: "the first item",
		step: ({ value }) => `the running total becomes ${value}`,
		block: ({ list, start, item, acc }) =>
			`${list} combined into one value, starting from ${start}; for each ${item}${acc ? ` (with the result so far as ${acc})` : ""}`,
	},
	sort: {
		sorted: ({ list }) => `${list}, sorted`,
		using: ({ list, fn }) => `${list}, sorted using ${fn}`,
		value: "value",
		smallestFirst: ({ list, key }) => `${list}, sorted by ${key} (smallest first)`,
		largestFirst: ({ list, key }) => `${list}, sorted by ${key} (largest first)`,
		alphabetical: ({ list, key }) => `${list}, sorted alphabetically by ${key}`,
		reverseAlphabetical: ({ list, key }) => `${list}, sorted reverse-alphabetically by ${key}`,
		byRule: ({ list }) => `${list}, sorted by this rule`,
		compare: ({ a, b, expr }) => `compare ${a} and ${b} by ${expr}`,
	},
	join: {
		with: ({ list, sep }) => `${list} joined with ${sep}`,
		commas: ({ list }) => `${list} joined with commas`,
	},
	slice: {
		copy: ({ list }) => `a copy of ${list}`,
		first: ({ count, list }) => `the first ${count} of ${list}`,
		last: ({ count, list }) => `the last ${count} of ${list}`,
		from: ({ list, start }) => `${list} from position ${start} onward`,
		range: ({ list, start, end }) => `${list} from position ${start} up to ${end}`,
	},
	at: {
		first: ({ list }) => `the first of ${list}`,
		last: ({ list }) => `the last of ${list}`,
	},
	concat: ({ list, rest }) => `${list} followed by ${rest}`,
	push: {
		everything: ({ source, list }) => `add everything in ${source} to ${list}`,
		add: ({ values, list }) => `add ${values} to ${list}`,
		addBlock: ({ value, list }) => `add to ${list} ${value}`,
		addThese: ({ list }) => `add these to ${list}`,
	},
	unshift: ({ values, list }) => `put ${values} at the start of ${list}`,
	pop: ({ list }) => `take the last item off ${list}`,
	shift: ({ list }) => `take the first item off ${list}`,
	indexOf: ({ value, list }) => `the position of ${value} in ${list} (or -1)`,
	object: {
		keys: ({ value }) => `the keys of ${value}`,
		values: ({ value }) => `the values in ${value}`,
		entries: ({ value }) => `the key/value pairs of ${value}`,
		fromEntries: ({ value }) => `an object built from ${value}`,
		merged: ({ sources }) => `${sources} merged together`,
		copyInto: ({ sources, target }) => `copy everything from ${sources} into ${target}`,
		copiedInto: ({ sources, target }) => `the result of copying everything from ${sources} into ${target}`,
	},
	arrayFrom: {
		mapped: ({ source, value }) => `${source} as a list, each turned into ${value}`,
		sized: ({ count }) => `a list of ${count} items`,
		sizedEach: ({ count, value }) => `a list of ${count} items, each ${value}`,
		range: ({ count }) => `the numbers from 0 up to (but not including) ${count}`,
		list: ({ source }) => `${source} as a list`,
	},
	collection: {
		get: ({ ownerPossessive, key }) => `${ownerPossessive} entry for ${key}`,
		set: ({ value, key, owner }) => `record ${value} under ${key} in ${owner}`,
		add: ({ value, owner }) => `add ${value} to ${owner}`,
		remove: ({ value, owner }) => `remove ${value} from ${owner}`,
		clear: ({ owner }) => `empty out ${owner}`,
		uniqueOf: ({ value }) => `the unique values of ${value}`,
		emptySet: "an empty set",
		lookupFrom: ({ value }) => `a lookup table built from ${value}`,
		emptyLookup: "an empty lookup table",
		promise: "a promise",
	},
	text: {
		asText: ({ value }) => `${value} as text`,
		lowercase: ({ value }) => `${value} in lowercase`,
		uppercase: ({ value }) => `${value} in uppercase`,
		trimmed: ({ value }) => `${value} without surrounding spaces`,
		split: ({ value, sep }) => `${value} split on ${sep}`,
		replace: ({ value, search, replacement }) => `${value} with ${search} replaced by ${replacement}`,
		replaceAll: ({ value, search, replacement }) => `${value} with every ${search} replaced by ${replacement}`,
		padStart: ({ value, length }) => `${value} padded to ${length} characters`,
		charAt: ({ value, index }) => `the character at ${index} in ${value}`,
		compare: ({ value, other }) => `how ${value} compares alphabetically to ${other}`,
		startsWith: ({ value, prefix, neg }) => `${value} ${neg ? "does not start" : "starts"} with ${prefix}`,
		endsWith: ({ value, suffix, neg }) => `${value} ${neg ? "does not end" : "ends"} with ${suffix}`,
		matches: ({ value, pattern, neg }) => `${value} ${neg ? "does not match" : "matches"} ${pattern}`,
		match: ({ value, pattern, all }) => `${all ? "every match" : "the first match"} of ${pattern} in ${value}`,
		matchAll: ({ value, pattern }) => `every match of ${pattern} in ${value}`,
	},
	number: {
		asNumber: ({ value }) => `${value} as a number`,
		asWholeNumber: ({ value }) => `${value} as a whole number`,
		toFixed: ({ value, places }) => `${value} rounded to ${places} decimal places`,
		isFinite: ({ value, neg }) => `${value} is ${not(neg)}a real number`,
		isNaN: ({ value, neg }) => `${value} is ${not(!neg)}a valid number`,
		isInteger: ({ value, neg }) => `${value} is ${not(neg)}a whole number`,
	},
	date: {
		from: ({ value }) => `${value} as a date`,
		timestamp: ({ value }) => `${value} as a timestamp`,
		isoString: ({ value }) => `${value} as an ISO date string`,
		now: "the current time",
		utc: ({ parts }) => `the UTC timestamp for ${parts}`,
		part: ({ value, part, utc }) => {
			const name = {
				FullYear: "year",
				Month: "month (0-11)",
				Date: "day of the month",
				Day: "weekday (0-6)",
				Hours: "hour",
				Minutes: "minute",
				Seconds: "second",
				Milliseconds: "millisecond",
			}[part];
			return `the ${utc ? "UTC " : ""}${name} of ${value}`;
		},
	},
	promise: {
		then: ({ value, item, result }) => `${value}, then (with the result as ${item}) ${result}`,
		catch: ({ value, fallback }) => `${value} (and if that fails, ${fallback} instead)`,
		catchBlock: ({ value }) => `${value}, and if that fails`,
		finally: ({ value, action }) => `${value}, then either way ${action}`,
		finallyBlock: ({ value }) => `${value}, then either way`,
		race: ({ stmt }) => (stmt ? "wait for whichever of these finishes first" : "whichever of these finishes first"),
	},
	json: {
		stringify: ({ value }) => `${value} as JSON`,
		parse: ({ value }) => `${value} parsed from JSON`,
	},
	math: {
		max: ({ values, many }) => `the ${many ? "largest" : "larger"} of ${values}`,
		min: ({ values, many }) => `the ${many ? "smallest" : "smaller"} of ${values}`,
		round: ({ value }) => `${value}, rounded`,
		floor: ({ value }) => `${value}, rounded down`,
		ceil: ({ value }) => `${value}, rounded up`,
		abs: ({ value }) => `the absolute value of ${value}`,
		random: "a random number",
	},
	exit: ({ code }) => `exit the process${code ? ` with code ${code}` : ""}`,
	deepCopy: ({ value }) => `a deep copy of ${value}`,
	setTimeout: ({ ms, stmt }) => (stmt ? `after ${duration(ms)}, do the following` : `a timer that, after ${duration(ms)}, does the following`),
	print: ({ value, errors }) => `print ${value}${errors ? " to the error output" : ""}`,
	bigint: ({ value }) => `${value} as a big integer`,
	wait: ({ ms }) => `wait ${duration(ms)}`,
	pause: ({ ms }) => `a pause of ${duration(ms)}`,
	timeoutSignal: ({ ms }) => `a signal that times out after ${duration(ms)}`,
	throwIfAborted: ({ signal }) => `stop with an error if ${signal} has been cancelled`,
	clearTimer: ({ timer }) => `cancel ${timer}`,
	setInterval: ({ ms, stmt }) => (stmt ? `every ${duration(ms)}, do the following` : `a timer that, every ${duration(ms)}, does the following`),
	node: {
		path: ({ parts }) => `the path ${parts.join(" / ")}`,
		fullPath: ({ parts }) => `the full path of ${parts.join(" / ")}`,
		folderOf: ({ path }) => `the folder of ${path}`,
		fileNameOf: ({ path }) => `the file name of ${path}`,
		extensionOf: ({ path }) => `the file extension of ${path}`,
		tmpdir: "the system temp folder",
		homedir: "the home folder",
		readFile: ({ path }) => `the contents of the file at ${path}`,
		writeFile: ({ path, data }) => `write ${data} to the file at ${path}`,
		appendFile: ({ path, data }) => `append ${data} to the file at ${path}`,
		mkdir: ({ path }) => `create the folder ${path}`,
		mkdtemp: ({ prefix }) => `a new temporary folder, ${prefix} plus a random suffix`,
		remove: ({ path }) => `delete ${path}`,
		readdir: ({ path }) => `the names in the folder ${path}`,
		stat: ({ path }) => `the file details of ${path}`,
		rename: ({ from, to }) => `move ${from} to ${to}`,
		copy: ({ from, to }) => `copy ${from} to ${to}`,
		exists: ({ path, neg }) => `${path} ${neg ? "does not exist" : "exists"}`,
	},
	event: {
		preventDefault: ({ event }) => `stop the browser's default handling of ${event}`,
		stopPropagation: ({ event }) => `stop ${event} from reaching outer elements`,
	},
	log: {
		log: logLine("log"),
		debug: logLine("debug log"),
		warn: logLine("warn"),
		error: logLine("log an error"),
	},
	parallel: {
		list: ({ stmt, settled }) => `${stmt ? "do" : "the results of doing"} these ${sameTime(settled)}`,
		each: ({ item, list, stmt, settled }) => `for every ${item} in ${list}, all ${sameTime(settled)}${stmt ? "" : ", collecting the results"}`,
		other: ({ value, stmt, settled }) => `${stmt ? "wait for all of" : "the results of"} ${value}${settled ? " (carrying on even if some fail)" : ""}`,
	},
	pipe: {
		steps: ({ source }) => `${source}, after these steps`,
		stage: ({ n, step }) => `${n}. ${step}`,
		them: "them",
		dropEmpty: "drop empty values",
		keepWhere: ({ cond }) => `keep only those where ${cond}`,
		keepWhose: ({ cond }) => `keep only those whose ${cond}`,
		keepCheckBlock: ({ items }) => `keep only the ${items} that pass this check`,
		keepPassing: ({ fn }) => `keep only those that pass ${fn}`,
		passThrough: ({ fn, flat }) => `pass each one through ${fn}${flat ? ", and flatten the results into one list" : ""}`,
		takeAll: ({ props }) => `take all of their ${props}`,
		takeEach: ({ prop }) => `take each one's ${prop}`,
		destructuredItem: ({ names }) => `item (${names})`,
		turnEach: ({ item, value, flat }) => `turn each ${item} into ${value}${flat ? ", and flatten the results into one list" : ""}`,
		turnEachBlock: ({ item, flat }) => `turn each ${item} into the result of these steps${flat ? ", and flatten the results into one list" : ""}`,
		takeWhere: ({ cond, last }) => `take the ${firstOrLast(last)} one where ${cond}`,
		takeWhose: ({ cond, last }) => `take the ${firstOrLast(last)} one whose ${cond}`,
		takePassing: ({ fn, last }) => `take the ${firstOrLast(last)} one that passes ${fn}`,
		takeCheckBlock: ({ last }) => `take the ${firstOrLast(last)} one that passes this check`,
		checkHas: ({ cond, some }) => `check whether ${some ? "any of them has" : "all of them have"} ${cond}`,
		checkPasses: ({ fn, some }) => `check whether ${some ? "any of them passes" : "all of them pass"} ${fn}`,
		checkPassesBlock: ({ some }) => `check whether ${some ? "any of them passes" : "all of them pass"} this check`,
		dedupe: "remove duplicates",
		sort: "sort them",
		sortBy: {
			smallestFirst: ({ key }) => `sort them by ${key} (smallest first)`,
			largestFirst: ({ key }) => `sort them by ${key} (largest first)`,
			alphabetical: ({ key }) => `sort them alphabetically by ${key}`,
			reverseAlphabetical: ({ key }) => `sort them reverse-alphabetically by ${key}`,
		},
		joinWith: ({ sep }) => `join them with ${sep}`,
		joinCommas: "join them with commas",
		reverse: "reverse the order",
	},
};
