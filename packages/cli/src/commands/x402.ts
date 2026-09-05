/**
 * Generic x402 passthrough — the Lark-style "layer ③" that covers ANY paid
 * endpoint, ours or a third party's, with one command:
 *
 *   blockrun api <METHOD> <url-or-path> [--data '{}'] [--quote]
 *   blockrun pay <url> [--method GET] [--data '{}'] [--quote]
 *
 * Flow: request → 402 → parse `payment-required` → sign an X-PAYMENT header
 * with the core-resolved key → retry. `--quote` stops at the 402 and reports
 * the price without paying — the cheap way to ask "what would this cost?".
 */

import { parsePaymentRequired, extractPaymentDetails, createPaymentPayload, logCost } from "@blockrun/llm";
import { accountFetch, accountBaseUrl, resolveApiKey, commandError, ok, err, resolvePrivateKey, addressFromKey, type Envelope } from "@blockrun/core";
import { splitFlags } from "./media.js";
import { readPolicy } from "./policy.js";
import { fetchWithTimeout, readResponseText } from "../http.js";

const DEFAULT_BASE = "https://blockrun.ai/api";

/** Bare paths get the BlockRun gateway prefix; full URLs pass through. */
export function resolveUrl(target: string): string {
  if (/^https?:\/\//i.test(target)) return target;
  return `${DEFAULT_BASE}/${target.replace(/^\/+/, "")}`;
}

async function bodyOf(res: Response): Promise<unknown> {
  const text = await readResponseText(res);
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 2000);
  }
}

/** Safety ceiling: refuse to auto-pay quotes above this unless --max raises it. */
export const DEFAULT_MAX_USD = 1;

export async function x402Fetch(
  url: string,
  init: { method: string; data?: string },
  opts: { quoteOnly?: boolean; maxUsd?: number } = {},
): Promise<Envelope> {
  const reqInit: RequestInit = {
    method: init.method,
    headers: { "content-type": "application/json" },
    ...(init.data ? { body: init.data } : {}),
  };

  let res: Response;
  try {
    res = await fetchWithTimeout(url, { ...reqInit, redirect: "manual" });
  } catch (e) {
    return err("network", (e as Error).message);
  }

  if (res.status >= 300 && res.status < 400) {
    return err("redirect", "refusing redirect during x402 payment negotiation", res.status);
  }

  // Not payment-gated (or already paid/free) — return as-is.
  if (res.status !== 402) {
    let data: unknown;
    try {
      data = await bodyOf(res);
    } catch (e) {
      return err("response", (e as Error).message, 413);
    }
    return res.ok
      ? ok(data as Record<string, unknown>, { url, paid: false })
      : err("http", typeof data === "string" ? data : JSON.stringify(data).slice(0, 400), res.status);
  }

  // 402 → read the quote.
  const prHeader = res.headers.get("payment-required") || res.headers.get("PAYMENT-REQUIRED");
  if (!prHeader) return err("x402", "402 without a payment-required header — not an x402 endpoint?", 402);
  let quote: { amount: string; recipient: string; network: string };
  try {
    quote = extractPaymentDetails(parsePaymentRequired(prHeader));
  } catch (e) {
    return err("x402", `could not parse payment requirements: ${(e as Error).message}`, 402);
  }

  const amountUsd = Number(quote.amount) / 1e6;
  if (opts.quoteOnly) {
    return ok({ quote: { ...quote, amountUsdc: amountUsd }, url }, { paid: false });
  }

  // Safety ceiling — a malicious endpoint can quote any amount; never sign
  // above the cap without the user explicitly raising it via --max.
  // Precedence: --max flag > policy perCall limit > $1 default.
  const maxUsd = opts.maxUsd ?? readPolicy().perCall ?? DEFAULT_MAX_USD;
  if (!(amountUsd <= maxUsd)) {
    return err(
      "payment-cap",
      `endpoint quoted $${amountUsd.toFixed(4)} which exceeds the $${maxUsd} cap — re-run with --max ${Math.ceil(amountUsd * 100) / 100} to allow, or --quote to inspect`,
      402,
    );
  }

  const resolved = resolvePrivateKey();
  if (!resolved) return err("wallet", "No wallet found. Run `blockrun wallet create`.", 404);
  const from = addressFromKey(resolved.privateKey);
  if (!from) return err("wallet", "stored key is invalid", 400);

  // Sign and retry with X-PAYMENT.
  let paymentHeader: string;
  try {
    paymentHeader = await createPaymentPayload(resolved.privateKey, from, quote.recipient, quote.amount, quote.network, {
      resourceUrl: url,
    });
  } catch (e) {
    return err("x402", `payment signing failed: ${(e as Error).message}`);
  }

  let paid: Response;
  try {
    paid = await fetchWithTimeout(url, {
      ...reqInit,
      redirect: "manual",
      headers: { ...(reqInit.headers as object), "X-PAYMENT": paymentHeader },
    });
  } catch (e) {
    return err("network", (e as Error).message);
  }
  if (paid.status >= 300 && paid.status < 400) {
    return err("redirect", "refusing redirect after x402 payment", paid.status);
  }
  let data: unknown;
  try {
    data = await bodyOf(paid);
  } catch (e) {
    return err("response", (e as Error).message, 413);
  }
  if (!paid.ok) {
    return err("http", typeof data === "string" ? data : JSON.stringify(data).slice(0, 400), paid.status);
  }
  // Record in the shared SDK ledger so `blockrun spend` and the daily/monthly
  // guardrails see manual x402 payments too.
  try {
    logCost({
      ts: Date.now() / 1000,
      endpoint: new URL(url).pathname,
      cost_usd: amountUsd,
      wallet: from,
      network: quote.network,
      client_kind: "blockrun-cli",
    });
  } catch {
    /* ledger is best-effort */
  }
  return ok(data as Record<string, unknown>, {
    url,
    paid: true,
    cost: amountUsd,
    chain: quote.network,
  });
}

