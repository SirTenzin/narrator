// Renders the designed store and docs images from store/marketing/*.html with the Chromium on port 61889: bun store/marketing.ts
// Carousel slides need the 2x captures from `bun store/screenshots.ts --raw` first.
import { pageSession } from "./cdp";

const dir = import.meta.dir;
const SLIDES = ["1-plain-english", "2-split-view", "3-libraries", "4-toggle", "5-private"];
const JOBS = [
	...SLIDES.flatMap((s) => [
		{ html: s, width: 1280, height: 800, scale: 1, out: `${dir}/assets/carousel/${s}.png` },
		{ html: s, width: 1280, height: 800, scale: 2, out: `${dir}/assets/carousel-2x/${s}.png` },
	]),
	{ html: "tile-small", width: 440, height: 280, scale: 1, out: `${dir}/assets/promo-small-440x280.png` },
	{ html: "tile-marquee", width: 1400, height: 560, scale: 1, out: `${dir}/assets/promo-marquee-1400x560.png` },
	{ html: "og", width: 1200, height: 630, scale: 1, out: `${dir}/../../../docs/images/og.png` },
];

await Bun.$`mkdir -p ${dir}/assets/carousel ${dir}/assets/carousel-2x`;
for (const job of JOBS) {
	const page = await pageSession(job);
	await page.send("Page.navigate", { url: `file://${dir}/marketing/${job.html}.html` });
	await Bun.sleep(1200);
	await page.evaluate("document.fonts.ready.then(() => true)");
	await Bun.sleep(300);
	await page.screenshot(job.out);
	await page.send("Emulation.clearDeviceMetricsOverride");
	page.close();
	console.log(`wrote ${job.out}`);
}
