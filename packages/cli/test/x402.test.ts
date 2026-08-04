import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveUrl, x402Fetch } from "../src/commands/x402.js";
import { fetchWithTimeout, readResponseText, writeResponseToFile } from "../src/http.js";
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

test("ext install/remove reject unsafe names", async () => {
  const { extInstall, extRemove } = await import("../src/commands/ext.js");
  for (const bad of ["../evil", "a b", "UPPER", "--flag", "@scope/x"]) {
    assert.equal(extInstall(bad).ok, false, `install should reject: ${bad}`);
    assert.equal(extRemove(bad).ok, false, `remove should reject: ${bad}`);
  }
});

test("extList reports installed state from the which fn", () => {
  const which: WhichFn = (n) => (n === "blockrun-codex" ? "/bin/blockrun-codex" : null);
  const env = extList(which);
  assert.equal(env.ok, true);
  const rows = env.ok ? (env.data as Array<{ command: string; installed: boolean }>) : [];
  assert.equal(rows.find((r) => r.command === "codex")?.installed, true);
  assert.equal(rows.find((r) => r.command === "route")?.installed, false);
});

test("x402 negotiation refuses redirects before reading a quote or signing", async () => {
  const original = globalThis.fetch;
  let redirect: RequestRedirect | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    redirect = init?.redirect;
    return new Response(null, { status: 302, headers: { location: "https://attacker.invalid/pay" } });
  }) as typeof fetch;
  try {
    const env = await x402Fetch("https://example.com/resource", { method: "GET" }, { quoteOnly: true });
    assert.equal(env.ok, false);
    assert.equal(!env.ok && env.error.type, "redirect");
    assert.equal(redirect, "manual");
  } finally {
    globalThis.fetch = original;
  }
});

test("bounded response readers reject oversized streamed bodies", async () => {
  await assert.rejects(() => readResponseText(new Response("12345"), 4), /exceeds 4 byte limit/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brun-http-"));
  const out = path.join(dir, "asset.bin");
  try {
    await assert.rejects(() => writeResponseToFile(new Response("12345"), out, 4), /exceeds 4 byte limit/);
    assert.equal(fs.existsSync(out), false);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("HTTP helper aborts requests at its deadline", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })) as typeof fetch;
  try {
    await assert.rejects(() => fetchWithTimeout("https://example.invalid", {}, 5), /timeout|aborted/i);
  } finally {
    globalThis.fetch = original;
  }
});
