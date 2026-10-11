# Store submission kit

Everything needed to publish Narrator for GitHub to the Chrome Web Store, Firefox Add-ons (AMO), Microsoft Edge Add-ons and the Safari App Store. The step-by-step launch plan is in [LAUNCH.md](LAUNCH.md), and every piece of text to paste into a dashboard is in [LISTING.md](LISTING.md).

| File | What it is |
| --- | --- |
| `LAUNCH.md` | One checklist per store, with click paths, timings and same-day fallbacks |
| `LISTING.md` | Names, descriptions, single purpose, permission justifications, data usage answers, reviewer notes |
| `PRIVACY.md` | The privacy policy (also published as `docs/privacy.mdx`) |
| `AMO-SOURCE.md` | Build instructions that go into the AMO source archive as `README-AMO.md` |
| `assets/` | Store icon sizes, promo tiles and the five screenshots |
| `package.ts` | Builds the extension and writes the upload zips to `out/` |
| `icons.ts` | Draws the icon at every size from the docs logo geometry |
| `screenshots.ts`, `tiles.ts`, `tiles/` | Retake the screenshots and re-render the promo tiles in Chromium |

## Build the packages

From `apps/extension`:

```bash
bun run package:chrome    # out/narrator-for-github-1.0.0-chrome.zip
bun run package:edge      # out/narrator-for-github-1.0.0-edge.zip (same contents as Chrome)
bun run package:firefox   # out/narrator-for-github-1.0.0-firefox.zip and -source.zip for AMO
bun run package:safari    # out/narrator-for-github-1.0.0-safari.zip for App Store Connect's packager
```

`out/` is ignored by git. The source archive is made from the files git tracks, so commit first; the script warns when the working tree has uncommitted changes. The build pins its working directory, so the Firefox package rebuilt from the source archive is byte-identical to the uploaded one. That was checked by unzipping the archive into an empty folder, running `bun install --frozen-lockfile` and `bun apps/extension/build.ts`, and diffing the result against the uploaded zip.

`bunx web-ext lint -s firefox/dist` reports 0 errors, 0 warnings and 0 notices.

## Assets

| File | Size | Used by |
| --- | --- | --- |
| `../icons/icon{16,32,48,128}.png` | 16 to 128 | All stores, from the package. The 128 icon keeps the 96px artwork with 16px padding that Chrome asks for |
| `assets/logo-300.png` | 300x300 | Edge "Extension logo" |
| `assets/logo-1024.png` | 1024x1024 | App Store app icon, if the packager asks for one |
| `assets/promo-small-440x280.png` | 440x280 | Chrome small promo tile (required), Edge small tile |
| `assets/promo-marquee-1400x560.png` | 1400x560 | Chrome marquee tile, Edge large tile |
| `assets/screenshots/*.png` | 1280x800 | Chrome, Edge, AMO and Mac App Store screenshots, in file name order |

The screenshots are real public pull requests in the openstatus repository (Hono, Drizzle, React and tRPC), taken from the store build. To retake them, start Chromium with `--remote-debugging-port=61889 --enable-unsafe-extension-debugging`, then run `bun run store:screenshots` (optionally passing an unpacked build directory). `bun run store:tiles` re-renders the promo tiles and `bun run icons` redraws the icons.

## Version

The first store release is **1.0.0**. The extension's version is independent of the `@usenarrator/*` library versions, which follow semver for their APIs; an extension has no API, so its version only needs to go up with every release. The stores compare versions per listing and never accept a lower one, and anyone who side-loaded a 0.x development build (the manifest said 0.3.0) upgrades cleanly to 1.0.0. Starting at 1.0.0 also tells users this is the supported public release rather than a preview. Bump `manifest.json` (and `package.json`) for every upload, including each AMO unlisted build.

## What changed in the extension for the stores

- Name "Narrator for GitHub", a 129 character description, `homepage_url`, version 1.0.0.
- Icons at 16, 32, 48 and 128, drawn from the docs logo.
- `https://github.com/*` removed from `host_permissions`: the content script's `matches` already covers github.com, and nothing else fetches from it. The remaining permissions (`storage`, `offscreen`, `api.github.com`, `raw.githubusercontent.com`) are all used.
- An empty `web_accessible_resources` removed.
- Separate store builds. `chrome/dist` has only `background.service_worker` and no Firefox keys. `firefox/dist` has only `background.scripts`, no `offscreen` permission and no offscreen code. `dist` stays the universal development build that Safari also uses.
- The emnapi runtime under the WASM parser probes `new Function`, which `web-ext lint` flagged three times. The MV3 CSP blocks it anyway, so the build swaps it for a stub that throws. No `eval` or `Function` constructor ships in either store package.

## Store requirements (checked 11 October 2026)

### Chrome Web Store

- **Fee and account.** One-time registration fee of US$5, paid in the developer dashboard. 2-Step Verification on the Google account is required to publish. A contact email must be verified, and every developer declares whether they are a trader or non-trader under EU rules.
- **Listing.** Description, category and language; a 128x128 icon in the package; at least one screenshot at 1280x800 or 640x400 (up to five); a 440x280 small promo tile (required) and an optional 1400x560 marquee tile. Homepage and support URLs are optional.
- **Privacy tab.** A single purpose statement, a justification for every permission in the manifest, a remote code declaration, data usage disclosures with three certifications, and a privacy policy URL. Extensions must disclose data they handle even if it never leaves the device.
- **Manifest V3.** No remotely hosted code; the extension's full behaviour must be readable from its package. Minified code is allowed, obfuscated code is not.
- **Review time.** "For most extensions, review is completed within a few days, but it can take up to a few weeks." New developers, new extensions and sensitive permissions get a closer look. Contact support after three weeks. After approval you have 30 days to publish. Unlisted and private items go through the same review.

