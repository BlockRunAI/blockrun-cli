import { test } from "node:test";
import assert from "node:assert/strict";
import { ok, err, render, emit } from "../src/output.js";

test("ok() builds the success envelope", () => {
  assert.deepEqual(ok({ a: 1 }), { ok: true, data: { a: 1 } });
  assert.deepEqual(ok(1, { cost: 0.003, chain: "base" }), {
    ok: true,
    data: 1,
    meta: { cost: 0.003, chain: "base" },
  });
});

test("err() builds the error envelope with optional code", () => {
  assert.deepEqual(err("payment", "boom"), { ok: false, error: { type: "payment", message: "boom" } });
  assert.deepEqual(err("payment", "402", 402), {
    ok: false,
    error: { type: "payment", code: 402, message: "402" },
  });
});

test("render json is exactly the envelope", () => {
  const env = ok({ address: "0xabc" }, { cost: 0.01 });
  assert.equal(render(env, "json"), JSON.stringify(env));
});

test("render pretty formats objects as key: value and errors with ✗", () => {
  assert.equal(render(ok({ address: "0xabc", source: "session" }), "pretty"), "address: 0xabc\nsource: session");
  assert.equal(render(err("wallet", "not found", 404), "pretty"), "✗ wallet [404]: not found");
});

test("render ndjson streams array rows", () => {
  assert.equal(render(ok([{ a: 1 }, { a: 2 }]), "ndjson"), '{"a":1}\n{"a":2}');
});

test("emit writes ok→stdout exit 0, err→stderr exit 1", () => {
  let out = "";
  let errOut = "";
  let code = -1;
  const opts = {
    format: "json" as const,
    stdout: (s: string) => (out = s),
    stderr: (s: string) => (errOut = s),
    setExitCode: (n: number) => (code = n),
  };
  emit(ok({ x: 1 }), opts);
  assert.equal(out, '{"ok":true,"data":{"x":1}}');
  assert.equal(code, 0);

  emit(err("net", "down"), opts);
  assert.equal(errOut, '{"ok":false,"error":{"type":"net","message":"down"}}');
  assert.equal(code, 1);
});
