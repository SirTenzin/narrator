import { mk } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "@usenarrator/lang-ts";
import type { CronDays, TimePhrases, TimeUnit } from "./phrases";

/** Durations and cron schedules in words. Kept identical across the job-queue plugins so each package stays independent. */
type Ctx = { e: Engine; time: TimePhrases };
type Span = { n: number; unit: TimeUnit }[];

const UNIT_MS: [TimeUnit, number][] = [
	["day", 86_400_000],
	["hour", 3_600_000],
	["minute", 60_000],
	["second", 1000],
	["millisecond", 1],
];

const UNIT_WORDS: [RegExp, TimeUnit][] = [
	[/^(ms|msecs?|milliseconds?)$/, "millisecond"],
	[/^(s|secs?|seconds?)$/, "second"],
	[/^(m|mins?|minutes?)$/, "minute"],
	[/^(h|hrs?|hours?)$/, "hour"],
	[/^(d|days?)$/, "day"],
	[/^(w|wks?|weeks?)$/, "week"],
	[/^(mo|months?)$/, "month"],
	[/^(y|yrs?|years?)$/, "year"],
];

/** `ms` / Inngest / Temporal style strings: "1d", "1h30m", "30 seconds", "500ms". */
export function parseDuration(s: string): Span | null {
	const src = s.trim().toLowerCase();
	if (!src) return null;
	const out: Span = [];
	const re = /(\d+(?:\.\d+)?)\s*([a-z]+)\s*/gy;
	let m: RegExpExecArray | null = re.exec(src);
	let end = 0;
	while (m) {
		const word = m[2]!;
		const unit = UNIT_WORDS.find(([r]) => r.test(word))?.[1];
		if (!unit) return null;
		out.push({ n: Number(m[1]), unit });
		end = re.lastIndex;
		m = re.exec(src);
	}
	return end === src.length && out.length ? out : null;
}

/** Milliseconds as at most two whole units: 90000 -> 1 minute 30 seconds. */
export function msSpan(ms: number): Span {
	if (ms === 0) return [{ n: 0, unit: "second" }];
	const out: Span = [];
	let rest = ms;
	for (const [unit, size] of UNIT_MS) {
		if (rest < size) continue;
		const n = Math.floor(rest / size);
		out.push({ n, unit });
		rest -= n * size;
		if (out.length === 2) break;
	}
	if (rest > 0) return [{ n: ms, unit: "millisecond" }];
	return out;
}

const spanText = ({ e, time }: Ctx, span: Span) => e.g.list(span.map((p) => time.amount({ n: mk("l", e.g.formatNumber(p.n)), count: p.n, unit: p.unit })));

const OBJECT_UNITS: Record<string, TimeUnit> = {
	milliseconds: "millisecond",
	seconds: "second",
	minutes: "minute",
	hours: "hour",
	days: "day",
	weeks: "week",
	months: "month",
	years: "year",
};

const keyOf = (p: N): string | null => (p.type === "Property" && !p.computed && p.key.type === "Identifier" ? p.key.name : null);

/** A duration value: a number in `unit` (ms by default), a duration string, or a `{ seconds: 30 }` object. */
export function durationText(c: Ctx, node: N, unit: "ms" | "s" = "ms", per = false): string {
	const text = durationWords(c, node, unit);
	if (!per) return text;
	const u = unwrap(node);
	const n = u?.type === "Literal" && typeof u.value === "number" ? u.value : null;
	const span = typeof u?.value === "string" ? parseDuration(u.value) : n !== null ? msSpan(unit === "s" ? n * 1000 : n) : null;
	return span?.length === 1 && span[0]!.n === 1 ? c.time.unit({ unit: span[0]!.unit }) : text;
}

