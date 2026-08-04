import { test } from "node:test";
import assert from "node:assert/strict";
import { planDispatch, CORE_COMMANDS, type WhichFn } from "../src/dispatch.js";

const never: WhichFn = () => null;
const findsAll: WhichFn = (name) => `/usr/local/bin/${name}`;

test("core commands are handled by the umbrella, never forwarded", () => {
  for (const c of ["status", "wallet", "balance", "run"]) {
    assert.deepEqual(planDispatch(c, [], findsAll), { kind: "core", command: c });
  }
});

test("route resolves to clawrouter when installed, with args forwarded", () => {
  const which: WhichFn = (n) => (n === "clawrouter" ? "/usr/local/bin/clawrouter" : null);
  const plan = planDispatch("route", ["serve", "--port", "8787"], which);
  assert.deepEqual(plan, {
    kind: "run",
    command: "route",
    bin: "/usr/local/bin/clawrouter",
    args: ["serve", "--port", "8787"],
  });
});

test("generic blockrun-<x> discovery is tried first", () => {
  const which: WhichFn = (n) => (n === "blockrun-route" ? "/opt/blockrun-route" : null);
  const plan = planDispatch("route", [], which);
  assert.equal(plan.kind, "run");
  assert.equal((plan as { bin: string }).bin, "/opt/blockrun-route");
});

test("unknown-but-mapped command → missing with install hint", () => {
  const plan = planDispatch("agent", ["do", "thing"], never);
  assert.equal(plan.kind, "missing");
  assert.equal((plan as { pkg: string }).pkg, "@blockrun/franklin");
  assert.ok((plan as { candidates: string[] }).candidates.includes("blockrun-agent"));
});

test("totally unknown command → missing with no known pkg", () => {
  const plan = planDispatch("wat", [], never);
  assert.equal(plan.kind, "missing");
  assert.equal((plan as { pkg: string | null }).pkg, null);
});

test("CORE_COMMANDS cannot be shadowed by a sub-product name", () => {
  assert.ok(CORE_COMMANDS.has("status"));
  // even if an executable exists, a core command stays core
  assert.equal(planDispatch("status", [], findsAll).kind, "core");
});

test("path-shaped subcommands are rejected before executable lookup", () => {
  let lookups = 0;
  const which: WhichFn = () => {
    lookups++;
    return "/bin/sh";
  };
  for (const bad of ["x/../../../../bin/sh", "../tool", "/bin/sh", "a\\..\\tool", "UPPER", "--flag"]) {
    assert.deepEqual(planDispatch(bad, [], which), { kind: "invalid", command: bad });
  }
  assert.equal(lookups, 0);
  assert.equal(planDispatch("safe-tool", [], never).kind, "missing");
});
