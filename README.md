<div align="center">

<h1>BlockRun CLI</h1>
<h3>One entry point for every BlockRun product.</h3>

<p>Use a prepaid account API key or pay per request with USDC for chat, image, video, music, speech and live data.<br>Wallet payments use x402 on <b>Solana or Base</b>. Account mode requires no wallet.</p>

[![CI](https://img.shields.io/github/actions/workflow/status/BlockRunAI/blockrun-cli/ci.yml?branch=master&style=flat-square&label=CI)](https://github.com/BlockRunAI/blockrun-cli/actions)
[![npm core](https://img.shields.io/npm/v/@blockrun/core.svg?style=flat-square&label=%40blockrun%2Fcore)](https://www.npmjs.com/package/@blockrun/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![x402](https://img.shields.io/badge/x402-Solana%20%7C%20Base-purple?style=flat-square)](https://x402.org)

</div>

```bash
npm install -g @blockrun/cli

export BLOCKRUN_API_KEY=brk_live_YOUR_KEY          # or: blockrun login --stdin
blockrun status                                   # account or wallet status
blockrun fund                                     # account credits or wallet funding details
blockrun run nvidia/deepseek-v4-flash "hello"     # free model — $0
blockrun --json api POST v1/chat/completions --data '{…}' --quote   # price a call WITHOUT paying
```

## Account API quick start

```bash
# Never put the key in command arguments.
printf '%s\n' "$BLOCKRUN_API_KEY" | blockrun login --stdin
blockrun models
blockrun run openai/gpt-4o-mini "Hello"
blockrun --json api GET v1/models
blockrun logout
```

Environment keys override the shared `~/.blockrun/.api-key` saved by `login`. Account requests go only to `https://api.blockrun.ai` (override with `BLOCKRUN_API_BASE_URL` for trusted staging), refuse redirects, and do not fall back to x402 after an account error. `blockrun pay` remains the explicit wallet command for arbitrary third-party x402 URLs. The credits portal is authoritative for account usage; wallet `spend` and local limits cannot represent account charges.

This review branch depends on [TypeScript SDK PR #36](https://github.com/BlockRunAI/blockrun-llm-ts/pull/36). Do not publish the CLI until that SDK is released and `@blockrun/llm` is updated from `^3.10.0` to the release containing account authentication. To review now, link or pack the exact SDK commit `7a61b57` locally. The current npm release does not provide this feature.

Account mode covers model listing, chat/run, media, data and SDK polling. Real trading and arbitrary `pay` operations still require the appropriate wallet. New wallet selection defaults to Solana, while a saved choice or existing Base-only wallet stays on Base. Some legacy CLI media/data wallet commands still require Base; they return an explicit error instead of sending an EVM key to Solana.

## Why

Register at [user.blockrun.ai](https://user.blockrun.ai), create a key at [API Keys](https://user.blockrun.ai/dashboard/keys), and add prepaid [Credits](https://user.blockrun.ai/dashboard/credits). `BLOCKRUN_API_KEY` or `blockrun login --stdin` enables account billing without a wallet. Wallet users can instead pay x402 USDC on Solana or Base. this repo is the **shared kernel + umbrella entry point** that ties the family together:

| Package | What it is |
|---------|-----------|
| [`@blockrun/core`](packages/core) | The kernel every product depends on: shared **account and wallet credential resolution**, the agent-native **`{ok,data\|error}` output contract**, config/paths. |
| [`@blockrun/cli`](packages/cli) | The `blockrun` umbrella: ~40 commands (wallet, inference, multimodal, data, generic x402 `api`/`pay`, spending guardrails, agent skills) plus gh-style **prefix discovery** — any `blockrun-<x>` on PATH becomes `blockrun <x>`. |

```
        blockrun (umbrella CLI)
        route→ClawRouter · agent→Franklin · mcp→BlockRun MCP · codex→clawrouter-codex
              │ prefix discovery (blockrun-*)
   ClawRouter │ Franklin │ MCP │ codex │ SDKs      ← independently installable
              └───── all depend on ─────┘
        @blockrun/core   (one account/wallet config · one contract)
```

## Highlights

- **Agent-native**: every command emits `{"ok":true,"data":…}` / `{"ok":false,"error":…}` with `--format json|table|ndjson|csv`; `blockrun skills add` teaches Claude Code the whole CLI in one step.
- **Money safety**: `--quote` prices any x402 call without paying; per-call cap (default $1) plus `limits`/`policy`/`spend` guardrails enforced against the real cost ledger.
- **Composable**: sub-products stay independent — `clawrouter`, `franklin`, `blockrun-mcp` keep working unchanged; the umbrella is an extra door, not a new lock.

## Dev loop

```bash
pnpm install
node --import tsx --test packages/*/test/*.test.ts   # 62 unit tests
pnpm cli status --json                               # run the CLI from source
```

## License

MIT
