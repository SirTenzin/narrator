import type { ChangedFile } from "@usenarrator/core";
import { type Change, fetchManifests, fetchSources, github, loadChange, narratableFiles } from "./github";
import {
	type ContentMessage,
	type DiffReport,
	type DiffRequest,
	type EngineMessage,
	type NarrateJob,
	type NarrateResult,
	PORT_CONTENT,
	PORT_ENGINE,
} from "./protocol";
import { getSettings } from "./settings";

const reports = new Map<string, DiffReport>();

/** Chrome's service worker can't `import()`, so narration runs in a worker owned by an offscreen document. */
let offscreenReady: Promise<void> | null = null;
async function ensureOffscreen() {
	const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
	if (contexts.length) return;
	offscreenReady ??= chrome.offscreen
		.createDocument({
			url: "offscreen.html",
			reasons: [chrome.offscreen.Reason.WORKERS],
			justification: "Narrates diffs in a module worker, which can load the parser and plugins on demand.",
		})
		.finally(() => {
			offscreenReady = null;
		});
	await offscreenReady;
}

function narrateOffscreen(job: NarrateJob, progress: (t: string) => void): Promise<NarrateResult> {
	return new Promise((resolve, reject) => {
		const port = chrome.runtime.connect({ name: PORT_ENGINE });
		let settled = false;
		port.onMessage.addListener((msg: EngineMessage) => {
			if (msg.type === "progress") return progress(msg.text);
			settled = true;
			port.disconnect();
			if (msg.ok) resolve(msg.result);
			else reject(new Error(msg.error));
		});
		port.onDisconnect.addListener(() => {
			if (!settled) reject(new Error("The narration worker stopped unexpectedly."));
		});
		port.postMessage(job);
	});
}

const narrateHere = async (job: NarrateJob, progress: (t: string) => void) => (await import("./engine")).narrate(job, progress);

/** Firefox's background is an event page, where `import()` works; the Firefox build drops the offscreen path entirely. */
const narrate =
	process.env.BROWSER === "firefox"
		? narrateHere
		: async (job: NarrateJob, progress: (t: string) => void): Promise<NarrateResult> => {
				if (!chrome.offscreen) return narrateHere(job, progress);
				await ensureOffscreen();
				return narrateOffscreen(job, progress);
			};

const reportKey = (req: DiffRequest, change: Pick<Change, "head">) =>
	req.kind === "pull" ? `pull:${req.owner}/${req.repo}#${req.number}@${change.head}` : `commit:${req.owner}/${req.repo}@${req.sha}`;

async function buildReport(req: DiffRequest, progress: (t: string) => void): Promise<DiffReport> {
	const { owner, repo } = req;
	const gh = github({ token: (await getSettings()).githubToken });
	progress(`Asking GitHub for the ${req.kind === "pull" ? "pull request" : "commit"}…`);
	const loaded = await loadChange({ gh, req, cached: (head) => reports.get(reportKey(req, { head })) });
	if ("report" in loaded) return loaded.report;
	const { change } = loaded;
	const key = reportKey(req, change);

	const files = narratableFiles(change.files);
	if (!files.length) return { ...change, skipped: change.files.length, files: [], requests: { ...gh.count }, plugins: [] };
	progress(`Fetching ${files.length} file${files.length === 1 ? "" : "s"} and their package.json…`);
	const [sources, manifests]: [ChangedFile[], [string, string][]] = await Promise.all([
		fetchSources({ gh, owner, repo, change, files, progress }),
		fetchManifests({ gh, owner, repo, sha: change.head, paths: files.flatMap((f) => [f.filename, ...(f.previous_filename ? [f.previous_filename] : [])]) }),
	]);
	const { files: narrated, plugins } = await narrate({ owner, files: sources, manifests, wasmUrl: chrome.runtime.getURL("oxc_parser_wasm_bg.wasm") }, progress);
	const report: DiffReport = {
		title: change.title,
		subtitle: change.subtitle,
		url: change.url,
		base: change.base,
		head: change.head,
		skipped: change.files.length - files.length,
		files: narrated,
		requests: { ...gh.count },
		plugins,
	};
	reports.set(key, report);
	return report;
}

chrome.runtime.onConnect.addListener((port) => {
	if (port.name !== PORT_CONTENT) return;
	port.onMessage.addListener(async (req: DiffRequest) => {
		const send = (msg: ContentMessage) => {
			try {
				port.postMessage(msg);
			} catch {}
		};
		try {
			send({ type: "done", ok: true, report: await buildReport(req, (text) => send({ type: "progress", text })) });
		} catch (err) {
			send({ type: "done", ok: false, error: err instanceof Error ? err.message : String(err) });
		}
	});
});
