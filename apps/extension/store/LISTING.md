# Listing copy

Everything here is ready to paste. The same text works in every store unless a section says otherwise. None of it contains em dashes, because some dashboards turn them into odd characters.

## Name

Narrator for GitHub

## Short description (manifest, 129 of 132 characters)

Read GitHub pull requests and commits as plain English, generated deterministically from the code. No AI, no servers but GitHub.

Chrome and Edge take this from `manifest.json` and don't let you edit it in the dashboard. AMO calls it the summary (250 character limit) and prefills it from the manifest too.

## Long description

Narrator for GitHub turns the code in a pull request or commit into plain English, right inside GitHub's diff view.

Open the Files changed tab of any pull request, or any commit page, and the TypeScript and JavaScript rows are replaced with sentences that say what the code does. Removed sentences show in red and added ones in green, and when only part of a sentence changed, the changed words are highlighted. It follows GitHub's unified or split setting, and you can switch it off from GitHub's own diff settings menu.

The English is generated from the code's syntax tree, so the same code always reads the same way. There is no AI model involved and nothing is guessed.

It understands the libraries your code uses. Narrator reads the repository's package.json files and loads plugins for what it finds, including React, Next.js, Hono, Express, Fastify, Elysia, Drizzle, Prisma, Kysely, Zod, Valibot, tRPC, TanStack Query, Stripe, Effect, BullMQ and Temporal. A Drizzle query reads as the rows it picks and the conditions they must meet, and a React component reads as the state it keeps and what happens when a mutation succeeds or fails.

Private repositories and higher limits. Without a token the extension reads public repositories, using GitHub's anonymous allowance of 60 requests an hour. Add a fine-grained GitHub token with read-only access on the options page to read private repositories and raise the limit to 5,000 an hour.

Privacy. Everything runs inside your browser. The extension only talks to api.github.com and raw.githubusercontent.com to fetch the change you are looking at. It has no server of its own, no analytics and no tracking. Your token stays in the browser's extension storage and is only sent to GitHub.

Narrator is open source under the MIT licence: https://github.com/SirTenzin/narrator

## Single purpose (Chrome, Edge)

Narrator for GitHub has one purpose: it shows the code changes in GitHub pull requests and commits as plain English sentences, inside GitHub's own diff view on github.com.

## Permission justifications (Chrome, Edge)

**storage**
Saves the user's two settings, whether Plain English is on and an optional GitHub token, in chrome.storage.local. It also caches the package.json files of the repository being viewed in chrome.storage.session, so returning to a pull request doesn't fetch them again.

**offscreen**
Chrome's extension service worker can't load code on demand. The extension creates one offscreen document with the WORKERS reason, which owns a module worker. The WebAssembly parser, and only the plugins a repository needs, are loaded in that worker to turn the diff into English. The document has no UI and nothing else runs in it.

**Host permission: https://api.github.com/***
Reads the pull request or commit the user is viewing: its title, the commits to compare, the list of changed files and the repository's file tree (to find package.json files). With the user's optional token it can read private repositories the user already has access to.

**Host permission: https://raw.githubusercontent.com/***
Downloads the old and new version of each changed TypeScript or JavaScript file, and the package.json files that say which libraries the code uses. These downloads don't count against GitHub's API rate limit.

**Content script on https://github.com/*** (shown with the host permissions)
Adds the English rows to GitHub's diff table on pull request and commit pages, and adds the Plain English switch to GitHub's diff settings menu. It reads the page address to know which pull request or commit is open, and does nothing on other GitHub pages.

## Remote code (Chrome, Edge)

Answer: **No, I am not using remote code.**

Justification if a field is shown: All JavaScript and the WebAssembly parser ship inside the package. The extension fetches source files from GitHub as data to read, never to run. The CSP allows 'wasm-unsafe-eval' only so the bundled WebAssembly parser can compile.

## Data usage (Chrome, Edge)

Tick these two data types, because the store asks you to disclose data an extension handles even when it never leaves the browser:

- **Authentication information**: the optional GitHub token the user types on the options page. It is stored locally and sent only to GitHub.
- **Website content**: the code of the pull request or commit being viewed, which the extension reads from GitHub to turn into English.

Leave every other type unticked (personally identifiable information, health, financial and payment, personal communications, location, web history, user activity).

Tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Firefox data collection

`manifest.json` declares `data_collection_permissions: { required: ["none"] }`, and Firefox shows "This extension doesn't collect data" at install. That is accurate under Mozilla's definition, because nothing is transmitted to the developer or any third party: the only requests are to GitHub, for the page the user is already viewing on GitHub. If a reviewer asks for a change, the fallback is `required: ["websiteContent"]` with `optional: ["authenticationInfo"]` in a 1.0.1 build. The reviewer note below explains this up front.

## Privacy policy URL

Use the docs page once the docs site is deployed: `<docs site>/privacy` (source: `docs/privacy.mdx`).
Until then, use the copy in the repository: https://github.com/SirTenzin/narrator/blob/main/apps/extension/store/PRIVACY.md (the repository must be public for this link to work).

## Category

- Chrome Web Store: Developer Tools (in the Productivity group)
- Edge Add-ons: Developer tools
- AMO: Web Development (Firefox), and leave Firefox for Android unticked
- App Store: Developer Tools (primary), Productivity (secondary)

## Links

- Homepage / website: https://github.com/SirTenzin/narrator
- Support: https://github.com/SirTenzin/narrator/issues

## Edge search terms (up to 7)

github, pull request, code review, diff, plain english, typescript, javascript

## Notes for reviewers (AMO "Notes to Reviewer", Edge "Notes for certification", Chrome "Test instructions")

Narrator for GitHub needs no account. To test it, open any public pull request's changed files on github.com, for example https://github.com/openstatusHQ/openstatus/pull/2860/files. After a few seconds the TypeScript and JavaScript rows are shown as English. The gear icon above the diff has a Plain English switch to turn it off and on, and the extension's options page has the same switch and an optional GitHub token field. Without a token GitHub allows 60 API requests an hour per IP address; each pull request uses about three.

The extension only makes requests to api.github.com and raw.githubusercontent.com, for the pull request or commit being viewed. It has no server of its own, no analytics and no remote code. The JavaScript is bundled and minified with Bun's bundler; the full source is open at https://github.com/SirTenzin/narrator, and for AMO a source archive with build instructions (README-AMO.md) is attached to this version.

For AMO only: the manifest declares no data collection because the extension transmits nothing to us or any third party. It only fetches the code of the pull request the user is viewing, from GitHub, and an optional token the user enters is sent only to GitHub.

## App Store (Safari) fields

- Name: Narrator for GitHub
- Subtitle (30 characters max): Pull requests in plain English
- Promotional text (170 max): Read GitHub pull requests and commits as plain English, right in Safari. Generated from the code itself, with no AI and no servers besides GitHub.
- Keywords (100 max): github,pull request,code review,diff,typescript,javascript,developer,english,safari extension
- Description: the long description above.
- Support URL: https://github.com/SirTenzin/narrator/issues
- Marketing URL: https://github.com/SirTenzin/narrator
- Privacy policy URL: as above.
- App Privacy: Data Not Collected.
- Age rating: answer None to every question (4+).
- Price: Free.
- Copyright: 2026 Narrator contributors
- Screenshots (Mac): the five 1280x800 PNGs in `assets/screenshots/` are an accepted Mac size.
