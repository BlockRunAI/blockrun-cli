# @blockrun/cli

**One entry point for every BlockRun product.** Pay-per-request AI — chat, image, video, music, speech — plus live data (web/X search, prediction markets, Pyth prices, 40+ chain RPC) and any x402-paid endpoint, all billed from a local USDC wallet. No API keys. No accounts. No subscriptions.

```bash
npm install -g @blockrun/cli

blockrun status              # wallet auto-detected (or: blockrun wallet create)
blockrun fund                # send USDC on Base to the printed address
blockrun run nvidia/deepseek-v4-flash "hello"     # free model — $0
blockrun run openai/gpt-5.2 "hello"               # paid per request
```

Your wallet lives at `~/.blockrun/.session` and is shared with every BlockRun tool ([ClawRouter](https://github.com/BlockRunAI/ClawRouter), [Franklin](https://github.com/BlockRunAI/Franklin), [BlockRun MCP](https://github.com/BlockRunAI/blockrun-mcp), [clawrouter-codex](https://github.com/BlockRunAI/clawrouter-codex)). The private key never leaves your machine — it signs x402 micropayments locally.

## Agent-native by construction

Every command speaks one machine-readable contract:

```bash
$ blockrun --json balance
{"ok":true,"data":{"address":"0x3491…402E","balance":"$21.44","chain":"base"}}
$ blockrun --json run bad/model "hi"
{"ok":false,"error":{"type":"run","message":"…"}}     # stderr, exit 1
```

`--format json|pretty|table|ndjson|csv` on everything. Teach your agent the whole CLI in one step:

```bash
blockrun skills add        # installs the bundled skill into ~/.claude/skills
```

## Money safety

```bash
blockrun api POST v1/chat/completions --data '{…}' --quote   # price WITHOUT paying
blockrun limits set --per-call 0.5 --daily 20 --monthly 200  # hard ceilings
blockrun limits deny video                                   # category blacklist
blockrun spend today                                         # real ledger totals
```

Payments above the per-call cap (default **$1**) are refused unless you explicitly raise it with `--max`. Daily/monthly ceilings are enforced against the real cost ledger before any paid command runs.

## Commands

| Group | Commands |
|-------|----------|
| Wallet | `status` `wallet create` `wallet import --stdin` `wallet export/recover` `balance` `fund` `chain` `config` `doctor` |
| Inference | `run <model> "<prompt>"` `chat` (REPL) `models [--free]` |
| Multimodal | `image` (+`edit`) `video` `music` `speech` (+`voices`) `realface enroll` — URLs by default, `--out` saves |
| Data | `search` `research` `predict` `crypto` `price` `rpc` `discover` |
| x402 | `api <METHOD> <url\|path>` `pay <url>` — any paid endpoint, `--quote` to price |
| Guardrails | `limits` `policy` `spend` |
| Ecosystem | `ext list/install/remove` `skills list/add` `upgrade` |

## Sub-products (independently installable)

```bash
blockrun route serve       # → ClawRouter: smart LLM routing, save up to 92%
blockrun agent start       # → Franklin: the autonomous agent with a wallet
blockrun mcp add           # → BlockRun MCP for Claude
blockrun codex up          # → run OpenAI Codex on BlockRun models
```

Missing one? `blockrun ext install route`. Any `blockrun-<x>` executable on your PATH automatically becomes `blockrun <x>` (the gh/Docker extension model) — existing commands like `clawrouter` and `franklin` keep working unchanged.

## How it relates to @blockrun/core

The CLI is a thin shell over [`@blockrun/core`](https://www.npmjs.com/package/@blockrun/core) — the shared kernel (wallet resolution, x402 payment, output contract) that every BlockRun product depends on. One wallet, one payment path, one contract.

## License

MIT — source at [BlockRunAI/blockrun-cli](https://github.com/BlockRunAI/blockrun-cli).
