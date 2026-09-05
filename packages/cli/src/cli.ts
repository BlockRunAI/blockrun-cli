#!/usr/bin/env node
/**
 * `blockrun` — the umbrella CLI.
 *
 * Owns wallet/status/etc. directly (via @blockrun/core) and forwards everything
 * else to independently-installed `blockrun-*` sub-products. One wallet, one
 * output contract, one set of global flags.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  loadWallet,
  resolveApiKey, accountStatus, saveApiKey, clearApiKey, PORTAL_URL,
  createWallet,
  importWallet,
  adoptWallet,
  listDiscoveredWallets,
  addressFromKey,
  resolveChain,
  paths,
  ok,
  err,
  emit,
  type OutputFormat,
  type Envelope,
} from "@blockrun/core";
import { planDispatch, makeWhich } from "./dispatch.js";
import { runCmd, modelsCmd, balanceCmd, doctorCmd } from "./commands/sdk.js";
import { chainCmd, configCmd, fundCmd } from "./commands/config.js";
import { imageCmd, videoCmd, musicCmd, speechCmd, realfaceCmd } from "./commands/media.js";
import { searchCmd, researchCmd, predictCmd, cryptoCmd, priceCmd, rpcCmd, discoverCmd } from "./commands/data.js";
import { chatRepl } from "./commands/chat.js";
import { extCmd, upgradeCmd } from "./commands/ext.js";
import { apiCmd, payCmd } from "./commands/x402.js";
import { limitsCmd, policyCmd, spendCmd, checkPolicy, categoryOf } from "./commands/policy.js";
import { skillsCmd } from "./commands/skills.js";

const FORMATS = new Set<OutputFormat>(["json", "pretty", "table", "ndjson", "csv"]);

export interface ParsedArgs {
  command?: string;
  rest: string[];
  format: OutputFormat;
  chain?: string;
  profile?: string;
}

export interface CoreRuntime {
  readStdin?: () => string;
}

/** Global flags are parsed only BEFORE the command; everything after is forwarded verbatim. */
export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { rest: [], format: "pretty" };
  let i = 0;
  for (; i < argv.length; i++) {
    const tok = argv[i];
    if (parsed.command) break;
    if (tok === "--json") parsed.format = "json";
    else if (tok === "--format") parsed.format = coerceFormat(argv[++i]);
    else if (tok.startsWith("--format=")) parsed.format = coerceFormat(tok.slice(9));
    else if (tok === "--chain") parsed.chain = argv[++i];
    else if (tok.startsWith("--chain=")) parsed.chain = tok.slice(8);
    else if (tok === "--profile") parsed.profile = argv[++i];
    else if (tok.startsWith("--profile=")) parsed.profile = tok.slice(10);
    else if (tok === "-v" || tok === "--version") parsed.command = "version";
    else if (tok === "-h" || tok === "--help") parsed.command = "help";
    else parsed.command = tok;
  }
  parsed.rest = argv.slice(i);
  return parsed;
}

function coerceFormat(v: string | undefined): OutputFormat {
  return v && FORMATS.has(v as OutputFormat) ? (v as OutputFormat) : "pretty";
}

function mask(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/** Derive an address from a raw key without throwing (for `wallet recover`). */
function safeAddr(raw: string): string {
  return addressFromKey(raw) ?? "(unreadable key)";
}

/** Read a package version at runtime via real module resolution (works installed & in dev). */
function pkgVersion(name: string): string {
  try {
    if (name === "@blockrun/cli") {
      // Own package.json sits one level above dist/ in the tarball.
      return (JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string })
        .version;
    }
    const require = createRequire(import.meta.url);
    return (require(`${name}/package.json`) as { version: string }).version;
  } catch {
    return "unknown";
  }
}

