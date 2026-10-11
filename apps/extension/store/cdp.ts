// Minimal Chrome DevTools Protocol client for the store scripts; Chromium must be listening on port 61889.
export const CDP = "http://127.0.0.1:61889";

export type Session = {
	send: (method: string, params?: Record<string, unknown>) => Promise<{ result?: any; error?: { message: string } }>;
	evaluate: (expression: string) => Promise<unknown>;
	screenshot: (path: string) => Promise<void>;
	close: () => void;
};

async function connect(wsUrl: string): Promise<Session> {
	const ws = new WebSocket(wsUrl);
	const pending = new Map<number, (v: any) => void>();
	let id = 0;
	ws.onmessage = (m) => {
		const d = JSON.parse(String(m.data));
		pending.get(d.id)?.(d);
	};
	await new Promise((r) => (ws.onopen = r));
	const send: Session["send"] = (method, params = {}) =>
		new Promise((res) => {
			const i = ++id;
			pending.set(i, res);
			ws.send(JSON.stringify({ id: i, method, params }));
		});
	return {
		send,
		evaluate: async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value,
		screenshot: async (path) => {
			const { result } = await send("Page.captureScreenshot", { format: "png" });
			await Bun.write(path, Buffer.from(result.data, "base64"));
		},
		close: () => ws.close(),
	};
}

export async function browserSession() {
	const { webSocketDebuggerUrl } = (await (await fetch(`${CDP}/json/version`)).json()) as { webSocketDebuggerUrl: string };
	return connect(webSocketDebuggerUrl);
}

/** The first open tab, with its viewport pinned to `width` x `height` CSS pixels at `scale` device pixels each. */
export async function pageSession({ width, height, scale = 1 }: { width: number; height: number; scale?: number }) {
	const targets = (await (await fetch(`${CDP}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
	const target = targets.find((t) => t.type === "page");
	if (!target) throw new Error("no open tab to drive");
	const page = await connect(target.webSocketDebuggerUrl);
	await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
	return page;
}
