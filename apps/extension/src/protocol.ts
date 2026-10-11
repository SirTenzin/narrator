import type { ChangedFile, FileJson } from "@usenarrator/core";

export type DiffRequest = { kind: "pull"; owner: string; repo: string; number: string } | { kind: "commit"; owner: string; repo: string; sha: string };
/** GitHub requests one report cost: `api` counts against the rate limit, `raw` (raw.githubusercontent.com) doesn't. */
export type RequestCount = { api: number; raw: number };
export type DiffReport = {
	title: string;
	subtitle: string;
	url: string;
	base: string;
	head: string;
	skipped: number;
	files: FileJson[];
	requests: RequestCount;
	plugins: string[];
};

/** Content script -> background port messages. */
export type ContentMessage = { type: "progress"; text: string } | { type: "done"; ok: true; report: DiffReport } | { type: "done"; ok: false; error: string };

/** What the engine needs to narrate a change; everything GitHub-side is already fetched. `manifests` is path -> text. */
export type NarrateJob = { owner: string; files: ChangedFile[]; manifests: [string, string][]; wasmUrl: string };
export type NarrateResult = { files: FileJson[]; plugins: string[] };

/** Background <-> engine host (offscreen document / worker) messages. */
export type EngineMessage = { type: "progress"; text: string } | { type: "done"; ok: true; result: NarrateResult } | { type: "done"; ok: false; error: string };

export const PORT_CONTENT = "plain-english";
export const PORT_ENGINE = "plain-english-engine";
