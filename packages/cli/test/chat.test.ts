import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { chatRepl, type ChatClient } from "../src/commands/chat.js";

function capture(write: (text: string) => void): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      write(String(chunk));
      callback();
    },
  });
}

test("chat serializes turns, rechecks policy, and escapes remote terminal controls", async () => {
  let calls = 0;
  let checks = 0;
  let stdout = "";
  let stderr = "";
  const client: ChatClient = {
    async chatCompletion() {
      calls++;
      return { choices: [{ message: { content: "ok\u001b]52;c;bad\u0007" } }], usage: { total_cost: 0.1 } };
    },
  };

  const code = await chatRepl("paid/model\u001b]52;c;bad\u0007", {
    client,
    input: Readable.from(["first\nsecond\n/exit\n"]),
    output: capture((text) => (stdout += text)),
    error: capture((text) => (stderr += text)),
    policyCheck: () => (++checks === 1 ? { allowed: true } : { allowed: false, reason: "daily limit reached" }),
  });

  assert.equal(code, 0);
  assert.equal(calls, 1);
  assert.equal(checks, 2);
  assert.match(stderr, /daily limit reached/);
  assert.doesNotMatch(stdout, /[\u001b\u0007]/);
  assert.match(stdout, /\\u001b.*\\u0007/);
});
