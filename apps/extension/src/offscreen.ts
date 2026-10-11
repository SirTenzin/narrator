import type { EngineMessage, NarrateJob } from "./protocol";
import { PORT_ENGINE } from "./protocol";

/** Relays background jobs to the module worker; offscreen documents only get `chrome.runtime`. */
const worker = new Worker(chrome.runtime.getURL("worker.js"), { type: "module" });
const ports = new Map<number, chrome.runtime.Port>();
let nextId = 0;

worker.addEventListener("message", ({ data }: MessageEvent<{ id: number; msg: EngineMessage }>) => {
	const port = ports.get(data.id);
	if (!port) return;
	if (data.msg.type === "done") ports.delete(data.id);
	try {
		port.postMessage(data.msg);
	} catch {}
});

chrome.runtime.onConnect.addListener((port) => {
	if (port.name !== PORT_ENGINE) return;
	port.onMessage.addListener((job: NarrateJob) => {
		const id = nextId++;
		ports.set(id, port);
		port.onDisconnect.addListener(() => ports.delete(id));
		worker.postMessage({ id, job });
	});
});
