import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { limitsCmd, policyCmd, spendCmd, spendSummary, checkPolicy, categoryOf } from "../src/commands/policy.js";
import { skillsCmd, targetDir } from "../src/commands/skills.js";

let tmp: string;
const saved = { ...process.env };

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brun-policy-"));
});
beforeEach(() => {
  process.env.BLOCKRUN_HOME = tmp;
  process.env.BLOCKRUN_SKILLS_DIR = path.join(tmp, "agent-skills");
  fs.rmSync(path.join(tmp, ".blockrun"), { recursive: true, force: true });
  fs.rmSync(path.join(tmp, "agent-skills"), { recursive: true, force: true });
});
after(() => {
  process.env = saved;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const writeLedger = (entries: Array<{ ts: number; cost_usd: number }>) => {
  const dir = path.join(tmp, ".blockrun");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "cost_log.jsonl"), entries.map((e) => JSON.stringify(e)).join("\n"));
};

test("categoryOf maps commands to billing categories", () => {
  assert.equal(categoryOf("run"), "chat");
  assert.equal(categoryOf("image"), "image");
  assert.equal(categoryOf("rpc"), "data");
  assert.equal(categoryOf("pay"), "api");
  assert.equal(categoryOf("status"), "other");
});

test("limits set/allow/deny round-trip through policy show", () => {
  limitsCmd(["set", "--per-call", "0.5", "--daily", "20"]);
  limitsCmd(["deny", "video"]);
  const env = policyCmd(["show"]);
  assert.equal(env.ok, true);
  const d = env.ok ? (env.data as { policy: Record<string, unknown> }) : { policy: {} };
  assert.equal(d.policy.perCall, 0.5);
  assert.equal(d.policy.daily, 20);
  assert.deepEqual(d.policy.deny, ["video"]);
});

test("checkPolicy: deny blocks, allow whitelists, daily ceiling from real ledger", () => {
  limitsCmd(["deny", "video"]);
  assert.equal(checkPolicy("video").allowed, false);
  assert.equal(checkPolicy("run").allowed, true);

  limitsCmd(["allow", "chat"]);
  assert.equal(checkPolicy("image").allowed, false); // not whitelisted
  assert.equal(checkPolicy("run").allowed, true);

  // daily ceiling: today's spend $5 vs limit $3 → blocked
  policyCmd(["reset"]);
  limitsCmd(["set", "--daily", "3"]);
  writeLedger([{ ts: Date.now() / 1000, cost_usd: 5 }]);
  const gate = checkPolicy("run");
  assert.equal(gate.allowed, false);
  assert.match((gate as { reason: string }).reason, /daily limit/);
});

test("spendSummary buckets today/month/total", () => {
  const now = Date.now() / 1000;
  writeLedger([
    { ts: now - 60, cost_usd: 0.5 }, // today
    { ts: now - 40 * 86400, cost_usd: 2 }, // out of month
  ]);
  const s = spendSummary(now);
  assert.equal(s.today, 0.5);
  assert.equal(s.total, 2.5);
  const env = spendCmd(["today"]);
  assert.equal(env.ok && (env.data as { today: string }).today, "$0.5000");
});

test("invalid limit categories are rejected", () => {
  assert.equal(limitsCmd(["deny", "nonsense"]).ok, false);
});

test("skills list/add installs the bundled skill into the target dir", () => {
  const list = skillsCmd(["list"]);
  assert.equal(list.ok, true);
  const rows = list.ok ? (list.data as Array<{ name: string; installed: boolean }>) : [];
  assert.ok(rows.some((r) => r.name === "blockrun-cli" && !r.installed));

  const add = skillsCmd(["add"]);
  assert.equal(add.ok, true);
  assert.ok(fs.existsSync(path.join(targetDir(), "blockrun-cli", "SKILL.md")));
  const again = skillsCmd(["list"]);
  const rows2 = again.ok ? (again.data as Array<{ name: string; installed: boolean }>) : [];
  assert.equal(rows2.find((r) => r.name === "blockrun-cli")?.installed, true);

  assert.equal(skillsCmd(["add", "nope"]).ok, false);
});
