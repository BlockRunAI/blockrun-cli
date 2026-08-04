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
 * Wallets belonging to OTHER applications (`~/.<app>/wallet.json`) are discoverable
 * but are never resolved automatically. Installing another product must not silently
 * change which key BlockRun signs payments with, and a wallet file dropped into a
 * home directory must not be able to redirect spending to an address the user does
 * not control. Adoption is always a deliberate act — see `adoptWallet()`.
 *
 * The private key is only ever read locally and used to derive the address /
 * sign x402 payments — it is never sent to a server.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { paths, homeDir } from "./config.js";

/**
 * Where a resolved key came from.
 *
 * There is deliberately no `provider` member: a discovered provider wallet is
 * never the result of resolution. Adopting one copies it into `.session`, so from
 * then on it resolves as `session`.
 */
export type WalletSource = "env" | "session" | "legacy";

export interface ResolvedKey {
  privateKey: `0x${string}`;
  source: WalletSource;
}

export interface WalletInfo {
  address: `0x${string}`;
  privateKey: `0x${string}`;
  source: WalletSource;
}

/** A wallet found in another application's directory. Never active until adopted. */
export interface DiscoveredWallet {
  /** Address derived from the discovered key — never the file's `address` field. */
  address: `0x${string}`;
  /** Absolute path of the `wallet.json` it came from. */
  source: string;
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
 * holding `{ privateKey, address }`, most-recently-modified first.
 *
 * The returned `address` is derived from the discovered private key, NOT read from
 * the file's `address` field — a wallet file cannot claim an address it holds no
 * key for. Entries whose key is missing or unusable are dropped entirely.
 *
 * Nothing here is active. This is discovery for an explicit migration flow only;
 * it must never influence automatic resolution.
 */
export function scanWallets(): Array<{ privateKey: string; address: `0x${string}`; source: string }> {
  const home = homeDir();
  const results: Array<{ mtime: number; privateKey: string; address: `0x${string}`; source: string }> = [];
  try {
    for (const entry of fs.readdirSync(home, { withFileTypes: true })) {
      if (!entry.name.startsWith(".") || !entry.isDirectory()) continue;
      const walletFile = path.join(home, entry.name, "wallet.json");
      if (!fs.existsSync(walletFile)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(walletFile, "utf-8"));
        const pk = data.privateKey || "";
        if (!pk) continue;
        const derived = addressFromKey(pk);
        if (!derived) continue;
        results.push({ mtime: fs.statSync(walletFile).mtimeMs, privateKey: pk, address: derived, source: walletFile });
      } catch {
        continue;
      }
    }
  } catch {
    /* ignore */
  }
  results.sort((a, b) => b.mtime - a.mtime);
  return results.map(({ privateKey, address, source }) => ({ privateKey, address, source }));
}

/**
 * List wallets belonging to other applications, safe to show to a user.
 *
 * Same discovery as `scanWallets()` but without private keys, so it can be printed
 * or returned over a boundary. Adopt one deliberately with `adoptWallet()`.
 */
export function listDiscoveredWallets(): DiscoveredWallet[] {
  return scanWallets().map(({ address, source }) => ({ address, source }));
}

/**
 * Adopt a discovered wallet by address, making it the active BlockRun wallet.
 *
 * This is the deliberate migration path that automatic resolution refuses to take.
 * Matching is done against the address *derived from each discovered key*, so a
 * wallet file claiming someone else's address can never be selected by it.
 *
 * The outgoing `~/.blockrun/.session` is backed up beside itself before being
 * overwritten, so adopting a wallet cannot strand funds in the old one.
 *
 * @param address Address to adopt, as listed by `listDiscoveredWallets()`
 * @throws If no discovered wallet derives to that address
 */
export function adoptWallet(address: string): WalletInfo {
  const wanted = address.trim().toLowerCase();
  const p = paths();

  for (const entry of scanWallets()) {
    if (entry.address.toLowerCase() !== wanted) continue;

    const privateKey = normalize(entry.privateKey);

    // Preserve the outgoing wallet — it may hold funds.
    if (fs.existsSync(p.session)) {
      const current = fs.readFileSync(p.session, "utf8").trim();
      if (current && normalize(current) !== privateKey) {
        const backup = path.join(p.dir, `.session.backup-${Math.floor(Date.now() / 1000)}`);
        fs.writeFileSync(backup, current, { mode: 0o600 });
      }
    }

    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(p.session, privateKey, { mode: 0o600 });
    return { address: entry.address, privateKey, source: "session" };
  }

  const available = listDiscoveredWallets().map((w) => w.address);
  throw new Error(
    `No discovered wallet controls ${address}. ` +
      `Available: ${available.length ? available.join(", ") : "none"}`
  );
}

/**
 * Resolve a key from files only (no env): `.session` → legacy.
 *
 * Provider `wallet.json` files are deliberately NOT consulted. The canonical
 * BlockRun wallet always wins; another application's wallet is adopted only
 * through `adoptWallet()`.
 */
export function resolveFromFiles(): ResolvedKey | null {
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
 *   env (BLOCKRUN_WALLET_KEY|BASE_CHAIN_WALLET_KEY) → .session → legacy
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
