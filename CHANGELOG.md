# Changelog

All notable changes to the BlockRun CLI are documented here.

## 2026-08-04 — `@blockrun/core` 0.1.0, `@blockrun/cli` 0.2.0

> **Two releases never reached npm before this one.** `@blockrun/cli` 0.1.1 (2026-07-17,
> below) was tagged and changelogged but never published — npm's `latest` was still
> 0.1.0 — and core 0.1.0 sat built-but-unpublished while `@blockrun/cli@0.1.0` kept
> resolving `@blockrun/core@^0.0.3`, which carries the defect described immediately
> below. A `^0.0.3` range cannot reach 0.1.0, so publishing core alone would have fixed
> nobody; the CLI ships as 0.2.0 with the range moved to `^0.1.0`. The repo had no
> publish workflow at all, which is how both releases were lost — one is added in this
> release so it cannot happen silently again.

### Security: a provider wallet could take over payment signing

`resolveFromFiles()` consulted `~/.<app>/wallet.json` files **before** the canonical
`~/.blockrun/.session`, and returned the most recently modified one. Installing another
product — or writing a single file into the home directory — therefore changed which key
`resolvePrivateKey()` handed to x402 payment signing, across `blockrun api`, `pay`, `chat`,
`run`, `image`, `video`, `music`, `speech`, and the data commands. `scanWallets()` also
reported each file's self-declared `address` field, so `blockrun wallet recover` would
display an address the file held no key for.

This is the same defect fixed in `@blockrun/llm` on 2026-07-19
([blockrun-llm-ts#14](https://github.com/BlockRunAI/blockrun-llm-ts/pull/14)); core kept the
pre-fix behavior while its own header comment claimed to mirror the SDK. Core's README
already documented the correct order — the implementation, not the contract, was wrong.

- `resolveFromFiles()` now reads `.session` → legacy `wallet.key` only. Discovered provider
  wallets never participate in automatic resolution.
- `scanWallets()` derives each address from the discovered private key and drops entries
  whose key is missing or unusable. The file's `address` field is no longer trusted anywhere.
- `WalletSource` no longer includes `"provider"` — after this change it was never a reachable
  resolution result. **Breaking** for anything narrowing on that member.
- Added `listDiscoveredWallets()` (addresses + source paths, no private keys) and
  `adoptWallet(address)`, the deliberate migration path. Adoption matches on the *derived*
  address and backs up the outgoing `.session` first, so funds are never stranded.

### CI

- The published-artifact smoke test packed only the CLI, so npm resolved
  `@blockrun/core` from the registry. It was therefore verifying the **last published**
  core rather than the code under review — which is how core drifted three weeks behind
  the SDK unnoticed — and any core version bump failed the step with `ETARGET` until it
  had already shipped. Both packages are now packed and installed as roots.
- The smoke step now asserts the security property against the packed artifact: a
  provider `wallet.json` must not displace `.session`, and an address no discovered key
  controls must not be adoptable. Verified to fail against the pre-fix build.

### CLI

- Added `blockrun wallet list` and `blockrun wallet adopt <address>`.
- `blockrun wallet recover` now reports entries in true resolution order, marks exactly one
  `active`, and lists discovered provider wallets as inactive with their file path. Its
  `meta.active` previously named a provider wallet that resolution would not actually use.
- Version bumped to 0.2.0 rather than 0.1.1: the published 0.1.0 is two releases behind, so
  this build is the first one users can actually install that contains either the 0.1.1
  fixes below or the security fix above. The `@blockrun/core` range moves `^0.0.3` → `^0.1.0`
  (via the workspace protocol, rewritten at pack time), which is what carries the fix to
  installed CLIs.

### Also shipping in 0.2.0

Three fixes that landed on `master` after this release was prepared, and which have never
been on npm either — everything below 0.1.0 is still what users install:

- Removed a vulnerable `undici` dependency chain, with a `dependencies.test.ts` guard so it
  cannot creep back in. `@blockrun/llm` moves `^3.5.0` → `^3.9.0`.
- Hardened the CLI security boundaries (`cli.ts`, `chat.ts`, `x402.ts`, `dispatch.ts`, new
  `http.ts`, and `core/output.ts`).
- Made the HTTP timeout portable across Node versions.

### Release automation

- **Added `.github/workflows/publish.yml`.** The repo had no publish workflow, so shipping
  depended on someone remembering to run `npm publish` twice, in the right order, from a
  laptop — and twice nobody did. Publishing is now triggered by a GitHub release: core
  publishes first (the CLI's dependency range must be resolvable), then the CLI, each
  guarded by an "already published?" check so a re-run cannot double-publish, both with
  `--provenance`. Uses `pnpm publish`, not `npm publish`: only pnpm rewrites the
  `workspace:^` protocol into a real semver range, and `npm publish` would ship a literal
  `"@blockrun/core": "workspace:^"` that no consumer can install.

## 0.1.1 — 2026-07-17

- Fixed the globally installed `blockrun` executable: npm creates a symlink for
  package binaries, so the CLI now resolves that symlink before deciding whether
  it is the entry point. This prevents a global install from exiting silently.
- `blockrun version` now reports the installed CLI and core package versions at
  runtime instead of using hard-coded values.
- CI now verifies the actual packed npm artifact in a clean global-install
  prefix on Node 20, 22, and 24.

## 0.1.0 — 2026-07-09

Initial public release of `@blockrun/cli`.

- One wallet, one x402 payment path, and a machine-readable output contract.
- AI, multimodal, data, generic x402, spend-guardrail, and extension commands.
- Prefix-discovered sub-products such as `blockrun codex`.