/** Runs a command and returns the envelope (side-effect-free core logic, for tests). */
export function runCore(command: string, args: ParsedArgs, runtime: CoreRuntime = {}): Envelope {
  const chain = resolveChain(args.chain);
  switch (command) {
    case "status": {
      const account = accountStatus();
      if (account) return ok(account);
      const w = loadWallet();
      if (!w) return ok({ wallet: null, chain, hint: "No wallet yet — run `blockrun wallet create`." });
      return ok({ address: mask(w.address), source: w.source, chain });
    }
    case "login": {
      if (args.rest.length !== 1 || args.rest[0] !== "--stdin") return err("usage", "usage: blockrun login --stdin (pipe the API key; never put it in command arguments)", 400);
      try {
        saveApiKey((runtime.readStdin ?? (() => fs.readFileSync(0, "utf8")))());
        return ok({ saved: true, account: PORTAL_URL, envOverridesSavedKey: process.env.BLOCKRUN_API_KEY !== undefined });
      } catch (e) { return err("auth", (e as Error).message, 400); }
    }
    case "logout": return ok(clearApiKey(), { hint: "Saved shared account key removed. Unset BLOCKRUN_API_KEY if it is still present in your shell." });
    case "wallet": {
      const sub = args.rest[0];
      if (sub === "create") {
        const w = createWallet();
        return ok({ address: w.address, source: w.source, created: true });
      }
      if (sub === "import") {
        const inline = args.rest.slice(1).find((value) => !value.startsWith("--"))?.trim() ?? "";
        if (inline) {
          return err("usage", "refusing private key in command arguments — pipe it to `wallet import --stdin`", 400);
        }
        if (!args.rest.includes("--stdin")) {
          return err("usage", "usage: blockrun wallet import --stdin [--force] (pipe the key on stdin)", 400);
        }
        const raw = (runtime.readStdin ?? (() => fs.readFileSync(0, "utf8")))().trim();
        if (!raw) return err("usage", "no private key received on stdin", 400);
        try {
          const w = importWallet(raw, { force: args.rest.includes("--force") });
          return ok({ address: w.address, imported: true });
        } catch (e) {
          const msg = (e as Error).message;
          return err("wallet", msg, msg.includes("already exists") ? 409 : 400);
        }
      }
      if (sub === "export") {
        const w = loadWallet();
        if (!w) return err("wallet", "No wallet found.", 404);
        if (!args.rest.includes("--yes")) {
          return err("confirm", "this prints your PRIVATE KEY — re-run with --yes to confirm", 428);
        }
        return ok({ address: w.address, privateKey: w.privateKey, source: w.source });
      }
      if (sub === "list") {
        // Wallets belonging to other applications. None of these are active.
        const discovered = listDiscoveredWallets();
        if (!discovered.length) return err("wallet", "no wallets discovered from other applications", 404);
        return ok(
          discovered.map((w) => ({ address: w.address, source: w.source, active: false })),
          { hint: "adopt one deliberately with `blockrun wallet adopt <address>`" }
        );
      }
      if (sub === "adopt") {
        const address = args.rest[1]?.trim();
        if (!address) return err("usage", "usage: blockrun wallet adopt <address>", 400);
        try {
          const w = adoptWallet(address);
          return ok({ address: w.address, adopted: true }, { hint: "previous wallet backed up in ~/.blockrun/" });
        } catch (e) {
          return err("wallet", (e as Error).message, 404);
        }
      }
      if (sub === "recover") {
        // Every key on this machine, in true resolution order. Only env/session/legacy
        // can ever be active; discovered provider wallets are shown but never selected.
        const found: Array<Record<string, string | boolean>> = [];
        const env = process.env.BLOCKRUN_WALLET_KEY || process.env.BASE_CHAIN_WALLET_KEY;
        if (env) found.push({ source: "env", address: safeAddr(env) });
        const p = paths();
        for (const [src, file] of [["session", p.session], ["legacy", p.legacy]] as const) {
          if (fs.existsSync(file)) found.push({ source: src, address: safeAddr(fs.readFileSync(file, "utf8").trim()) });
        }
        // The resolver stops at the first of the above; everything after is inactive.
        const activeSource = found.length ? (found[0].source as string) : null;
        for (const [i, entry] of found.entries()) entry.active = i === 0;
        for (const w of listDiscoveredWallets()) {
          found.push({ source: `provider wallet.json (${w.source})`, address: w.address, active: false });
        }
        if (!found.length) return err("wallet", "no recoverable wallets found (env, session, legacy, provider)", 404);
        return ok(found, {
          active: activeSource,
          ...(activeSource ? {} : { hint: "no active wallet — run `blockrun wallet create` or `wallet adopt <address>`" }),
        });
      }
      const w = loadWallet();
      if (!w) return err("wallet", "No wallet found. Run `blockrun wallet create`.", 404);
      return ok({ address: w.address, source: w.source });
    }
    case "version":
      return ok({ cli: pkgVersion("@blockrun/cli"), core: pkgVersion("@blockrun/core") });
    default:
      return err("usage", `Unknown core command: ${command}`, 400);
  }
}