function durationWords(c: Ctx, node: N, unit: "ms" | "s"): string {
	const { e, time } = c;
	const u = unwrap(node);
	if (u?.type === "Literal" && typeof u.value === "string") {
		const span = parseDuration(u.value);
		return span ? spanText(c, span) : e.text(u);
	}
	if (u?.type === "ObjectExpression") {
		const parts: Span = [];
		for (const p of u.properties) {
			const k = keyOf(p);
			const v = k ? e.fold(p.value) : null;
			if (!k || !OBJECT_UNITS[k] || v === null) return e.text(u);
			parts.push({ n: v, unit: OBJECT_UNITS[k] });
		}
		return parts.length ? spanText(c, parts) : e.text(u);
	}
	const n = u ? e.fold(u) : null;
	if (n !== null && Number.isFinite(n) && n >= 0) {
		const ms = unit === "s" ? n * 1000 : n;
		if (Number.isInteger(ms)) return spanText(c, msSpan(ms));
	}
	return (unit === "s" ? time.inSeconds : time.inMs)({ value: e.text(node) });
}

// ---------- cron ----------

type Field = number[] | null;
export type Cron = {
	seconds: Field;
	minutes: Field;
	hours: Field;
	monthDays: Field;
	months: Field;
	weekdays: Field;
	/** `*` step on minutes or seconds, e.g. 5 for `*\/5`. */
	minuteStep: number | null;
	secondStep: number | null;
	hourStep: number | null;
};

