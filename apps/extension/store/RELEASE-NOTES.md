Narrator for GitHub reads pull requests and commits in plain English, right inside GitHub's diff view. The English comes from the code's syntax tree with rules, not AI, so the same code always reads the same way, and nothing leaves your browser except requests to GitHub.

## Install

The extension is waiting for review in the browser stores. Until then, download the file for your browser below and follow the [install guide](https://narrator.ami.rip/guides/browser-extension#install-it).

| Browser | Download |
| --- | --- |
| Chrome, Arc, Edge, Brave | `narrator-for-github-chromium.zip`: unzip it and use **Load unpacked** on the extensions page. |
| Firefox 140+ | `narrator-for-github-firefox.zip`: load it from `about:debugging` as a temporary add-on. |
| Safari on macOS | `narrator-for-github-safari.zip`: unzip, open Narrator.app once, and enable it in Safari's settings (unsigned for now). |

## What's in 1.0.0

- English for every TypeScript and JavaScript file in a pull request or commit, in unified and split view, with changed words highlighted and moved or renamed functions labelled.
- A **Narrator (English)** switch in GitHub's own diff settings menu, plus an options page.
- Built-in knowledge of 26 libraries, including React, Next.js, Drizzle, Prisma, SQL, Hono, Express, tRPC, zod, Stripe, Effect and the AI SDK. Each one only loads when your repository depends on it.
- Private repositories and a higher rate limit with an optional GitHub token, which stays in your browser.
