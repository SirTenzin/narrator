// Renders the Narrator mark (docs/logo/light.svg: a dark rounded square with a prompt chevron and two text lines) to PNG.
// Dependency-free: signed distance fields for antialiasing and a minimal PNG encoder, so the output is byte-identical everywhere.
import { mkdir } from "node:fs/promises";
import { deflateSync } from "node:zlib";

type Vec = [number, number];
type Vec3 = [number, number, number];

const DARK: Vec3 = [0x0a, 0x0a, 0x0a];
const LIGHT: Vec3 = [0xff, 0xff, 0xff];

/** The glyph in the logo's 24-unit space, with the logo's 1-unit vertical offset removed. */
const STROKE = 1.9;
const SEGMENTS: [Vec, Vec][] = [
	[
		[7, 8],
		[10.5, 12],
	],
	[
		[10.5, 12],
		[7, 16],
	],
	[
		[13, 9],
		[17.5, 9],
	],
	[
		[13, 15],
		[16, 15],
	],
];

function segmentDistance([px, py]: Vec, [[ax, ay], [bx, by]]: [Vec, Vec]) {
	const [dx, dy] = [bx - ax, by - ay];
	const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function roundedSquareDistance([px, py]: Vec, size: number, radius: number) {
	const half = size / 2;
	const qx = Math.abs(px - half) - (half - radius);
	const qy = Math.abs(py - half) - (half - radius);
	return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

const coverage = (distancePx: number) => Math.max(0, Math.min(1, 0.5 - distancePx));

/** RGBA pixels for the mark at `size`, drawn into an `art`-sized square centred in the canvas. */
export function renderMark({ size, art, glow = false }: { size: number; art: number; glow?: boolean }): Uint8Array {
	const pixels = new Uint8Array(size * size * 4);
	const scale = art / 24;
	const offset = (size - art) / 2;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const p: Vec = [(x + 0.5 - offset) / scale, (y + 0.5 - offset) / scale];
			const squareDist = roundedSquareDistance(p, 24, 6) * scale;
			const square = coverage(squareDist);
			const glyph = coverage((Math.min(...SEGMENTS.map((s) => segmentDistance(p, s))) - STROKE / 2) * scale);
			const halo = glow && squareDist > 0 ? 0.3 * Math.max(0, 1 - squareDist / (size / 40)) : 0;
			const i = (y * size + x) * 4;
			const alpha = square + halo * (1 - square);
			for (let c = 0; c < 3; c++) {
				const inside = DARK[c]! + (LIGHT[c]! - DARK[c]!) * glyph;
				pixels[i + c] = alpha ? Math.round((inside * square + LIGHT[c]! * halo * (1 - square)) / alpha) : 0;
			}
			pixels[i + 3] = Math.round(alpha * 255);
		}
	}
	return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(bytes: Uint8Array) {
	let c = 0xffffffff;
	for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(new TextEncoder().encode(type), 4);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

export function encodePng({ width, height, rgba }: { width: number; height: number; rgba: Uint8Array }): Uint8Array {
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header.set([8, 6, 0, 0, 0], 8);
	const rows = new Uint8Array(height * (width * 4 + 1));
	for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
	const parts = [
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(rows, { level: 9 })),
		chunk("IEND", new Uint8Array()),
	];
	return new Uint8Array(Buffer.concat(parts));
}

/** Toolbar sizes fill the canvas; 48 and 128 keep the padding Chrome's icon guidelines ask for (96px art at 128). */
const EXTENSION_ICONS = [
	{ size: 16, art: 16 },
	{ size: 32, art: 30 },
	{ size: 48, art: 40 },
	{ size: 128, art: 96, glow: true },
];

/** Store-only sizes: Edge's 300x300 logo and a 1024 square for an App Store record. */
const STORE_ICONS = [
	{ size: 300, art: 300, name: "logo-300.png" },
	{ size: 1024, art: 1024, name: "logo-1024.png" },
];

if (import.meta.main) {
	const root = `${import.meta.dir}/..`;
	await mkdir(`${root}/icons`, { recursive: true });
	await mkdir(`${import.meta.dir}/assets`, { recursive: true });
	for (const icon of EXTENSION_ICONS) {
		const png = encodePng({ width: icon.size, height: icon.size, rgba: renderMark(icon) });
		await Bun.write(`${root}/icons/icon${icon.size}.png`, png);
	}
	for (const icon of STORE_ICONS) {
		await Bun.write(`${import.meta.dir}/assets/${icon.name}`, encodePng({ width: icon.size, height: icon.size, rgba: renderMark(icon) }));
	}
	console.log("wrote apps/extension/icons/icon{16,32,48,128}.png and store/assets/logo-{300,1024}.png");
}
