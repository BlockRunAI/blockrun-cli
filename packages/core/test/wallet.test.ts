import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolvePrivateKey, loadWallet, scanWallets } from "../src/wallet.js";

// Well-known Hardhat account #0 — deterministic key → address.
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

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

test("no wallet → null", () => {
  assert.equal(resolvePrivateKey(process.env), null);
  assert.equal(loadWallet(process.env), null);
});

test("~/.blockrun/.session is read as source=session", () => {
  const dir = path.join(tmp, ".blockrun");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".session"), KEY);
  const r = resolvePrivateKey(process.env);
  assert.equal(r?.source, "session");
  assert.equal(loadWallet(process.env)?.address, ADDR);
});

test("env key wins over the session file (source=env)", () => {
  const r = resolvePrivateKey({ ...process.env, BLOCKRUN_WALLET_KEY: KEY });
  assert.equal(r?.source, "env");
});

test("provider wallet.json is scanned and wins over .session (source=provider)", () => {
  // ~/.someprovider/wallet.json under the isolated BLOCKRUN_HOME
  const provDir = path.join(tmp, ".agentcash");
  fs.mkdirSync(provDir, { recursive: true });
  fs.writeFileSync(path.join(provDir, "wallet.json"), JSON.stringify({ privateKey: KEY, address: ADDR }));
  assert.equal(scanWallets()[0]?.address, ADDR);
  const r = resolvePrivateKey(process.env); // no env → provider beats .session
  assert.equal(r?.source, "provider");
  // cleanup so later tests see the .session path again
  fs.rmSync(provDir, { recursive: true, force: true });
});

test("normalizes a key without 0x prefix", () => {
  const r = resolvePrivateKey({ BLOCKRUN_WALLET_KEY: KEY.slice(2) } as NodeJS.ProcessEnv);
  assert.equal(r?.privateKey, KEY);
});
