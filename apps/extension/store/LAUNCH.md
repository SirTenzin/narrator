# Launch checklist: Narrator for GitHub 1.0.0

Copy for every field is in [LISTING.md](LISTING.md); images are in `assets/`. Packages come from `apps/extension`:

```bash
bun install && bun run package:chrome && bun run package:edge && bun run package:firefox && bun run package:safari
```

## What can be live tomorrow (Monday 12 October)

| Channel | Live tomorrow? | Why |
| --- | --- | --- |
| GitHub release zip for Chrome, Edge, Brave, Arc (developer mode) | Yes, minutes | No review |
| Firefox, signed .xpi you host yourself (AMO unlisted) | Very likely | Automated signing, up to 24 hours, usually much faster |
| Firefox, public AMO listing | Likely | Published after automated review; a manual review can come later or hold it for days |
| Chrome Web Store | Unlikely | New developer and new item: "a few days", up to a few weeks |
| Edge Add-ons | No | Certification takes up to 7 business days |
| Safari App Store | No | Needs a paid Apple developer account, a TestFlight check and App Review (most within 48 hours) |

Submit every store tonight so the review clocks start, and announce with the GitHub release and AMO links.

## Before you start (all stores)

- [ ] The repository https://github.com/SirTenzin/narrator is public. The manifest's homepage, the support link and the fallback privacy URL all point at it.
- [ ] The privacy policy is reachable at a public URL: the docs site's `/privacy` page once deployed, or `apps/extension/store/PRIVACY.md` on GitHub.
- [ ] Everything is committed, then the four `package:*` commands above have been run. `out/` holds the chrome, edge, firefox, source and safari zips.

## Chrome Web Store

