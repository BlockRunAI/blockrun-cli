/**
 * Config & path resolution shared by every BlockRun product.
 *
 * The whole point of `@blockrun/core` is that there is exactly ONE wallet and ONE
 * config location. Every product reads it through here, so `blockrun route` and a
 * standalone `clawrouter` are guaranteed to see the same wallet.
 *
 * `BLOCKRUN_HOME` overrides the base dir (tests, power users); otherwise ~/.blockrun.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type Chain = "base" | "sol";

export interface BlockrunConfig {
  chain?: Chain;
  [key: string]: unknown;
}

export function homeDir(): string {
  return process.env.BLOCKRUN_HOME || os.homedir();
}

export function blockrunDir(): string {
  return path.join(homeDir(), ".blockrun");
}

export interface Paths {
  dir: string;
  /** Primary EVM key store, matching @blockrun/llm. */
  session: string;
  /** Legacy key file kept for backward compatibility. */
  legacy: string;
  /** Solana key store. */
  solana: string;
  config: string;
  /** SDK cost ledger (one JSON CostEntry per line), written by @blockrun/llm. */
  costLog: string;
}

export function paths(): Paths {
  const dir = blockrunDir();
  return {
    dir,
    session: path.join(dir, ".session"),
    legacy: path.join(dir, "wallet.key"),
    solana: path.join(dir, ".solana"),
    config: path.join(dir, "config.json"),
    costLog: path.join(dir, "cost_log.jsonl"),
  };
}

function coerceChain(raw: string): Chain {
  const v = raw.toLowerCase();
  return v === "sol" || v === "solana" ? "sol" : "base";
}

/** Read the persisted config (~/.blockrun/config.json), or {} if none/invalid. */
export function readConfig(): BlockrunConfig {
  const p = paths().config;
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")) as BlockrunConfig;
  } catch {
    /* corrupt config — treat as empty */
  }
  return {};
}

/** Merge a patch into the persisted config and write it back. Returns the merged config. */
export function writeConfig(patch: BlockrunConfig): BlockrunConfig {
  const p = paths();
  const merged = { ...readConfig(), ...patch };
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.config, JSON.stringify(merged, null, 2));
  return merged;
}

/** Resolve the active payment chain: explicit flag > env > persisted config > new-user default (solana), preserving Base-only wallets. */
export function resolveChain(flag?: string): Chain {
  if (flag) return coerceChain(flag);
  if (process.env.BLOCKRUN_CHAIN) return coerceChain(process.env.BLOCKRUN_CHAIN);
  const cfg = readConfig();
  if (cfg.chain) return coerceChain(cfg.chain);
  const p = paths();
  for (const name of ["payment-chain", ".chain"]) {
    const file = path.join(p.dir, name);
    if (fs.existsSync(file)) return coerceChain(fs.readFileSync(file, "utf8").trim());
  }
  const base = process.env.BLOCKRUN_WALLET_KEY || process.env.BASE_CHAIN_WALLET_KEY || fs.existsSync(p.session) || fs.existsSync(p.legacy);
  const sol = process.env.SOLANA_WALLET_KEY || fs.existsSync(path.join(p.dir, ".solana-session")) || fs.existsSync(p.solana);
  return base && !sol ? "base" : "sol";
}
