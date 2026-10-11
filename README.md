# Narrator

Narrator reads TypeScript and JavaScript and writes down what the code does in plain English, one sentence per statement. It works from the syntax tree with rules, not a language model, so the same code always reads the same way and nothing leaves your machine.

```ts
export async function renew(subscription: Subscription, now: Date) {
  if (subscription.status === "canceled") return;
  const plan = plans.find((p) => p.id === subscription.planId);
  if (!plan) throw new NotFoundError("Unknown plan");
  for (const seat of subscription.seats) {
    if (seat.expiresAt < now) await releaseSeat(seat);
  }
  await sendReceipt({ to: subscription.ownerEmail, amount: plan.price });
}
```

```text
To renew (async), given subscription (Subscription) and now (Date):
  If subscription's status is "canceled", stop here.
  Let plan be the first p in plans where p's ID is subscription's plan ID.
  If plan is missing, fail with a not found error: "Unknown plan".
  For each seat in subscription's seats:
    If seat's expires at is before now, release seat (seat).
  Send receipt (to: subscription's owner email and amount: plan's price).
```

It also narrates diffs, so a pull request can be read as a list of changed sentences instead of changed lines.

## Ways to use it

- **Narrator for GitHub**, a browser extension for Chrome, Arc, Edge, Firefox and Safari. It swaps the code in GitHub's own diff view for English, with a switch in GitHub's diff settings menu to turn it off.
- **The CLI**: `narrator src/billing.ts` narrates files, and `narrator diff main..HEAD` narrates a branch.
- **The SDK**, for Node, Bun, browsers and edge runtimes. The parser runs natively on servers and as WebAssembly everywhere else.

```ts
import { createNodeNarrator } from "@usenarrator/node";
import { hono } from "@usenarrator/plugin-hono";

const narrator = createNodeNarrator({ plugins: [hono()] });
console.log(narrator.narrate(source, "src/routes.ts").lines);
```

## Library plugins

Plugins teach Narrator what popular libraries mean, so `app.get("/", (c) => c.text("Hi"))` reads as "Answer GET / with the text "Hi"". A plugin only applies to files whose package depends on its library.

| Area | Plugins |
| --- | --- |
| Validation | zod, Valibot, ArkType |
| Data | Drizzle, Prisma, Kysely, SQL |
| Servers | Hono, Elysia, Express, Fastify, tRPC |
| Frontend | React, Next.js, TanStack Query |
| Payments, auth and AI | Stripe, Autumn, Better Auth, AI SDK |
| Jobs | BullMQ, Inngest, Trigger.dev, Temporal |
| Other | Effect, testing (bun:test, Vitest, Jest), decimal.js |

All English lives in phrasebooks, separate from the rules, so Narrator can be translated into other languages without touching the code that walks the syntax tree.

## Repository layout

| Folder | What it holds |
| --- | --- |
| `packages/core` | Language-agnostic pieces: the narrator, diffing, markup, locales and dependency detection. |
| `packages/lang-ts` | The TypeScript and JavaScript language: the engine, the plugin API and the built-in rules. |
| `packages/locale-en` | The English phrasebook and grammar. |
| `packages/node` | Node and Bun conveniences: a ready-made narrator and dependency loading from disk. |
| `packages/testkit` | Helpers for testing plugins and translations. |
| `plugins/*` | One package per library. |
| `apps/cli` | The `narrator` command. |
| `apps/extension` | Narrator for GitHub, with store packaging under `apps/extension/store`. |
| `apps/viewer` | A local side-by-side viewer for a repository. |
| `docs` | The documentation site (Mintlify). |
| `tools` | Build, publish checks and development scripts. |

## Development

You need [Bun](https://bun.sh) 1.3 or newer.

```bash
bun install
bun test                 # the whole suite, about a second
bun run typecheck
bun run build            # every package to dist/
bun run check:publish    # publint and are-the-types-wrong on each package
bun apps/cli/narrate.ts path/to/file.ts
```

To work on the extension, run `bun apps/extension/build.ts` and load `apps/extension/dist` as an unpacked extension. To work on the docs, run `npx mint dev` inside `docs`.

## License

MIT
