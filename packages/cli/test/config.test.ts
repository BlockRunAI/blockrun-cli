import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { chainCmd, configCmd, fundCmd } from "../src/commands/config.js";

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

let tmp: string;
const saved = { ...process.env };

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brun-cli-cfg-"));
});
beforeEach(() => {
  process.env.BLOCKRUN_HOME = tmp;
  delete process.env.BLOCKRUN_CHAIN;
  fs.rmSync(path.join(tmp, ".blockrun"), { recursive: true, force: true });
});
after(() => {
  process.env = saved;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const data = (e: ReturnType<typeof chainCmd>) => (e.ok ? (e.data as Record<string, unknown>) : e.error);

test("chain defaults to solana, persists sol, reads it back", () => {
  assert.equal(data(chainCmd())["chain"], "sol");
  assert.deepEqual(data(chainCmd("sol")), { chain: "sol", saved: true });
  assert.equal(data(chainCmd())["chain"], "sol"); // persisted in config.json
});

test("config set/get/list round-trips", () => {
  assert.deepEqual(data(configCmd(["list"])), {});
  configCmd(["set", "defaultModel", "openai/gpt-5.2"]);
  assert.equal(data(configCmd(["get", "defaultModel"]))["defaultModel"], "openai/gpt-5.2");
  assert.equal(data(configCmd(["list"]))["defaultModel"], "openai/gpt-5.2");
});

test("config get on a missing key errors", () => {
  const e = configCmd(["get", "nope"]);
  assert.equal(e.ok, false);
});

test("fund errors with no wallet, returns links with one", () => {
  assert.equal(fundCmd().ok, false); // no wallet yet
  const dir = path.join(tmp, ".blockrun");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".session"), KEY);
  const e = fundCmd();
  assert.equal(e.ok, true);
  const d = data(e);
  assert.equal(d["address"], ADDR);
  assert.match(String(d["basescan"]), /basescan\.org/);
  assert.match(String(d["eip681"]), /^ethereum:/);
});
