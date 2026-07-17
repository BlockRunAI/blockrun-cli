# Changelog

All notable changes to the BlockRun CLI are documented here.

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
