/**
 * Wallet reading — the single source of truth.
 *
 * Resolution order deliberately mirrors @blockrun/llm's wallet.ts so that core and
 * the existing SDK read the SAME key. This is what lets us migrate products onto
 * core without ever creating a "second wallet":
 *   1. env  BLOCKRUN_WALLET_KEY  or  BASE_CHAIN_WALLET_KEY
 *   2. ~/.blockrun/.session
 *   3. ~/.blockrun/wallet.key   (legacy)
 *
 * The private key is only ever read locally and used to derive the address /
 * sign x402 payments — it is never sent to a server.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { paths, homeDir } from "./config.js";

export type WalletSource = "env" | "provider" | "session" | "legacy";

export interface ResolvedKey {
  privateKey: `0x${string}`;
  source: WalletSource;
}

export interface WalletInfo {
  address: `0x${string}`;
  privateKey: `0x${string}`;
  source: WalletSource;
}

function normalize(raw: string): `0x${string}` {
  const k = raw.trim();
  return (k.startsWith("0x") ? k : `0x${k}`) as `0x${string}`;
}

/** Derive the EVM address for a raw private key, or null if the key is invalid. */
export function addressFromKey(raw: string): `0x${string}` | null {
  try {
    return privateKeyToAccount(normalize(raw)).address;
  } catch {
    return null;
  }
}

/** Validate + persist an imported private key to ~/.blockrun/.session (mode 0600). */
export function importWallet(raw: string, opts: { force?: boolean } = {}): WalletInfo {
  const privateKey = normalize(raw);
  const account = privateKeyToAccount(privateKey); // throws on invalid key
  const p = paths();
  if (!opts.force && fs.existsSync(p.session)) {
    throw new Error("a wallet already exists at ~/.blockrun/.session — pass force to overwrite");
  }
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.session, privateKey, { mode: 0o600 });
  return { address: account.address, privateKey, source: "session" };
}

/**
 * Scan `~/.<dir>/wallet.json` files from any provider (agentcash, etc.), each
 * holding `{ privateKey, address }`, most-recently-modified first. Ported
 * verbatim from @blockrun/llm so the canonical resolution order is identical.
 */
export function scanWallets(): Array<{ privateKey: string; address: string }> {
  const home = homeDir();
  const results: Array<{ mtime: number; privateKey: string; address: string }> = [];
  try {
    for (const entry of fs.readdirSync(home, { withFileTypes: true })) {
      if (!entry.name.startsWith(".") || !entry.isDirectory()) continue;
      const walletFile = path.join(home, entry.name, "wallet.json");
      if (!fs.existsSync(walletFile)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(walletFile, "utf-8"));
        const pk = data.privateKey || "";
        const addr = data.address || "";
        if (pk && addr) results.push({ mtime: fs.statSync(walletFile).mtimeMs, privateKey: pk, address: addr });
      } catch {
        continue;
      }
    }
  } catch {
    /* ignore */
  }
  results.sort((a, b) => b.mtime - a.mtime);
  return results.map(({ privateKey, address }) => ({ privateKey, address }));
}

/** Resolve a key from files only (no env): provider wallet.json → .session → legacy. */
export function resolveFromFiles(): ResolvedKey | null {
  const scanned = scanWallets();
  if (scanned.length > 0) return { privateKey: normalize(scanned[0].privateKey), source: "provider" };
  const p = paths();
  if (fs.existsSync(p.session)) {
    const raw = fs.readFileSync(p.session, "utf8").trim();
    if (raw) return { privateKey: normalize(raw), source: "session" };
  }
  if (fs.existsSync(p.legacy)) {
    const raw = fs.readFileSync(p.legacy, "utf8").trim();
    if (raw) return { privateKey: normalize(raw), source: "legacy" };
  }
  return null;
}

/**
 * Find the private key, or null if none exists. Canonical BlockRun order,
 * matching @blockrun/llm's getOrCreateWallet:
 *   env (BLOCKRUN_WALLET_KEY|BASE_CHAIN_WALLET_KEY) → provider wallet.json → .session → legacy
 */
export function resolvePrivateKey(env: NodeJS.ProcessEnv = process.env): ResolvedKey | null {
  const fromEnv = env.BLOCKRUN_WALLET_KEY || env.BASE_CHAIN_WALLET_KEY;
  if (fromEnv && fromEnv.trim()) {
    return { privateKey: normalize(fromEnv), source: "env" };
  }
  return resolveFromFiles();
}

/** Load the full wallet (address + key + source), or null if no wallet exists yet. */
export function loadWallet(env: NodeJS.ProcessEnv = process.env): WalletInfo | null {
  const resolved = resolvePrivateKey(env);
  if (!resolved) return null;
  const account = privateKeyToAccount(resolved.privateKey);
  return { address: account.address, privateKey: resolved.privateKey, source: resolved.source };
}

/** Create + persist a new EVM wallet to ~/.blockrun/.session (mode 0600). */
export function createWallet(): WalletInfo {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const p = paths();
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.session, privateKey, { mode: 0o600 });
  return { address: account.address, privateKey, source: "session" };
}
