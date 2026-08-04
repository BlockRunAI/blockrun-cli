import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { splitFlags, imageCmd, videoCmd, speechCmd, realfaceCmd } from "../src/commands/media.js";
import { searchCmd, predictCmd, rpcCmd, priceCmd } from "../src/commands/data.js";
import { runCoreCommand, parseArgs } from "../src/cli.js";

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const KEY_B = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ADDR_B = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

let tmp: string;
const saved = { ...process.env };

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brun-cmds-"));
  process.env.BLOCKRUN_HOME = tmp;
  delete process.env.BLOCKRUN_WALLET_KEY;
  delete process.env.BASE_CHAIN_WALLET_KEY;
});
after(() => {
  process.env = saved;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("splitFlags separates words, --flag value, --flag=value, and bare --flag", () => {
  const { words, flags } = splitFlags(["a", "--model", "m1", "b", "--size=512x512", "--free"]);
  assert.deepEqual(words, ["a", "b"]);
  assert.deepEqual(flags, { model: "m1", size: "512x512", free: true });
});

test("usage errors fire before any network/wallet work", async () => {
  for (const env of [
    await imageCmd([]),
    await videoCmd([]),
    await speechCmd([]),
    await realfaceCmd(["enroll"]),
    await searchCmd([]),
    await predictCmd([]),
    await rpcCmd([]),
    await priceCmd([]),
  ]) {
    assert.equal(env.ok, false);
    assert.match((env as { error: { type: string } }).error.type, /usage|wallet/);
  }
});

test("wallet import → recover → export --yes round-trip", async () => {
  const args = (rest: string[]) => ({ ...parseArgs(["wallet", ...rest]), rest });

  const imp = await runCoreCommand("wallet", args(["import", KEY]));
  assert.deepEqual(imp.ok && imp.data, { address: ADDR, imported: true });

  // second import without --force refuses (409)
  const dup = await runCoreCommand("wallet", args(["import", KEY_B]));
  assert.equal(dup.ok, false);

  // --force overwrites
  const forced = await runCoreCommand("wallet", args(["import", KEY_B, "--force"]));
  assert.deepEqual(forced.ok && forced.data, { address: ADDR_B, imported: true });

  // export requires --yes
  const noYes = await runCoreCommand("wallet", args(["export"]));
  assert.equal(noYes.ok, false);
  const yes = await runCoreCommand("wallet", args(["export", "--yes"]));
  assert.equal(yes.ok && (yes.data as { privateKey: string }).privateKey, KEY_B);

  // recover lists the session wallet
  const rec = await runCoreCommand("wallet", args(["recover"]));
  assert.equal(rec.ok, true);
  const rows = rec.ok ? (rec.data as Array<{ source: string; address: string }>) : [];
  assert.ok(rows.some((r) => r.source === "session" && r.address === ADDR_B));
});

test("a discovered provider wallet is listed but never active until adopted", async () => {
  const args = (rest: string[]) => ({ ...parseArgs(["wallet", ...rest]), rest });
  // Session currently holds KEY_B/ADDR_B from the round-trip above.
  const provDir = path.join(tmp, ".agentcash");
  fs.mkdirSync(provDir, { recursive: true });
  fs.writeFileSync(path.join(provDir, "wallet.json"), JSON.stringify({ privateKey: KEY, address: ADDR }));

  // `wallet` still reports the canonical session wallet, not the newer provider file.
  const active = await runCoreCommand("wallet", args([]));
  assert.equal(active.ok && (active.data as { address: string }).address, ADDR_B);

  // `wallet list` surfaces it, explicitly inactive.
  const listed = await runCoreCommand("wallet", args(["list"]));
  const found = listed.ok ? (listed.data as Array<{ address: string; active: boolean }>) : [];
  assert.deepEqual(
    found.map((w) => [w.address, w.active]),
    [[ADDR, false]]
  );

  // `recover` marks session active and the provider entry not.
  const rec = await runCoreCommand("wallet", args(["recover"]));
  const rows = rec.ok ? (rec.data as Array<{ source: string; address: string; active: boolean }>) : [];
  assert.equal(rows.find((r) => r.source === "session")?.active, true);
  assert.equal(rows.find((r) => r.source.startsWith("provider"))?.active, false);
  assert.equal(rec.ok && rec.meta?.active, "session");

  // Adoption is the deliberate act that switches it.
  const adopted = await runCoreCommand("wallet", args(["adopt", ADDR]));
  assert.deepEqual(adopted.ok && adopted.data, { address: ADDR, adopted: true });
  const after = await runCoreCommand("wallet", args([]));
  assert.equal(after.ok && (after.data as { address: string }).address, ADDR);
});

test("wallet adopt refuses an address no discovered key controls", async () => {
  const args = (rest: string[]) => ({ ...parseArgs(["wallet", ...rest]), rest });
  const evil = path.join(tmp, ".evil");
  fs.mkdirSync(evil, { recursive: true });
  // Claims ADDR_B, but holds a key that derives to ADDR.
  fs.writeFileSync(path.join(evil, "wallet.json"), JSON.stringify({ privateKey: KEY, address: ADDR_B }));

  const res = await runCoreCommand("wallet", args(["adopt", ADDR_B]));
  assert.equal(res.ok, false);
});
