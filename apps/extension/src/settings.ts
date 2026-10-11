export type Settings = { enabled: boolean; githubToken: string };

const DEFAULTS: Settings = { enabled: true, githubToken: "" };

export async function getSettings(): Promise<Settings> {
	const stored = (await chrome.storage.local.get(Object.keys(DEFAULTS) as (keyof Settings)[])) as Partial<Settings>;
	return { ...DEFAULTS, ...stored };
}

export const saveSettings = (patch: Partial<Settings>) => chrome.storage.local.set(patch);

export function onSettingsChanged(fn: (patch: Partial<Settings>) => void) {
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== "local") return;
		const patch: Partial<Settings> = {};
		if ("enabled" in changes) patch.enabled = changes.enabled!.newValue !== false;
		if ("githubToken" in changes) patch.githubToken = String(changes.githubToken!.newValue ?? "");
		if (Object.keys(patch).length) fn(patch);
	});
}
