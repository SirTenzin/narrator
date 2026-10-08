// Tiny CDP helper: bun tools/cdp.ts <urlSubstring> <js-expression-or-@file> [navigateUrl]
const [match, exprArg, nav] = process.argv.slice(2);
const targets: any[] = await (await fetch("http://127.0.0.1:61889/json")).json();
const t = targets.find((x) => x.type === "page" && x.url.includes(match!)) ?? targets.find((x) => x.type === "page" && x.url.startsWith("https://github.com"));
if (!t) throw new Error("no target");
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const pending = new Map<number, (v: any) => void>();
ws.onmessage = (m) => {
	const d = JSON.parse(String(m.data));
	if (d.id && pending.has(d.id)) pending.get(d.id)!(d);
};
await new Promise((r) => (ws.onopen = r));
const send = (method: string, params: any = {}) =>
	new Promise<any>((res) => {
		const i = ++id;
		pending.set(i, res);
		ws.send(JSON.stringify({ id: i, method, params }));
	});
if (nav) {
	await send("Page.navigate", { url: nav });
	await Bun.sleep(6000);
}
const expr = exprArg!.startsWith("@") ? await Bun.file(exprArg!.slice(1)).text() : exprArg!;
const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
console.log(typeof r.result?.result?.value === "string" ? r.result.result.value : JSON.stringify(r.result ?? r, null, 1));
ws.close();
