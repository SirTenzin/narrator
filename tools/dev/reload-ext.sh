#!/bin/bash
# Rebuild and hot-reload the unpacked extension in the desktop Chrome, then reload the GitHub tab.
cd "$(dirname "$0")/../.." && PE_COPY_TO=/home/user/plain-english-extension bun apps/extension/build.ts >/dev/null && \
bun tools/dev/cdp.ts chrome://extensions 'new Promise(r => chrome.developerPrivate.reload("gnfmmaojcbijngamioficdmocgglopeb", {failQuietly: true}, () => r("reloaded")))' && \
sleep 1 && bun tools/dev/cdp.ts github.com 'location.reload(), "page reloaded"'
