// Renders the promo tiles in store/tiles/ to PNG with the same Chromium the screenshots use: bun store/tiles.ts
import { pageSession } from "./cdp";

const TILES = [
	{ html: "small.html", width: 440, height: 280, out: "promo-small-440x280.png" },
	{ html: "marquee.html", width: 1400, height: 560, out: "promo-marquee-1400x560.png" },
];

for (const tile of TILES) {
	const page = await pageSession(tile);
	await page.send("Page.navigate", { url: `file://${import.meta.dir}/tiles/${tile.html}` });
	await Bun.sleep(1500);
	await page.screenshot(`${import.meta.dir}/assets/${tile.out}`);
	await page.send("Emulation.clearDeviceMetricsOverride");
	page.close();
	console.log(`wrote store/assets/${tile.out}`);
}