function maxFlag(flags: Record<string, string | boolean>): number | undefined {
  return typeof flags.max === "string" && !Number.isNaN(Number(flags.max)) ? Number(flags.max) : undefined;
}

/** blockrun api <METHOD> <url-or-path> [--data '{}'] [--quote] [--max <usd>] */
export async function apiCmd(rest: string[]): Promise<Envelope> {
  const { words, flags } = splitFlags(rest);
  const [method, target] = words;
  if (!method || !target) {
    return err("usage", "usage: blockrun api <GET|POST|...> <url-or-path> [--data '{}'] [--quote] [--max <usd>]", 400);
  }
  const auth = resolveApiKey();
  if (auth) {
    if (flags.quote || flags.max) return err("usage", "Account requests do not use x402 quotes or --max. Configure account limits in the portal.", 400);
    try {
      const base = accountBaseUrl();
      const targetUrl = /^https?:\/\//i.test(target) ? target : `${base}/${target.replace(/^\/+/, "")}`;
      const response = await accountFetch(targetUrl, { method: method.toUpperCase(), headers: { "content-type": "application/json" }, ...(typeof flags.data === "string" ? { body: flags.data } : {}) });
      if (!response.ok) {
        await response.body?.cancel();
        const result = err("account", `BlockRun account API returned HTTP ${response.status}. Check https://user.blockrun.ai/dashboard/credits or your API key.`, response.status);
        const retry = response.headers.get("retry-after");
        if (retry) result.error.retryAfter = retry;
        return result;
      }
      return ok(await bodyOf(response), { authMode: "api-key", costSource: "account_portal" });
    } catch (e) { return commandError("api", e); }
  }
  return x402Fetch(
    resolveUrl(target),
    { method: method.toUpperCase(), data: typeof flags.data === "string" ? flags.data : undefined },
    { quoteOnly: flags.quote === true, maxUsd: maxFlag(flags) },
  );
}

/** blockrun pay <url> [--method GET] [--data '{}'] [--quote] [--max <usd>] — pay any 402 resource. */
export async function payCmd(rest: string[]): Promise<Envelope> {
  const { words, flags } = splitFlags(rest);
  const target = words[0];
  if (!target) return err("usage", "usage: blockrun pay <url> [--method GET] [--data '{}'] [--quote] [--max <usd>]", 400);
  const method = typeof flags.method === "string" ? flags.method.toUpperCase() : "GET";
  return x402Fetch(
    resolveUrl(target),
    { method, data: typeof flags.data === "string" ? flags.data : undefined },
    { quoteOnly: flags.quote === true, maxUsd: maxFlag(flags) },
  );
}
