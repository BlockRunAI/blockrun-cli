---
name: blockrun-cli
description: Use the `blockrun` CLI to pay-per-request AI (chat/image/video/music/speech), live data (web/X search, prediction markets, Pyth prices, 40+ chain RPC), and any x402-paid endpoint — all billed from a local USDC wallet, no API keys. Use when the user asks to run a model, generate media, query crypto/prediction/web data, pay a 402 resource, check wallet balance or spend, or manage BlockRun sub-products (route/agent/mcp/codex).
---

# BlockRun CLI

One entry point for every BlockRun product. Wallet lives at `~/.blockrun/.session`; every command bills USDC from it via x402 on Base. No API keys, no accounts.

## Contract (parse this, not the prose)

Always pass `--json`. Every command returns one line:

```json
{"ok":true,"data":...,"meta":{"cost":0.001,"chain":"eip155:8453"}}
{"ok":false,"error":{"type":"payment-cap","code":402,"message":"..."}}
```

Check `ok`, not the exit code alone (exit is 0/1 to match). `meta.cost` is the USD actually paid.

## Money safety (important)

- `--quote` on `api`/`pay` prices a call WITHOUT paying. Quote first when cost is unknown.
- Payments above $1 are refused unless `--max <usd>` raises the cap. Do not raise it without the user's ask.
- `blockrun spend` shows real ledger totals (today/month/all). `blockrun limits` shows the user's guardrails — never work around a `payment-cap` or policy denial; surface it.

## Commands

```bash
# wallet & status
blockrun --json status | balance | doctor | fund
blockrun wallet import --stdin [--force]  # pipe the key on stdin; never put it in argv
blockrun wallet create|export --yes|recover
blockrun chain base|sol · config list|get|set

# inference
blockrun --json run <model> "<prompt>"          # one-shot; free models: nvidia/*
blockrun --json models --free                   # catalog + pricing
blockrun chat --model <m>                       # interactive REPL

# multimodal (paid; URLs in data.urls; --out saves file)
blockrun --json image "<prompt>" --size 1024x1024 --out img.png
blockrun --json image edit <url> "<prompt>"
blockrun --json video "<prompt>" --duration 5 · music "<prompt>" · speech "<text>" --voice <v>
blockrun --json realface enroll <https-image-url> --name <n>

# data
blockrun --json search "<q>"                    # Grok live web/X
blockrun --json research "<q>" --path answer    # Exa
blockrun --json predict polymarket/events --limit 5
blockrun --json crypto <surf-path> · price BTC · rpc base eth_blockNumber
blockrun --json discover                        # x402 service catalog (free)

# generic x402 (ANY paid endpoint)
blockrun --json api POST v1/chat/completions --data '{...}' --quote   # price it
blockrun --json api POST v1/chat/completions --data '{...}'          # pay ≤$1
blockrun --json pay <url> --method GET --max 2                       # raise cap explicitly

# guardrails & spend
blockrun --json limits set --per-call 0.5 --daily 20
blockrun --json limits allow chat,data · limits deny video
blockrun --json policy show · spend today

# sub-products (independently installed, args forwarded)
blockrun route|agent|mcp|codex|phone|share ...  # missing → blockrun ext install <name>
```

## Recipes

- "what would this cost?" → `blockrun --json api POST <path> --data '...' --quote` → report `data.quote.amountUsdc`.
- cheapest capable chat → `blockrun --json run nvidia/deepseek-v4-flash "..."` (free) before reaching for paid models.
- balance check before a batch of paid calls: `blockrun --json balance`; if low, `blockrun --json fund` and show the user `data.address`.
