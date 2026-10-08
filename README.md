# Plain English

Deterministic TS/JS → English narrator built on the oxc AST. No LLM, no heuristics over text: every phrase comes from a syntax node.

```sh
bun narrate.ts path/to/file.ts            # coloured terminal output
bun narrate.ts path/to/file.ts --plain    # plain text
echo 'if (xs.includes(b)) go()' | bun narrate.ts --plain
ROOT=/workspace/autumn bun viewer/server.ts   # side-by-side viewer on :4477
bun stress.ts                              # crash + fallback stats across the repo
```

## Layout

- `src/engine.ts` — core: nouns (values), conditions (clauses), statements (lines), types, comments.
- `src/names.ts` — identifier → words (`cusEntToCusPrice` → "customer entitlement → customer price"), predicates (`isX`, `hasX`, `overlapsX`), verbs, converters (`aToB`).
- `src/markup.ts` — inline token markup so the viewer can link names and functions.
- `src/dialects/common.ts` — JS builtins, array pipelines, Map/Set, strings, Math/JSON/Promise, zod, bun:test/jest `expect`, console/logger.
- `src/dialects/autumn.ts` — Autumn glossary, ambient `ctx`/`db`, drizzle queries/conditions, Decimal, `RecaseError`, `notNullish`.
- `viewer/` — Bun server + single HTML page: hover sync, click a function to expand its definition inline, ⌘/Ctrl+click to open it.

## Adding a dialect

```ts
import type { Dialect } from "./src/engine";

export const myDialect: Dialect = {
  name: "mine",
  vocabulary: { glossary: { inv: "invoice" }, verbs: ["reconcile"] },
  ambient: ["deps"],                       // dropped from args and member chains
  errorLabels: { HttpError: "an HTTP error" },
  constants: { "Number.MAX_SAFE_INTEGER": "no limit" },
  calls: {
    // keys: `fn`, `Obj.method`, `Obj.*`, `*.method`, `*.parent.method`, `new Foo`
    "*.retry": ({ obj, args, e }) => `${e.text(obj)}, retried ${e.text(args[0])} times`,
  },
  conditions: {
    "*.isExpired": ({ obj, e, neg }) => `${e.text(obj)} has ${neg ? "not " : ""}expired`,
  },
};
```

Later dialects take priority. A rule returning `null` falls through to the next rule, then to the generic rendering. Use `e.text(node)` inside rules: any block lines it produces are re-attached automatically.

## Browser extension (GitHub)

`extension/dist` is a ready-to-load unpacked extension. It replaces code rows in GitHub's own diff tables (PR "Files changed" and commit pages) with English, following GitHub's split/unified setting. Toggle it with **Plain English** in GitHub's diff settings (gear) menu.

```sh
bun install
bun extension/build.ts   # rebuilds extension/dist
```

Load it: open `arc://extensions` (or `chrome://extensions`), turn on Developer mode, click **Load unpacked**, pick `extension/dist`. After a rebuild, press the reload icon on the extension card.
