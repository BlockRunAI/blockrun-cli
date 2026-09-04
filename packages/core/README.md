# @blockrun/core

Shared kernel for the BlockRun product family. One account or wallet credential location, one output contract, one config — so every BlockRun tool (`blockrun` CLI, ClawRouter, Franklin, MCP, the SDKs, clawrouter-codex) reads the **same** `~/.blockrun` wallet and speaks the **same** machine-readable envelope.

## Install

```bash
npm install @blockrun/core
```

## What's inside

### Output contract (`@blockrun/core/output`)
Agent-native by construction — every command returns the same envelope:

```ts
import { ok, err, emit, render } from "@blockrun/core";

emit(ok({ address: "0x…" }, { cost: 0.003, chain: "base" })); // stdout, exit 0
emit(err("payment", "insufficient balance", 402));             // stderr, exit 1
// render(env, "json" | "pretty" | "table" | "ndjson" | "csv")
```

`{"ok":true,"data":…,"meta":{…}}` / `{"ok":false,"error":{"type","code","message"}}`

### Account authentication (`@blockrun/core/auth`)

`BLOCKRUN_API_KEY` overrides the shared `~/.blockrun/.api-key`. Helpers validate, persist with mode 0600, restrict Bearer credentials to the configured account origin, strip payment headers and refuse redirects. Register at <https://user.blockrun.ai>; keys and credits live under `/dashboard/keys` and `/dashboard/credits`.

### Wallet (`@blockrun/core/wallet`)
Single source of truth. Resolution order matches `@blockrun/llm`:
`env BLOCKRUN_WALLET_KEY | BASE_CHAIN_WALLET_KEY` → `~/.blockrun/.session` → legacy `wallet.key`.

```ts
import { loadWallet, resolvePrivateKey } from "@blockrun/core";
const w = loadWallet(); // { address, privateKey, source } | null  — key never leaves the machine
```

**Wallets from other applications are never adopted automatically.** `~/.<app>/wallet.json`
files are discoverable, but installing another product — or dropping a file into the home
directory — must not be able to change which key BlockRun signs payments with. Adoption is
an explicit act, and matching is done on the address *derived from the discovered key*, so a
file cannot claim an address it holds no key for:

```ts
import { listDiscoveredWallets, adoptWallet } from "@blockrun/core";

listDiscoveredWallets(); // [{ address, source }] — no private keys, nothing active
adoptWallet("0x…");      // copies it to .session, backing up the outgoing wallet first
```

### Config (`@blockrun/core/config`)
`~/.blockrun` path resolution (override with `BLOCKRUN_HOME`) and chain selection (`resolveChain`). New users default to Solana; saved selections and existing Base-only wallets keep Base.

## License

MIT
