import { getSettings, onSettingsChanged, saveSettings } from "./settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const enabled = $<HTMLInputElement>("enabled");
const token = $<HTMLInputElement>("token");
const status = $<HTMLParagraphElement>("status");

const say = (text: string, tone: "ok" | "err" | "" = "") => {
	status.textContent = text;
	status.className = `note ${tone}`;
};

/** `/rate_limit` doesn't count against the limit, so it's a free way to check a token. */
async function describeLimit(value: string): Promise<{ ok: boolean; text: string }> {
	const res = await fetch("https://api.github.com/rate_limit", {
		headers: { Accept: "application/vnd.github+json", ...(value ? { Authorization: `Bearer ${value}` } : {}) },
	}).catch(() => null);
	if (!res) return { ok: false, text: "Couldn't reach GitHub to check the token." };
	if (res.status === 401) return { ok: false, text: "GitHub rejected this token. Check it was copied in full and hasn't expired." };
	if (!res.ok) return { ok: false, text: `GitHub answered ${res.status} when checking the token.` };
	const { rate } = (await res.json()) as { rate: { limit: number; remaining: number } };
	const left = `${rate.remaining.toLocaleString("en")} of ${rate.limit.toLocaleString("en")} requests left this hour`;
	return { ok: true, text: value ? `Token saved. ${left}.` : `No token: ${left}.` };
}

async function init() {
	const settings = await getSettings();
	enabled.checked = settings.enabled;
	token.value = settings.githubToken;
	if (settings.githubToken) say("A token is saved.");
	onSettingsChanged((patch) => {
		if (patch.enabled !== undefined) enabled.checked = patch.enabled;
	});
}

enabled.addEventListener("change", () => saveSettings({ enabled: enabled.checked }));

$("save").addEventListener("click", async () => {
	const value = token.value.trim();
	say("Checking with GitHub…");
	const check = await describeLimit(value);
	if (!check.ok) return say(check.text, "err");
	await saveSettings({ githubToken: value });
	say(check.text, "ok");
});

$("clear").addEventListener("click", async () => {
	token.value = "";
	await saveSettings({ githubToken: "" });
	say("Token removed.", "ok");
});

void init();
