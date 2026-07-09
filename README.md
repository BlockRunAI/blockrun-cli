# blockrun-cli (workspace)

Umbrella CLI + shared kernel for the BlockRun product family. **Additive and standalone** — it does not modify any live product yet. See [../BLOCKRUN_CLI_PROPOSAL.md](../BLOCKRUN_CLI_PROPOSAL.md) and [../BLOCKRUN_CLI_BUILD_PLAN.md](../BLOCKRUN_CLI_BUILD_PLAN.md).

## Packages

| Package | What it is |
|---------|-----------|
| `@blockrun/core` | Shared kernel: the JSON **output contract**, single-source **wallet** reader (`~/.blockrun/.session`), and **config**/chain resolution. Everything else depends on this. |
| `@blockrun/cli` | The `blockrun` umbrella. Owns wallet/status; forwards `route`/`agent`/`mcp`/`phone` to independently-installed `blockrun-*` sub-products (gh-style prefix discovery). |

## Dev loop

```bash
pnpm install
pnpm test            # node:test across both packages
pnpm -r build        # tsc → dist  (or: ./node_modules/.bin/tsc -p packages/<p>/tsconfig.json)
pnpm cli status --json
```

## Design invariants

- **One wallet.** `@blockrun/core` reads the same `~/.blockrun/.session` as `@blockrun/llm`, in the same order (`env → .session → legacy`). `blockrun route` and a standalone `clawrouter` see the same wallet.
- **One output contract.** Every command returns `{"ok":true,"data",..,"meta"}` / `{"ok":false,"error"}`. `--format json|pretty|table|ndjson|csv`.
- **Sub-products stay independent.** Any `blockrun-<x>` on PATH becomes `blockrun <x>`; core commands can never be shadowed; missing sub-products yield a structured install hint.

## Commands (working)

```
blockrun status | wallet [create] | balance | fund | chain [base|sol]
blockrun config <list|get|set> | doctor
blockrun run <model> "<prompt>" | models [--free]
blockrun route|agent|mcp|codex|phone ...   # forwarded to sub-products
```

`run`/`models`/`balance`/`doctor` go through `@blockrun/llm`, with the key resolved by
`@blockrun/core` and handed to the SDK (never read twice, never sent anywhere).

## Status

Scaffold + core commands complete and tested (26 unit tests + live e2e: balance, free-model
run, chain persistence). Next: the upstream extraction PRs (publish `@blockrun/core`, make
`@blockrun/llm` depend on it) — pending npm publish + review.
