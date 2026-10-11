# Narrator for GitHub: source code for review

This archive is the source of the Narrator for GitHub add-on. The add-on's JavaScript is bundled and minified by Bun's bundler, so this file explains how to rebuild it and check that the result matches the uploaded package.

The archive is the project's monorepo without its test corpus and documentation site. The add-on lives in `apps/extension`. Its code imports the narration engine and plugins from `packages/` and `plugins/` in the same repository, and every one of them is included here as TypeScript source.

## What the build does

`apps/extension/build.ts` runs `Bun.build` on the TypeScript in `apps/extension/src`, writes the bundles with linked source maps, copies the HTML, CSS, icons and `manifest.json`, and copies the oxc parser's WebAssembly file from `node_modules/@oxc-parser/binding-wasm32-wasip1`. That WebAssembly file is published on npm by the oxc project (MIT licence) and is copied byte for byte. No build step is web-based, and every tool is open source.

The Firefox package is the `apps/extension/firefox/dist` folder. The same script also writes a Chrome build and a development build next to it; reviewers can ignore those.

## Environment

- Any 64-bit Linux or macOS. It was built on Ubuntu 24.04 (x86_64). The build has no native compilation steps, so ARM64 should give the same output.
- Bun 1.3.14, from https://bun.sh. Node and npm are not used for the build.
- About 600 MB of disk for `node_modules`.

Install Bun 1.3.14:

```bash
curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"
export PATH="$HOME/.bun/bin:$PATH"
bun --version   # 1.3.14
```

## Build

From the root of this archive:

```bash
bun install --frozen-lockfile
bun apps/extension/build.ts
```

`bun.lock` pins every dependency, and `--frozen-lockfile` refuses to install anything that differs from it.

## Compare with the uploaded package

```bash
mkdir /tmp/uploaded && cd /tmp/uploaded && unzip -q /path/to/narrator-for-github-1.0.0-firefox.zip && cd -
diff -r /tmp/uploaded apps/extension/firefox/dist && echo identical
```

## Notes for the reviewer

- The add-on only talks to `api.github.com` and `raw.githubusercontent.com`, to read the pull request or commit the user is viewing on github.com. It has no server of its own, no analytics and no remote code.
- An optional GitHub token, entered by the user on the options page, is kept in `storage.local` and sent only to those two GitHub hosts.
- The WebAssembly parser needs `'wasm-unsafe-eval'` in the extension page CSP. That allows WebAssembly compilation only, not JavaScript `eval`.
- The emnapi runtime that loads the parser probes `new Function` at startup. The build replaces that call with a stub that throws (see `noFunctionConstructor` in `build.ts`), since the CSP would block it anyway.
