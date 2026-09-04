import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { accountFetch, clearApiKey, resolveApiKey, saveApiKey } from "../src/auth.js";
const old = { ...process.env }; const home = fs.mkdtempSync(path.join(os.tmpdir(), "blockrun-auth-"));
beforeEach(() => { process.env = { ...old, BLOCKRUN_HOME: home }; delete process.env.BLOCKRUN_API_KEY; delete process.env.BLOCKRUN_API_BASE_URL; fs.rmSync(path.join(home,".blockrun"), {recursive:true,force:true}); });
after(() => { process.env = old; fs.rmSync(home,{recursive:true,force:true}); });
test("saved account key uses 0600 shared file and env takes precedence", () => {
  saveApiKey("brk_live_saved_key");
  assert.deepEqual(resolveApiKey(), {key:"brk_live_saved_key",source:"core"});
  assert.equal(fs.statSync(path.join(home,".blockrun",".api-key")).mode & 0o777, 0o600);
  process.env.BLOCKRUN_API_KEY="brk_live_env_key"; assert.equal(resolveApiKey()?.source,"env");
  assert.equal(clearApiKey().envStillSet,true);
});
test("malformed env key refuses wallet fallback", () => { process.env.BLOCKRUN_API_KEY="bad"; assert.throws(resolveApiKey,/Invalid/); });
test("account fetch binds credentials to configured origin, strips payment, and refuses redirects", async () => {
  process.env.BLOCKRUN_API_KEY="brk_live_account_key"; process.env.BLOCKRUN_API_BASE_URL="http://127.0.0.1:43123";
  const original=globalThis.fetch; let seen: RequestInit|undefined;
  globalThis.fetch=async (_url,init) => { seen=init; return new Response("{}",{status:200}); };
  try { await accountFetch("/v1/models",{headers:{"payment-signature":"bad"}}); const h=new Headers(seen?.headers); assert.equal(h.get("authorization"),"Bearer brk_live_account_key"); assert.equal(h.has("payment-signature"),false); assert.equal(seen?.redirect,"error"); await assert.rejects(accountFetch("https://evil.example/v1/models"),/another origin/); } finally { globalThis.fetch=original; }
});
