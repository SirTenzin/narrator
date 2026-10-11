// Loads the unpacked extension into a Chrome started with --enable-unsafe-extension-debugging (branded Chrome ignores --load-extension).
const path = process.argv[2] ?? "/home/user/narrator-extension";
const { webSocketDebuggerUrl } = (await (await fetch("http://127.0.0.1:61889/json/version")).json()) as { webSocketDebuggerUrl: string };
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
ws.send(JSON.stringify({ id: 1, method: "Extensions.loadUnpacked", params: { path } }));
const reply = await new Promise<string>((r) => ws.addEventListener("message", (m) => r(String(m.data))));
console.log(reply);
ws.close();
