import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolvePrivateKey,
  loadWallet,
  scanWallets,
  listDiscoveredWallets,
  adoptWallet,
  addressFromKey,
} from "../src/wallet.js";

// Well-known Hardhat accounts — deterministic key → address.
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

let tmp: string;
const savedEnv = { ...process.env };

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "blockrun-wallet-"));
  process.env.BLOCKRUN_HOME = tmp;
  delete process.env.BLOCKRUN_WALLET_KEY;
  delete process.env.BASE_CHAIN_WALLET_KEY;
});

after(() => {
  process.env = savedEnv;
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Each test starts from an empty home so ordering can't hide a regression. */
beforeEach(() => {
  for (const entry of fs.readdirSync(tmp)) {
    fs.rmSync(path.join(tmp, entry), { recursive: true, force: true });
  }
});

function writeSession(key: string): void {
  const dir = path.join(tmp, ".blockrun");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".session"), key);
}

/** Plant a provider wallet.json. `claimed` fakes the file's self-reported address. */
function writeProvider(dirName: string, key: string, claimed?: string): string {
  const dir = path.join(tmp, dirName);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "wallet.json");
  fs.writeFileSync(file, JSON.stringify({ privateKey: key, address: claimed ?? addressFromKey(key) }));
  return file;
}

test("no wallet → null", () => {
  assert.equal(resolvePrivateKey(process.env), null);
  assert.equal(loadWallet(process.env), null);
});

test("~/.blockrun/.session is read as source=session", () => {
  writeSession(KEY);
  const r = resolvePrivateKey(process.env);
  assert.equal(r?.source, "session");
  assert.equal(loadWallet(process.env)?.address, ADDR);
});

test("env key wins over the session file (source=env)", () => {
  writeSession(KEY);
  const r = resolvePrivateKey({ ...process.env, BLOCKRUN_WALLET_KEY: KEY });
  assert.equal(r?.source, "env");
});

test("normalizes a key without 0x prefix", () => {
  const r = resolvePrivateKey({ BLOCKRUN_WALLET_KEY: KEY.slice(2) } as NodeJS.ProcessEnv);
  assert.equal(r?.privateKey, KEY);
});

// --- Canonical wallet selection (blockrun-llm-ts#14) ---------------------------
//
// A provider wallet.json must never become the active wallet on its own. Before
// this was fixed, installing another product — or dropping a file into the home
// directory — silently redirected x402 payment signing.

test("a newer provider wallet.json does NOT displace .session", () => {
  writeSession(KEY);
  writeProvider(".agentcash", OTHER_KEY); // written after .session, so strictly newer

  const r = resolvePrivateKey(process.env);
  assert.equal(r?.source, "session");
  assert.equal(r?.privateKey, KEY);
  assert.equal(loadWallet(process.env)?.address, ADDR);
});

test("a provider wallet.json alone resolves to nothing, not to itself", () => {
  writeProvider(".agentcash", OTHER_KEY);

  assert.equal(resolvePrivateKey(process.env), null);
  assert.equal(loadWallet(process.env), null);
  // ...but it is still discoverable for a deliberate migration.
  assert.equal(listDiscoveredWallets().length, 1);
});

test("legacy wallet.key is still read when no .session exists", () => {
  const dir = path.join(tmp, ".blockrun");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "wallet.key"), KEY);
  writeProvider(".agentcash", OTHER_KEY);

  const r = resolvePrivateKey(process.env);
  assert.equal(r?.source, "legacy"); // legacy still beats a discovered wallet
});

// --- Planted address fields ---------------------------------------------------

test("scanWallets derives the address instead of trusting the file", () => {
  writeProvider(".evil", KEY, "0x000000000000000000000000000000000000dEaD");

  const [found] = scanWallets();
  assert.equal(found.address, ADDR);
  assert.notEqual(found.address, "0x000000000000000000000000000000000000dEaD");
});

test("a wallet.json with an unusable key is dropped entirely", () => {
  writeProvider(".broken", "not-a-key", ADDR);
  assert.deepEqual(scanWallets(), []);
  assert.deepEqual(listDiscoveredWallets(), []);
});

test("listDiscoveredWallets never returns private keys", () => {
  writeProvider(".agentcash", KEY);
  const [w] = listDiscoveredWallets();
  assert.equal(w.address, ADDR);
  assert.ok(!Object.prototype.hasOwnProperty.call(w, "privateKey"));
  assert.ok(w.source.endsWith("wallet.json"));
});

// --- Deliberate adoption ------------------------------------------------------

test("adoptWallet makes a discovered wallet active and backs up the old one", () => {
  writeSession(OTHER_KEY);
  writeProvider(".agentcash", KEY);

  const adopted = adoptWallet(ADDR);
  assert.equal(adopted.address, ADDR);
  assert.equal(adopted.source, "session");

  // It is now what resolution returns.
  assert.equal(resolvePrivateKey(process.env)?.privateKey, KEY);

  // The outgoing key survived, so its funds are not stranded.
  const backups = fs.readdirSync(path.join(tmp, ".blockrun")).filter((f) => f.startsWith(".session.backup-"));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(tmp, ".blockrun", backups[0]), "utf8").trim(), OTHER_KEY);
});

test("adoptWallet refuses an address no discovered key controls", () => {
  writeProvider(".evil", OTHER_KEY, ADDR); // file claims ADDR but holds a different key
  assert.throws(() => adoptWallet(ADDR), /No discovered wallet controls/);
  // ...and nothing was activated.
  assert.equal(resolvePrivateKey(process.env), null);
});

test("adoptWallet on an empty machine reports that nothing is available", () => {
  assert.throws(() => adoptWallet(ADDR), /Available: none/);
});