const HELP = `blockrun — one entry point for every BlockRun product

Usage: blockrun [--json|--format <f>] [--chain sol|base] <command> [args]

Account & wallet status
  login --stdin          save an account API key (or set BLOCKRUN_API_KEY)
  logout                 remove the shared saved account key
  Register: https://user.blockrun.ai
  status                 account or wallet overview
  wallet [create|import --stdin|export --yes|list|adopt <address>|recover]
                         (list/adopt: wallets from other apps — never active
                          until you adopt one deliberately)
  balance                USDC balance for the active wallet
  fund                   funding address + links
  chain [base|sol]       show or set the payment chain
  config <list|get|set>  persisted config (~/.blockrun/config.json)
  doctor                 health check (wallet + balance + chain)

Inference (via @blockrun/llm)
  run <model> "<prompt>" one-shot LLM call
  chat [--model m]       interactive multi-turn REPL (/model, /cost, /exit)
  models [--free]        list the model catalog

Multimodal (account API or x402; URLs by default, --out saves the file)
  image "<prompt>" [--model|--size|--out] · image edit <url> "<prompt>"
  video "<prompt>" [--model|--duration|--out]
  music "<prompt>" [--out]
  speech "<text>" [--voice|--out] · speech voices
  realface enroll <image-url> --name <n>

Data & discovery
  search "<q>"           Grok live web/X search
  research "<q>"         Exa neural search (--path answer|contents)
  predict <path>         prediction markets (e.g. predict polymarket/events --limit 5)
  crypto <surf-path>     onchain intelligence (Surf)
  price <symbol>         Pyth price feed
  rpc <network> <method> 40+ chain JSON-RPC
  discover               browse the x402 service catalog (free)

x402 passthrough (any paid endpoint, ours or third-party)
  api <METHOD> <url|path> [--data '{}'] [--quote]   call + auto-pay via 402
  pay <url> [--method GET] [--quote]                pay any 402 resource
  (--quote prices the call WITHOUT paying)

Guardrails & spend
  limits [set --per-call/--daily/--monthly | allow <cats> | deny <cats>]
  policy show|reset      guardrails + current spend
  spend [today|month]    real ledger totals (~/.blockrun/cost_log.jsonl)

Extensions & skills
  ext list | install <name> | remove <name>         manage sub-products
  skills list | add      install bundled Agent Skills into ~/.claude/skills
  upgrade                npm-update every installed sub-product

Sub-products (independently installable, args forwarded)
  route  ...             → ClawRouter (smart LLM routing)
  agent  ...             → Franklin (autonomous wallet agent)
  mcp    ...             → BlockRun MCP server
  codex  ...             → clawrouter-codex (Codex on BlockRun models)
  phone  ...             → ClawRouter phone (numbers, fraud)

Global flags
  --json / --format <json|pretty|table|ndjson|csv>
  --chain base|sol   --profile <name>

Any \`blockrun-<x>\` on your PATH is auto-discovered as \`blockrun <x>\`.`;

