/**
 * Config, chain, and funding — sync core-backed commands (no network).
 */

import {
  ok,
  err,
  loadWallet,
  readConfig,
  writeConfig,
  resolveChain,
  type Envelope,
  type Chain,
} from "@blockrun/core";

/** `blockrun chain [base|sol]` — show or persist the active payment chain. */
export function chainCmd(arg?: string): Envelope {
  if (!arg) return ok({ chain: resolveChain() });
  const chain: Chain = arg.toLowerCase().startsWith("sol") ? "sol" : "base";
  writeConfig({ chain });
  return ok({ chain, saved: true });
}

/** `blockrun config <list|get|set> [key] [value]` — persisted at ~/.blockrun/config.json. */
export function configCmd(rest: string[]): Envelope {
  const [action, key, ...valueParts] = rest;
  const cfg = readConfig();
  if (!action || action === "list") return ok(cfg);
  if (action === "get") {
    return key in cfg ? ok({ [key]: cfg[key] }) : err("config", `no such key: ${key}`, 404);
  }
  if (action === "set") {
    if (!key || valueParts.length === 0) return err("usage", "usage: blockrun config set <key> <value>", 400);
    const merged = writeConfig({ [key]: valueParts.join(" ") });
    return ok({ [key]: merged[key], saved: true });
  }
  return err("usage", `unknown config action: ${action} (use list|get|set)`, 400);
}

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** `blockrun fund` — show the address + funding links for the active wallet. */
export function fundCmd(): Envelope {
  const w = loadWallet();
  if (!w) return err("wallet", "No wallet found. Run `blockrun wallet create`.", 404);
  return ok({
    address: w.address,
    fundWith: "USDC on Base (chain 8453)",
    basescan: `https://basescan.org/address/${w.address}`,
    // EIP-681: prompt a 10 USDC transfer (6 decimals) in a scanning wallet.
    eip681: `ethereum:${USDC_BASE}@8453/transfer?address=${w.address}&uint256=10000000`,
  });
}
