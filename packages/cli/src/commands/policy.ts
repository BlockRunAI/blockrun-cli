/**
 * Spending guardrails — the Vishwa-inspired policy layer.
 *
 *   blockrun limits                                  show current limits
 *   blockrun limits set --per-call 0.5 --daily 20 --monthly 200
 *   blockrun limits allow chat,image                 operation whitelist
 *   blockrun limits deny video                       operation blacklist
 *   blockrun policy show|reset
 *   blockrun spend [today|month|all]                 real ledger, from the SDK cost log
 *
 * Policy lives in ~/.blockrun/config.json (core-owned), so every entry point
 * sharing core sees the same guardrails. Enforcement happens in the CLI:
 *  - category allow/deny + daily/monthly ceilings are checked before any paid
 *    command runs (see `checkPolicy`)
 *  - the per-call ceiling feeds x402Fetch's payment cap
 * Spend is computed from the SDK's cost ledger (~/.blockrun/cost_log.jsonl).
 */

import * as fs from "node:fs";
import { ok, err, readConfig, writeConfig, paths, type Envelope } from "@blockrun/core";
import { splitFlags } from "./media.js";

export interface Policy {
  perCall?: number;
  daily?: number;
  monthly?: number;
  allow?: string[];
  deny?: string[];
}

export function readPolicy(): Policy {
  const cfg = readConfig();
  return (cfg.policy as Policy) ?? {};
}

function writePolicy(p: Policy): Policy {
  writeConfig({ policy: p as never });
  return p;
}

/** Category a CLI command bills under, for allow/deny lists. */
export function categoryOf(command: string): string {
  if (["run", "chat"].includes(command)) return "chat";
  if (["image", "video", "music", "speech", "realface"].includes(command)) return command;
  if (["search", "research", "predict", "crypto", "price", "rpc"].includes(command)) return "data";
  if (["api", "pay"].includes(command)) return "api";
  return "other";
}

interface LedgerEntry {
  ts: number;
  cost_usd: number;
  model?: string;
}

function readLedger(): LedgerEntry[] {
  try {
    const raw = fs.readFileSync(paths().costLog, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as LedgerEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is LedgerEntry => !!e && typeof e.ts === "number" && typeof e.cost_usd === "number");
  } catch {
    return [];
  }
}

export interface SpendSummary {
  today: number;
  month: number;
  total: number;
  requests: number;
}

export function spendSummary(now = Date.now() / 1000): SpendSummary {
  const entries = readLedger();
  const dayStart = new Date(now * 1000);
  dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(dayStart);
  monthStart.setDate(1);
  const day = dayStart.getTime() / 1000;
  const month = monthStart.getTime() / 1000;
  let today = 0,
    monthly = 0,
    total = 0;
  for (const e of entries) {
    total += e.cost_usd;
    if (e.ts >= month) monthly += e.cost_usd;
    if (e.ts >= day) today += e.cost_usd;
  }
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  return { today: r(today), month: r(monthly), total: r(total), requests: entries.length };
}

/**
 * Pre-flight for paid commands. Category deny wins; a non-empty allow list is a
 * whitelist; then daily/monthly ceilings are checked against the real ledger.
 */
export function checkPolicy(command: string): { allowed: true } | { allowed: false; reason: string } {
  const p = readPolicy();
  const cat = categoryOf(command);
  if (p.deny?.includes(cat)) return { allowed: false, reason: `category "${cat}" is denied by policy` };
  if (p.allow && p.allow.length > 0 && !p.allow.includes(cat)) {
    return { allowed: false, reason: `category "${cat}" is not in the allow list (${p.allow.join(",")})` };
  }
  if (p.daily !== undefined || p.monthly !== undefined) {
    const s = spendSummary();
    if (p.daily !== undefined && s.today >= p.daily) {
      return { allowed: false, reason: `daily limit reached ($${s.today.toFixed(2)} of $${p.daily})` };
    }
    if (p.monthly !== undefined && s.month >= p.monthly) {
      return { allowed: false, reason: `monthly limit reached ($${s.month.toFixed(2)} of $${p.monthly})` };
    }
  }
  return { allowed: true };
}

const CATS = ["chat", "image", "video", "music", "speech", "realface", "data", "api"];

export function limitsCmd(rest: string[]): Envelope {
  const { words, flags } = splitFlags(rest);
  const action = words[0];
  const p = readPolicy();

  if (!action || action === "show") return ok(p as Record<string, unknown>);

  if (action === "set") {
    const num = (v: unknown) => (typeof v === "string" && !Number.isNaN(Number(v)) ? Number(v) : undefined);
    const next: Policy = { ...p };
    const perCall = num(flags["per-call"]);
    const daily = num(flags.daily);
    const monthly = num(flags.monthly);
    if (perCall !== undefined) next.perCall = perCall;
    if (daily !== undefined) next.daily = daily;
    if (monthly !== undefined) next.monthly = monthly;
    if (perCall === undefined && daily === undefined && monthly === undefined) {
      return err("usage", "usage: blockrun limits set [--per-call usd] [--daily usd] [--monthly usd]", 400);
    }
    return ok(writePolicy(next) as Record<string, unknown>, { saved: true });
  }

  if (action === "allow" || action === "deny") {
    const cats = (words[1] ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    if (!cats.length) return err("usage", `usage: blockrun limits ${action} <${CATS.join("|")}>[,..]`, 400);
    const bad = cats.filter((c) => !CATS.includes(c));
    if (bad.length) return err("usage", `unknown categories: ${bad.join(",")} (valid: ${CATS.join(",")})`, 400);
    const next: Policy = { ...p, [action]: cats };
    return ok(writePolicy(next) as Record<string, unknown>, { saved: true });
  }

  return err("usage", "usage: blockrun limits [show|set|allow|deny]", 400);
}

export function policyCmd(rest: string[]): Envelope {
  const action = rest[0] ?? "show";
  if (action === "show") {
    const p = readPolicy();
    const s = spendSummary();
    return ok({ policy: p, spend: { today: s.today, month: s.month } });
  }
  if (action === "reset") {
    writePolicy({});
    return ok({ policy: {}, reset: true });
  }
  return err("usage", "usage: blockrun policy [show|reset]", 400);
}

export function spendCmd(rest: string[]): Envelope {
  const window = rest[0] ?? "all";
  const s = spendSummary();
  if (window === "today") return ok({ today: `$${s.today.toFixed(4)}` });
  if (window === "month") return ok({ month: `$${s.month.toFixed(4)}` });
  return ok({
    today: `$${s.today.toFixed(4)}`,
    month: `$${s.month.toFixed(4)}`,
    total: `$${s.total.toFixed(4)}`,
    requests: s.requests,
  });
}