const MACROS: Record<string, string> = {
	"@yearly": "0 0 1 1 *",
	"@annually": "0 0 1 1 *",
	"@monthly": "0 0 1 * *",
	"@weekly": "0 0 * * 0",
	"@daily": "0 0 * * *",
	"@midnight": "0 0 * * *",
	"@hourly": "0 * * * *",
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function value(s: string, names: string[] | null, base: number): number | null {
	if (/^\d+$/.test(s)) return Number(s);
	const i = names?.indexOf(s.toLowerCase()) ?? -1;
	return i < 0 ? null : i + base;
}

/** One cron field as the sorted values it matches; null for `*`. Undefined when it can't be read. */
function field(src: string, min: number, max: number, names: string[] | null = null, base = 0): { values: Field; step: number | null } | undefined {
	if (src === "*" || src === "?") return { values: null, step: null };
	const star = /^\*\/(\d+)$/.exec(src);
	if (star) return { values: null, step: Number(star[1]) };
	const out = new Set<number>();
	for (const part of src.split(",")) {
		const m = /^([a-z0-9]+)(?:-([a-z0-9]+))?(?:\/(\d+))?$/i.exec(part);
		if (!m) return undefined;
		const lo = value(m[1]!, names, base);
		const hi = m[2] ? value(m[2], names, base) : m[3] ? max : lo;
		const step = m[3] ? Number(m[3]) : 1;
		if (lo === null || hi === null || lo < min || hi > max || lo > hi || step < 1) return undefined;
		for (let v = lo; v <= hi; v += step) out.add(v);
	}
	return { values: [...out].sort((a, b) => a - b), step: null };
}

/** Five fields (minute hour day month weekday), or six with seconds first. Null when it isn't standard cron. */
export function parseCron(expr: string): Cron | null {
	const src = MACROS[expr.trim().toLowerCase()] ?? expr.trim();
	const parts = src.split(/\s+/);
	if (parts.length !== 5 && parts.length !== 6) return null;
	const [s, mi, h, dom, mon, dow] = parts.length === 6 ? parts : ["0", ...parts];
	const sec = field(s!, 0, 59);
	const min = field(mi!, 0, 59);
	const hr = field(h!, 0, 23);
	const md = field(dom!, 1, 31);
	const mo = field(mon!, 1, 12, MONTHS, 1);
	const wd = field(dow!, 0, 7, DAYS, 0);
	if (!sec || !min || !hr || !md || !mo || !wd || md.step || mo.step || wd.step) return null;
	const weekdays = wd.values && [...new Set(wd.values.map((d) => d % 7))].sort((a, b) => a - b);
	return {
		seconds: sec.values,
		minutes: min.values,
		hours: hr.values,
		monthDays: md.values,
		months: mo.values,
		weekdays: weekdays?.length === 7 ? null : weekdays,
		minuteStep: min.step,
		secondStep: sec.step,
		hourStep: hr.step,
	};
}

const pad = (n: number) => String(n).padStart(2, "0");

function daysOf(c: Cron): CronDays {
	if (c.monthDays) return { kind: "monthDays", days: c.monthDays, months: c.months, weekdays: c.weekdays };
	if (c.months) return { kind: "months", months: c.months, weekdays: c.weekdays };
	if (c.weekdays) return { kind: "weekdays", days: c.weekdays };
	return { kind: "everyDay" };
}

/** A parsed cron schedule in words, or null when it's too irregular to say better than the expression. */
export function cronWords({ e, time }: Ctx, c: Cron): string | null {
	const days = daysOf(c);
	const fixedSecond = c.seconds?.length === 1 && c.secondStep === null;
	if (c.secondStep !== null || c.seconds === null) {
		if (c.minutes || c.hours || c.minuteStep || c.hourStep) return null;
		const every = c.secondStep && c.secondStep > 1 ? time.cron.everySeconds({ n: mk("l", String(c.secondStep)) }) : time.cron.everySecond;
		return time.cron.repeating({ every, between: null, days });
	}
	if (!fixedSecond || c.seconds![0] !== 0) return null;
	const between = c.hours && c.hours.at(-1)! - c.hours[0]! === c.hours.length - 1 ? [`${pad(c.hours[0]!)}:00`, `${pad(c.hours.at(-1)!)}:59`] : null;
	if (c.minutes === null) {
		if (c.hourStep || (c.hours && !between)) return null;
		const every = c.minuteStep && c.minuteStep > 1 ? time.cron.everyMinutes({ n: mk("l", String(c.minuteStep)) }) : time.cron.everyMinute;
		return time.cron.repeating({ every, between: between && { from: mk("l", between[0]!), to: mk("l", between[1]!) }, days });
	}
	if (c.hours === null) {
		const minutes = c.minutes.map((m) => mk("l", String(m)));
		const every = c.hourStep
			? time.cron.everyHours({ n: mk("l", String(c.hourStep)), minutes: e.g.list(minutes), onTheHour: c.minutes.length === 1 && c.minutes[0] === 0 })
			: time.cron.hourly({ minutes: e.g.list(minutes), onTheHour: c.minutes.length === 1 && c.minutes[0] === 0 });
		return time.cron.repeating({ every, between: null, days });
	}
	const times = c.hours.flatMap((h) => c.minutes!.map((m) => `${pad(h)}:${pad(m)}`));
	if (times.length > 6) {
		if (!between) return null;
		const minutes = e.g.list(c.minutes.map((m) => mk("l", String(m))));
		const every = time.cron.hourly({ minutes, onTheHour: c.minutes.length === 1 && c.minutes[0] === 0 });
		return time.cron.repeating({ every, between: { from: mk("l", between[0]!), to: mk("l", between[1]!) }, days });
	}
	return time.cron.at({ times: e.g.list(times.map((t) => mk("l", t))), days });
}

/** A cron expression node (optionally `TZ=Zone …`-prefixed) in words with the expression kept: "every day at 09:00 UTC (cron 0 9 * * *)". */
export function cronText(c: Ctx, node: N, zone: string | null = null): string {
	const { e, time } = c;
	const u = unwrap(node);
	const src =
		u?.type === "Literal" && typeof u.value === "string" ? u.value : u?.type === "TemplateLiteral" && !u.expressions.length ? u.quasis[0].value.cooked : null;
	if (src === null) return time.cron.from({ value: e.text(node) });
	return cronString(c, src, zone);
}

export function cronString(c: Ctx, src: string, zone: string | null = null): string {
	const { time } = c;
	const tz = /^(?:CRON_)?TZ=(\S+)\s+(.*)$/.exec(src.trim());
	const expr = tz ? tz[2]! : src.trim();
	const parsed = parseCron(expr);
	const words = parsed && cronWords(c, parsed);
	const code = mk("c", src.trim());
	if (!words) return time.cron.raw({ expr: code, zone: (tz?.[1] ?? zone) && mk("l", (tz?.[1] ?? zone)!) });
	const zoned = tz?.[1] ?? zone;
	const clock = !!parsed && (parsed.hours !== null || parsed.weekdays !== null || parsed.monthDays !== null || parsed.months !== null);
	return time.cron.schedule({ words, zone: zoned && clock ? mk("l", zoned) : null, expr: code });
}
