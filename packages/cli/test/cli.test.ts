import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, runCore } from "../src/cli.js";

test("global flags before the command are consumed; rest is forwarded verbatim", () => {
  const p = parseArgs(["--json", "--chain", "sol", "route", "serve", "--port", "8787"]);
  assert.equal(p.format, "json");
  assert.equal(p.chain, "sol");
  assert.equal(p.command, "route");
  assert.deepEqual(p.rest, ["serve", "--port", "8787"]);
});

test("--format=value and --json both work", () => {
  assert.equal(parseArgs(["--format=table", "status"]).format, "table");
  assert.equal(parseArgs(["--json", "status"]).format, "json");
  assert.equal(parseArgs(["status"]).format, "pretty");
});

test("-v / --version map to the version command", () => {
  assert.equal(parseArgs(["-v"]).command, "version");
  assert.equal(parseArgs(["--version"]).command, "version");
});

test("flags AFTER the command are NOT consumed (forwarded to sub-product)", () => {
  const p = parseArgs(["route", "--json", "serve"]);
  assert.equal(p.command, "route");
  assert.equal(p.format, "pretty"); // the --json here belongs to clawrouter
  assert.deepEqual(p.rest, ["--json", "serve"]);
});

test("runCore version returns a versions envelope", () => {
  const env = runCore("version", parseArgs(["version"]));
  assert.equal(env.ok, true);
});
