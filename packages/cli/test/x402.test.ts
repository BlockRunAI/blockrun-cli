import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveUrl } from "../src/commands/x402.js";
import { pkgFor, extList } from "../src/commands/ext.js";
import type { WhichFn } from "../src/dispatch.js";

test("resolveUrl: bare paths get the gateway prefix, full URLs pass through", () => {
  assert.equal(resolveUrl("v1/chat/completions"), "https://blockrun.ai/api/v1/chat/completions");
  assert.equal(resolveUrl("/v1/search"), "https://blockrun.ai/api/v1/search");
  assert.equal(resolveUrl("https://example.com/x402/thing"), "https://example.com/x402/thing");
  assert.equal(resolveUrl("http://127.0.0.1:8403/health"), "http://127.0.0.1:8403/health");
});

test("pkgFor: mapped aliases resolve, unknown falls back to @blockrun/<name>", () => {
  assert.equal(pkgFor("route"), "@blockrun/clawrouter");
  assert.equal(pkgFor("agent"), "@blockrun/franklin");
  assert.equal(pkgFor("codex"), "@blockrun/clawrouter-codex");
  assert.equal(pkgFor("somethingnew"), "@blockrun/somethingnew");
});

test("extList reports installed state from the which fn", () => {
  const which: WhichFn = (n) => (n === "blockrun-codex" ? "/bin/blockrun-codex" : null);
  const env = extList(which);
  assert.equal(env.ok, true);
  const rows = env.ok ? (env.data as Array<{ command: string; installed: boolean }>) : [];
  assert.equal(rows.find((r) => r.command === "codex")?.installed, true);
  assert.equal(rows.find((r) => r.command === "route")?.installed, false);
});