/** Resolve a core command to its envelope (sync helpers + async SDK-backed ones). */
export async function runCoreCommand(command: string, args: ParsedArgs, runtime: CoreRuntime = {}): Promise<Envelope> {
  const chain = resolveChain(args.chain);
  // Guardrails: paid commands are policy-checked before any network work.
  if (categoryOf(command) !== "other") {
    const gate = checkPolicy(command);
    if (!gate.allowed) return err("policy", gate.reason, 403);
  }
  switch (command) {
    // sync, core-backed
    case "chain":
      return chainCmd(args.rest[0]);
    case "config":
      return configCmd(args.rest);
    case "fund":
      return fundCmd();
    case "status":
    case "login":
    case "logout":
    case "wallet":
    case "version":
      return runCore(command, args, runtime);
    // async, SDK-backed
    case "run":
      return runCmd(args.rest[0], args.rest.slice(1).join(" "), chain);
    case "models":
      return modelsCmd({ free: args.rest.includes("--free") });
    case "balance":
      return balanceCmd(chain);
    case "doctor":
      return doctorCmd(chain);
    // multimodal
    case "image":
      return imageCmd(args.rest);
    case "video":
      return videoCmd(args.rest);
    case "music":
      return musicCmd(args.rest);
    case "speech":
      return speechCmd(args.rest);
    case "realface":
      return realfaceCmd(args.rest);
    // data & discovery
    case "search":
      return searchCmd(args.rest);
    case "research":
      return researchCmd(args.rest);
    case "predict":
      return predictCmd(args.rest);
    case "crypto":
      return cryptoCmd(args.rest);
    case "price":
      return priceCmd(args.rest);
    case "rpc":
      return rpcCmd(args.rest);
    case "discover":
      return discoverCmd();
    case "api":
      return apiCmd(args.rest);
    case "pay":
      return payCmd(args.rest);
    case "ext":
      return extCmd(args.rest);
    case "skills":
      return skillsCmd(args.rest);
    case "limits":
      return limitsCmd(args.rest);
    case "policy":
      return policyCmd(args.rest);
    case "spend":
      return spendCmd(args.rest);
    case "upgrade":
      return upgradeCmd();
    default:
      return runCore(command, args, runtime);
  }
}

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const command = args.command;
  if (args.chain) process.env.BLOCKRUN_CHAIN = resolveChain(args.chain);

  if (!command || command === "help") {
    process.stdout.write(HELP + "\n");
    return;
  }

  if (command === "chat") {
    // Interactive REPL — bypasses the envelope (it's a conversation, not a result).
    const { flags } = await import("./commands/media.js").then((m) => ({ flags: m.splitFlags(args.rest).flags }));
    process.exitCode = await chatRepl(typeof flags.model === "string" ? flags.model : undefined);
    return;
  }

  const plan = planDispatch(command, args.rest, makeWhich());
  switch (plan.kind) {
    case "core":
      emit(await runCoreCommand(command, args), { format: args.format });
      return;
    case "run": {
      const auth = resolveApiKey();
      const r = spawnSync(plan.bin, plan.args, { stdio: "inherit", env: { ...process.env, ...(auth ? { BLOCKRUN_API_KEY: auth.key } : {}) } });
      process.exitCode = r.status ?? 1;
      return;
    }
    case "invalid":
      emit(err("usage", "subcommand must contain only lowercase letters, digits, and hyphens", 400), {
        format: args.format,
      });
      return;
    case "missing": {
      const pkg = plan.pkg ?? `(looked for: ${plan.candidates.join(", ")})`;
      emit(
        err(
          "not-installed",
          `\`blockrun ${plan.command}\` needs ${pkg}. Install it with: blockrun ext install ${plan.command}`,
          127,
        ),
        { format: args.format },
      );
      return;
    }
  }
}

// Only run when invoked as a binary (not when imported by tests).
// argv[1] is a SYMLINK for globally-installed bins — compare realpaths, or the
// check silently fails and the CLI prints nothing (caught in tarball testing).
const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(entry)).href;
  } catch {
    return false;
  }
})();
if (isMain) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    emit(err("internal", e instanceof Error ? e.message : String(e)), { format: "pretty" });
  });
}
