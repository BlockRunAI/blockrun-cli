import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs"; import * as os from "node:os"; import * as path from "node:path";
import { parseArgs, runCore, runCoreCommand } from "../src/cli.js";
const old={...process.env};const home=fs.mkdtempSync(path.join(os.tmpdir(),"cli-api-"));
beforeEach(()=>{process.env={...old,BLOCKRUN_HOME:home};delete process.env.BLOCKRUN_API_KEY;fs.rmSync(path.join(home,".blockrun"),{recursive:true,force:true});});
after(()=>{process.env=old;fs.rmSync(home,{recursive:true,force:true});});
test("login requires stdin, status is account-aware, logout removes saved key",async()=>{
 let a=parseArgs(["login","--stdin"]);assert.equal(runCore("login",a,{readStdin:()=>"brk_live_cli_saved"}).ok,true);
 a=parseArgs(["status"]);const status=runCore("status",a);assert.equal(status.ok&&status.data.authMode,"api-key");
 a=parseArgs(["logout"]);assert.equal(runCore("logout",a).ok,true);assert.equal(runCore("status",parseArgs(["status"])).ok,true);
});
test("account API path sends one Bearer request and preserves 429 Retry-After",async()=>{
 process.env.BLOCKRUN_API_KEY="brk_live_cli_test";process.env.BLOCKRUN_API_BASE_URL="http://localhost:45123";const orig=globalThis.fetch;let calls=0;
 globalThis.fetch=async (_u,init)=>{calls++;assert.equal(new Headers(init?.headers).get("authorization"),"Bearer brk_live_cli_test");return new Response('{"error":{"message":"quota"}}',{status:429,headers:{"retry-after":"5"}})};
 try{const e=await runCoreCommand("api",parseArgs(["api","GET","v1/models"]));assert.equal(e.ok,false);assert.equal(!e.ok&&e.error.code,429);assert.equal(!e.ok&&e.error.retryAfter,"5");assert.equal(calls,1);}finally{globalThis.fetch=orig;}
});