### Firefox Add-ons (AMO)

- **Fee and account.** No fee. AMO requires two-factor authentication on the Mozilla account of anyone who is a developer of an add-on.
- **Listing.** Name, summary (250 characters), description, categories, support email or website, licence, and an optional privacy policy; screenshots are optional.
- **Source code.** Required when code is minified or bundled. Upload an archive with the source, the lockfile and a README with the operating system, tool versions and exact build commands. Reviewers rebuild it and diff the result against the package, and "there must be no differences". Build tools must be open source and run locally. The default reviewer environment is Ubuntu 24.04 on ARM64 with Node 24 and npm 11, so anything else (here, Bun 1.3.14) must be stated. Obfuscation is never allowed.
- **Data collection.** Since 3 November 2025 every new extension must declare `browser_specific_settings.gecko.data_collection_permissions`, using `required: ["none"]` when it transmits nothing. Firefox 140 (desktop) and 142 (Android) show it at install.
- **Manifest V3.** Firefox runs MV3 background code as an event page (`background.scripts`), not a service worker. Since Firefox 127, `host_permissions` and content script matches are shown and granted at install, but users can revoke them later. An add-on ID in `browser_specific_settings.gecko.id` is required.
- **Review time.** Every upload goes through automated validation, and "it can take up to 24 hours for your submission to be signed and published, or longer if your submission is selected for manual review." In July 2026 Mozilla estimated the manual review queue at between 3 days and 3 weeks. Unlisted (self-distributed) versions go through the same automated signing, which often finishes within minutes and is allowed up to 24 hours.

### Microsoft Edge Add-ons

- **Fee and account.** No registration fee. A Partner Center account enrolled in the Edge program; individual accounts verify quickly, company accounts can take days to weeks.
- **Listing.** Description of 250 to 10,000 characters; a 1:1 logo (300x300 recommended, 128x128 minimum); optional 440x280 and 1400x560 tiles; up to six screenshots at 640x480 or 1280x800; up to seven search terms of 30 characters each. Name and short description come from the manifest and can't be edited in Partner Center.
- **Privacy.** The same fields as Chrome: single purpose, permission justifications, remote code, data usage certification and a privacy policy URL.
- **Review time.** "The certification process can take up to seven business days."

### Safari (App Store Connect)

- **Fee and account.** Apple Developer Program membership, US$99 a year. Enrollment includes identity verification.
- **Packaging without a Mac.** App Store Connect's Safari Web Extension Packager (Xcode Cloud tab) turns an uploaded extension into a macOS and iOS app, then TestFlight and App Review work as for any app. Packaging time comes out of the 25 Xcode Cloud hours a month included in the membership. On a Mac, `safari.sh` does the same with Xcode.
- **Listing.** App name, subtitle, description, keywords, support URL, privacy policy URL, age rating, price and App Privacy answers. Mac screenshots must be 16:10, and 1280x800 is accepted.
- **Review time.** "App Review works around the clock, typically reviewing at least 50% of submissions in less than 24 hours and 90% in less than 48 hours."

## Sources

Chrome Web Store
- Registration and fee: https://developer.chrome.com/docs/webstore/register and https://github.com/GoogleChrome/webstore-docs/blob/master/publish.md (the US$5 amount)
- Account setup and email verification: https://developer.chrome.com/docs/webstore/set-up-account
- 2-Step Verification: https://developer.chrome.com/docs/webstore/program-policies/two-step-verification
- Trader declaration: https://developer.chrome.com/docs/webstore/program-policies/trader-disclosure
- Images: https://developer.chrome.com/docs/webstore/images
- Listing tab: https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- Privacy tab: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- User data FAQ: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- MV3 code requirements: https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements
- Distribution and visibility: https://developer.chrome.com/docs/webstore/cws-dashboard-distribution
- Publishing: https://developer.chrome.com/docs/webstore/publish
- Review process and times: https://developer.chrome.com/docs/webstore/review-process

Firefox Add-ons
- Submitting an add-on: https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
- Source code submission: https://extensionworkshop.com/documentation/publish/source-code-submission/
- Built-in data consent: https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/ and https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/
- Add-on policies: https://extensionworkshop.com/documentation/publish/add-on-policies/
- Signing and distribution, review timing: https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- Self-distribution: https://extensionworkshop.com/documentation/publish/self-distribution/
- Manifest V3 in Firefox: https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/
- Two-factor authentication: https://blog.mozilla.org/addons/2021/03/11/two-factor-authentication-required-for-extension-developers/
- Manual review queue estimate (July 2026): https://discourse.mozilla.org/t/important-update-addressing-the-long-manual-review-times/148498

Microsoft Edge Add-ons
- Publishing, listing fields and certification time: https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension
- Developer account: https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account

Safari
- Packaging in App Store Connect: https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect
- Packaging on a Mac: https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari
- Enrollment and fee: https://developer.apple.com/programs/enroll/
- App Review times: https://developer.apple.com/distribute/app-review/
- App Privacy details: https://developer.apple.com/app-store/app-privacy-details/
- Screenshot sizes: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
