import { narrate } from "./engine";
import type { EngineMessage, NarrateJob } from "./protocol";

const post = (id: number, msg: EngineMessage) => self.postMessage({ id, msg });

self.addEventListener("message", async ({ data }: MessageEvent<{ id: number; job: NarrateJob }>) => {
	try {
		post(data.id, { type: "done", ok: true, result: await narrate(data.job, (text) => post(data.id, { type: "progress", text })) });
	} catch (err) {
		post(data.id, { type: "done", ok: false, error: err instanceof Error ? err.message : String(err) });
	}
});
