#!/bin/bash
# Wraps dist/ in a Safari app (macOS + Xcode). Output: apps/extension/safari-build/Narrator.app
set -euo pipefail
cd "$(dirname "$0")"
bun build.ts
rm -rf safari safari-build
xcrun safari-web-extension-converter dist --project-location safari --app-name Narrator --bundle-identifier dev.usenarrator.narrator --macos-only --no-open --no-prompt --copy-resources
# The converter capitalises the app id, which breaks the extension-prefix check.
sed -i '' 's/PRODUCT_BUNDLE_IDENTIFIER = dev.usenarrator.Narrator;/PRODUCT_BUNDLE_IDENTIFIER = dev.usenarrator.narrator;/' safari/Narrator/Narrator.xcodeproj/project.pbxproj
xcodebuild -project safari/Narrator/Narrator.xcodeproj -scheme Narrator -configuration Debug -derivedDataPath safari-build/dd CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO -quiet
cp -R safari-build/dd/Build/Products/Debug/Narrator.app safari-build/
echo "built apps/extension/safari-build/Narrator.app"