1. Go to https://chrome.google.com/webstore/devconsole and sign in with the Google account that will own the listing. It needs 2-Step Verification turned on.
2. First time only: accept the developer agreement, pay the US$5 fee, then in **Account** set the publisher name, verify the contact email and answer the trader or non-trader question (non-trader if this isn't a business).
3. Click **New item** and upload `out/narrator-for-github-1.0.0-chrome.zip`.
4. **Store listing** tab:
   - Description: "Long description" from LISTING.md.
   - Category: Developer Tools. Language: English.
   - Store icon: `apps/extension/icons/icon128.png`.
   - Screenshots: the five designed slides in `assets/carousel/`, in name order. (The plain captures in `assets/screenshots/` are a fallback.)
   - Small promo tile: `assets/promo-small-440x280.png`. Marquee: `assets/promo-marquee-1400x560.png`.
   - Homepage URL: https://github.com/SirTenzin/narrator. Support URL: https://github.com/SirTenzin/narrator/issues.
5. **Privacy** tab: paste the single purpose, the four permission justifications (storage, offscreen, host permissions, which covers both GitHub API hosts and the github.com content script) and answer remote code "No". Tick Authentication information and Website content, tick the three certifications, and paste the privacy policy URL.
6. **Distribution** tab: Free, Public, all regions. (Choose Unlisted instead if you only want people with the link; it is reviewed the same way.)
7. **Test instructions** tab: paste "Notes for reviewers".
8. Click **Submit for review**. Leave "Publish automatically after review" ticked.

Expect an email when review finishes. If it is still pending after three weeks, contact developer support from the dashboard.

## Firefox Add-ons (AMO)

1. Go to https://addons.mozilla.org/developers/ and sign in. AMO will ask you to turn on two-factor authentication for the Mozilla account if it isn't on.
2. Click **Submit a New Add-on**, choose **On this site**, and click **Continue**.
3. Upload `out/narrator-for-github-1.0.0-firefox.zip`. Validation should pass with no errors or warnings. Under compatibility, tick Firefox and untick Firefox for Android (it hasn't been tested there). Continue.
4. "Do you need to submit source code?" **Yes**, and upload `out/narrator-for-github-1.0.0-source.zip`. Continue.
5. Describe the add-on:
   - Name: Narrator for GitHub. URL slug: `narrator-for-github`.
   - Summary: the short description. Description: the long description.
   - Categories: Web Development.
   - Support email: your contact address. Support website: https://github.com/SirTenzin/narrator/issues.
   - License: MIT.
   - Privacy policy: tick "This add-on has a privacy policy" and paste the text of `PRIVACY.md` (AMO wants the text, not a link).
   - Notes to Reviewer: "Notes for reviewers", including the AMO-only paragraph.
6. Click **Submit Version**. Then open **Edit Product Page**, add the five slides from `assets/carousel/`, and save.

### Same-day fallback: self-hosted signed .xpi

If the listed version is still waiting tomorrow, sign a self-distributed build. Versions must be unique across listed and unlisted, so bump first:

1. Set `"version": "1.0.1"` in `apps/extension/manifest.json` and `package.json`, commit, and run `bun run package:firefox`.
2. On the add-on's page in the Developer Hub, click **Upload New Version**, choose **On your own**, upload the 1.0.1 firefox zip and the 1.0.1 source zip.
3. When it is signed (usually minutes, at most 24 hours), open **Manage Status & Versions**, open 1.0.1 and download the signed `.xpi`.
4. Attach it to the GitHub release. Users download it and drop it on `about:addons`, or use the gear menu's **Install Add-on From File**. It does not update itself.

## Same-day fallback for Chromium: GitHub release

```bash
gh release create extension-v1.0.0 apps/extension/store/out/narrator-for-github-1.0.0-chrome.zip \
  --title "Narrator for GitHub 1.0.0" \
  --notes "Unzip, open chrome://extensions (or edge://, brave://, arc://), turn on Developer mode, click Load unpacked and choose the unzipped folder. Store listings are in review."
```

Developer-mode installs don't update themselves, and Chrome may remind users that a developer-mode extension is installed. Once the store listing is live, point people there and they can remove the unpacked copy.

## Microsoft Edge Add-ons

1. Go to https://partner.microsoft.com/dashboard/microsoftedge/overview. First time only: register for the Microsoft Edge program (free). An individual account is verified quickly; a company account can take days.
2. Click **Create new extension** and upload `out/narrator-for-github-1.0.0-edge.zip`. Click **Continue**.
3. **Availability**: Visibility Public (or Hidden for link-only), Markets all. **Save**.
4. **Properties**: Category Developer tools. Privacy policy: Yes, with the privacy policy URL. Website: https://github.com/SirTenzin/narrator. Support contact: https://github.com/SirTenzin/narrator/issues. Mature content: No. **Save**.
5. **Privacy**: the same single purpose, permission justifications, remote code "No" and data usage answers as Chrome. **Save**.
6. **Store listings** → English → **Edit details**: Description (the long description, over the 250 character minimum), Extension logo `assets/logo-300.png`, Small promotional tile `assets/promo-small-440x280.png`, Large promotional tile `assets/promo-marquee-1400x560.png`, Screenshots (the five 1280x800 slides in `assets/carousel/`), Search terms from LISTING.md. **Save**.
7. Click **Publish**, paste "Notes for reviewers" into **Notes for certification**, and click **Publish** again.

## Safari (App Store)

This needs an Apple Developer Program membership (US$99 a year). If you don't have one, enroll tonight at https://developer.apple.com/programs/enroll/; identity checks can take a day or two. No Mac is needed.

1. In App Store Connect, open **Apps**, click **+** → **New App**. Platform macOS (skip iOS for now; it needs iPhone and iPad screenshots). Name: Narrator for GitHub (if it's taken, "Narrator: GitHub in English"). Primary language English. Bundle ID: register `dev.usenarrator.narrator` if the menu offers to, otherwise create it under Certificates, Identifiers & Profiles first. SKU: `narrator-for-github`. User access: Full.
2. Open the app's **Xcode Cloud** tab and, under **Safari Web Extension Packager**, click **Upload**. Upload the contents of `out/narrator-for-github-1.0.0-safari.zip` (the universal build, which runs without Chrome's offscreen API). Watch **Builds** until it finishes and read any compatibility warnings.
3. **TestFlight**: add yourself as an internal tester, install on your Mac, enable the extension in Safari's settings, allow it on github.com, and check a pull request such as https://github.com/openstatusHQ/openstatus/pull/2860/files. Safari has not been tested from this kit, so don't skip this.
4. **App Information**: category Developer Tools (secondary Productivity), privacy policy URL, content rights "No third-party content".
5. **Pricing and Availability**: Free, all territories.
6. **App Privacy**: Get Started → "No, we do not collect data from this app" → Publish.
7. Version **1.0** page: Mac screenshots (the five 2560x1600 slides in `assets/carousel-2x/`), promotional text, description, keywords, support URL, marketing URL, copyright, the TestFlight build, and App Review contact details with "Notes for reviewers". Age rating: None for every question.
8. Click **Add for Review**, then **Submit for Review**. Most reviews finish within 48 hours.

On a Mac with Xcode you can skip the packager: `bun run safari` builds a local app with `safari.sh`, and Xcode's Product → Archive uploads it.

## After launch

- Update `docs/guides/browser-extension.mdx` with the store links as each listing goes live.
- Every update needs a higher version in `manifest.json` before packaging, and a new source zip for AMO.
