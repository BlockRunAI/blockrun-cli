<div align="center">

<h1>BlockRun CLI</h1>
<h3>One entry point for every BlockRun product.</h3>

<p>Pay-per-request AI — chat, image, video, music, speech — plus live data<br>
(web/X search, prediction markets, Pyth prices, 40+ chain RPC) and <b>any x402-paid endpoint</b>,<br>
all billed from one local USDC wallet. <b>No API keys. No accounts. No subscriptions.</b></p>

[![CI](https://img.shields.io/github/actions/workflow/status/BlockRunAI/blockrun-cli/ci.yml?branch=master&style=flat-square&label=CI)](https://github.com/BlockRunAI/blockrun-cli/actions)
[![npm core](https://img.shields.io/npm/v/@blockrun/core.svg?style=flat-square&label=%40blockrun%2Fcore)](https://www.npmjs.com/package/@blockrun/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![x402](https://img.shields.io/badge/x402-USDC%20on%20Base-purple?style=flat-square)](https://x402.org)

</div>

```bash
npm install -g @blockrun/cli

blockrun status                                   # wallet auto-detected / created
blockrun fund                                     # top up with USDC on Base
blockrun run nvidia/deepseek-v4-flash "hello"     # free model — $0
blockrun --json api POST v1/chat/completions --data '{…}' --quote   # price a call WITHOUT paying
```

## Why

Agents can't sign up for accounts — but they can sign transactions. Every BlockRun tool bills x402 USDC micropayments from a local wallet (`~/.blockrun/.session`); this repo is the **shared kernel + umbrella entry point** that ties the family together:

| Package | What it is |
|---------|-----------|
| [`@blockrun/core`](packages/core) | The kernel every product depends on: single-source **wallet resolution**, the agent-native **`{ok,data\|error}` output contract**, config/paths. |
| [`@blockrun/cli`](packages/cli) | The `blockrun` umbrella: ~40 commands (wallet, inference, multimodal, data, generic x402 `api`/`pay`, spending guardrails, agent skills) plus gh-style **prefix discovery** — any `blockrun-<x>` on PATH becomes `blockrun <x>`. |

```
        blockrun (umbrella CLI)
        route→ClawRouter · agent→Franklin · mcp→BlockRun MCP · codex→clawrouter-codex
              │ prefix discovery (blockrun-*)
   ClawRouter │ Franklin │ MCP │ codex │ SDKs      ← independently installable
              └───── all depend on ─────┘
        @blockrun/core   (one wallet · one payment path · one contract)
```

## Highlights

- **Agent-native**: every command emits `{"ok":true,"data":…}` / `{"ok":false,"error":…}` with `--format json|table|ndjson|csv`; `blockrun skills add` teaches Claude Code the whole CLI in one step.
- **Money safety**: `--quote` prices any x402 call without paying; per-call cap (default $1) plus `limits`/`policy`/`spend` guardrails enforced against the real cost ledger.
- **Composable**: sub-products stay independent — `clawrouter`, `franklin`, `blockrun-mcp` keep working unchanged; the umbrella is an extra door, not a new lock.

## Dev loop

```bash
pnpm install
node --import tsx --test packages/*/test/*.test.ts   # 39 unit tests
pnpm cli status --json                               # run the CLI from source
```

## License

MIT
