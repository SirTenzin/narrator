// Retakes the five 1280x800 store screenshots on real public pull requests. Start Chromium first:
//   chromium --remote-debugging-port=61889 --enable-unsafe-extension-debugging --user-data-dir=<profile> --no-first-run about:blank
//   bun store/screenshots.ts [unpacked extension dir, default chrome/dist]
// Each pull request costs a few anonymous GitHub API requests, well inside the 60 an hour limit.
import { browserSession, pageSession } from "./cdp";

// `--raw` captures at 2x into assets/raw for the designed carousel slides (bun store/marketing.ts).
const raw = process.argv.includes("--raw");
const OUT = raw ? `${import.meta.dir}/assets/raw` : `${import.meta.dir}/assets/screenshots`;
const extensionDir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? `${import.meta.dir}/../chrome/dist`;

const REACT_DRIZZLE = "https://github.com/openstatusHQ/openstatus/pull/2860/files?diff=unified";
const HONO = "https://github.com/openstatusHQ/openstatus/pull/2888/files";

const browser = await browserSession();
const loaded = await browser.send("Extensions.loadUnpacked", { path: extensionDir });
browser.close();
const extensionId = loaded.result?.id as string | undefined;
if (!extensionId) throw new Error(`couldn't load the extension: ${loaded.error?.message}`);

await Bun.$`mkdir -p ${OUT}`;
const page = await pageSession({ width: 1280, height: 800, scale: raw ? 2 : 1 });

/** Navigates and waits until the extension has rendered its English, or gives up after 30 seconds. */
async function open(url: string) {
	await page.send("Page.navigate", { url });
	const started = Date.now();
	while (Date.now() - started < 30_000) {
		await Bun.sleep(1000);
		const ready = await page.evaluate(
			`!!document.querySelector("[class^='pe-'], [class*=' pe-']") && !document.body.innerText.includes("is reading this change")`,
		);
		if (ready) break;
	}
	await Bun.sleep(1500);
}

/** Scrolls so the visible header for `path` sits `offset` px below the top of the viewport. */
const scrollToFile = (path: string, offset: number) =>
	page.evaluate(`(() => {
		const header = [...document.querySelectorAll("h3, [class*=FileName], [class*=file-name], a[href*=diff-]")]
			.find((e) => e.textContent.replace(/[^\\x20-\\x7e]/g, "").trim() === ${JSON.stringify(path)} && e.getBoundingClientRect().height > 0);
		if (!header) throw new Error("no header for ${path}");
		window.scrollTo({ top: header.getBoundingClientRect().top + window.scrollY - ${offset}, behavior: "instant" });
	})()`);

async function shoot(name: string) {
	await Bun.sleep(800);
	await page.screenshot(`${OUT}/${name}.png`);
	console.log(`wrote ${OUT}/${name}.png`);
}

await open(REACT_DRIZZLE);
await scrollToFile("apps/dashboard/src/components/incidents/incident-status-report.tsx", 135);
await shoot("1-react-unified");
await scrollToFile("packages/services/src/incident/list.ts", 70);
await shoot("3-drizzle-unified");

await open(`${HONO}?diff=split`);
await scrollToFile("apps/server/src/libs/middlewares/track.ts", -140);
await shoot("2-hono-split");

await open(`${HONO}?diff=unified`);
await page.evaluate(`document.querySelector("summary:has(svg[aria-label='Diff settings'])").click()`);
await shoot("4-toggle");

await page.send("Page.navigate", { url: `chrome-extension://${extensionId}/options.html` });
await Bun.sleep(1500);
await page.evaluate(`document.getElementById("save").click(); document.documentElement.style.zoom = "1.6"; document.body.style.paddingTop = "40px"`);
await Bun.sleep(2000);
await shoot("5-options");

await page.send("Emulation.clearDeviceMetricsOverride");
page.close();
