# @blockrun/core roadmap

## Wallet registry

BlockRun products currently share one active Base wallet through
`~/.blockrun/.session`. Wallet discovery and timestamped backups support safe
migration and recovery, but they are not a selectable multi-wallet account
list. Solana storage also needs to be consolidated behind the same Core API;
some existing products still use legacy product-specific formats and paths.

### Compatibility foundation

- Make Core the owner of both Base and Solana wallet creation, loading,
  validation, migration, backup, and signing-key resolution.
- Standardize the canonical Solana key path and format while reading existing
  `.solana`, `.solana-session`, and supported product-specific legacy files.
- Copy legacy keys only when the canonical destination is missing; never
  overwrite a valid Core wallet automatically.
- Expose public wallet metadata separately from private signing material so
  desktop and web renderers never receive secrets.
- Keep the default payment network independent from wallet identity.

### Multiple wallets per network

- Add a versioned Core-owned registry of named wallet accounts.
- Maintain an explicit active-wallet pointer for each network.
- Provide create, import, rename, select, archive, and recovery APIs shared by
  ClawRouter, Franklin, the BlockRun CLI, MCP, and SDK consumers.
- Migrate the existing `.session` and Solana wallet without changing their
  addresses or stranding funds.
- Convert outgoing timestamped backups into discoverable recovery entries.
- Make wallet selection atomic and report whether a running consumer must
  restart before the selected wallet becomes active.
- Add cross-product compatibility tests for Base, Solana, legacy customers,
  and concurrent readers.

Until the registry is implemented, product interfaces must describe Base /
Solana selection as a **payment network switch**, not as switching between
wallet accounts on the same network.
