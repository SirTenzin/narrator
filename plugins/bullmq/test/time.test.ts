import { describe, expect, test } from "bun:test";
import { plain } from "@usenarrator/core";
import { narrateWithStats } from "@usenarrator/testkit";
import { bullmq } from "../src";
import { parseDuration } from "../src/time";

const schedule = (pattern: string, tz?: string) => {
	const { text, fallbacks } = narrateWithStats(
		`import { Queue } from "bullmq";\nawait queue.upsertJobScheduler("s", { pattern: ${JSON.stringify(pattern)}${tz ? `, tz: "${tz}"` : ""} });`,
		{ plugins: [bullmq()] },
	);
	expect(fallbacks).toBe(0);
	return plain(text)
		.replace(/^Schedule an? "s" job on queue /, "")
		.replace(/ \(job scheduler "s"\)\.$/, "");
};

describe("cron in words", () => {
	test.each([
		["0 9 * * *", "every day at 09:00 (cron 0 9 * * *)"],
		["*/5 * * * *", "every 5 minutes (cron */5 * * * *)"],
		["* * * * *", "every minute (cron * * * * *)"],
		["0 * * * *", "every hour, on the hour (cron 0 * * * *)"],
		["15 * * * *", "every hour at minute 15 (cron 15 * * * *)"],
		["0 */2 * * *", "every 2 hours, on the hour (cron 0 */2 * * *)"],
		["0 9,17 * * 1-5", "every weekday at 09:00 and 17:00 (cron 0 9,17 * * 1-5)"],
		["30 8 * * MON", "every Monday at 08:30 (cron 30 8 * * MON)"],
		["0 0 1 * *", "on day 1 of every month at 00:00 (cron 0 0 1 * *)"],
		["0 0 1 1 *", "on January 1 at 00:00 (cron 0 0 1 1 *)"],
		["0 12 * * 0,6", "every Saturday and Sunday at 12:00 (cron 0 12 * * 0,6)"],
		["*/10 9-17 * * 1-5", "every 10 minutes from 09:00 to 17:59 on weekdays (cron */10 9-17 * * 1-5)"],
		["*/30 * * * * *", "every 30 seconds (cron */30 * * * * *)"],
		["@daily", "every day at 00:00 (cron @daily)"],
		["@hourly", "every hour, on the hour (cron @hourly)"],
		["5 4 L * *", "on the cron schedule 5 4 L * *"],
	])("%s", (pattern, words) => {
		expect(schedule(pattern)).toBe(words);
	});

	test("time zones show when the schedule has a clock time", () => {
		expect(schedule("0 9 * * *", "America/New_York")).toBe("every day at 09:00 America/New_York time (cron 0 9 * * *)");
		expect(schedule("*/5 * * * *", "UTC")).toBe("every 5 minutes (cron */5 * * * *)");
	});
});

describe("durations", () => {
	test("ms-style strings", () => {
		expect(parseDuration("1d")).toEqual([{ n: 1, unit: "day" }]);
		expect(parseDuration("1h30m")).toEqual([
			{ n: 1, unit: "hour" },
			{ n: 30, unit: "minute" },
		]);
		expect(parseDuration("30 seconds")).toEqual([{ n: 30, unit: "second" }]);
		expect(parseDuration("soon")).toBeNull();
	});
});
