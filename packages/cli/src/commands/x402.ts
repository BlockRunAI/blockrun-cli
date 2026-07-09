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

import { parsePaymentRequired, extractPaymentDetails, createPaymentPayload } from "@blockrun/llm";
import { ok, err, resolvePrivateKey, addressFromKey, type Envelope } from "@blockrun/core";
import { splitFlags } from "./media.js";

const DEFAULT_BASE = "https://blockrun.ai/api";

/** Bare paths get the BlockRun gateway prefix; full URLs pass through. */
export function resolveUrl(target: string): string {
  if (/^https?:\/\//i.test(target)) return target;
  return `${DEFAULT_BASE}/${target.replace(/^\/+/, "")}`;
}

async function bodyOf(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 2000);
  }
}

export async function x402Fetch(
  url: string,
  init: { method: string; data?: string },
  opts: { quoteOnly?: boolean } = {},
): Promise<Envelope> {
  const reqInit: RequestInit = {
    method: init.method,
    headers: { "content-type": "application/json" },
    ...(init.data ? { body: init.data } : {}),
  };

  let res: Response;
  try {
    res = await fetch(url, reqInit);
  } catch (e) {
    return err("network", (e as Error).message);
  }

  // Not payment-gated (or already paid/free) — return as-is.
  if (res.status !== 402) {
    const data = await bodyOf(res);
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

  if (opts.quoteOnly) {
    return ok({ quote: { ...quote, amountUsdc: Number(quote.amount) / 1e6 }, url }, { paid: false });
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
    paid = await fetch(url, { ...reqInit, headers: { ...(reqInit.headers as object), "X-PAYMENT": paymentHeader } });
  } catch (e) {
    return err("network", (e as Error).message);
  }
  const data = await bodyOf(paid);
  if (!paid.ok) {
    return err("http", typeof data === "string" ? data : JSON.stringify(data).slice(0, 400), paid.status);
  }
  return ok(data as Record<string, unknown>, {
    url,
    paid: true,
    cost: Number(quote.amount) / 1e6,
    chain: quote.network,
  });
}

/** blockrun api <METHOD> <url-or-path> [--data '{}'] [--quote] */
export async function apiCmd(rest: string[]): Promise<Envelope> {
  const { words, flags } = splitFlags(rest);
  const [method, target] = words;
  if (!method || !target) {
    return err("usage", "usage: blockrun api <GET|POST|...> <url-or-path> [--data '{}'] [--quote]", 400);
  }
  return x402Fetch(
    resolveUrl(target),
    { method: method.toUpperCase(), data: typeof flags.data === "string" ? flags.data : undefined },
    { quoteOnly: flags.quote === true },
  );
}

/** blockrun pay <url> [--method GET] [--data '{}'] [--quote] — pay any 402 resource. */
export async function payCmd(rest: string[]): Promise<Envelope> {
  const { words, flags } = splitFlags(rest);
  const target = words[0];
  if (!target) return err("usage", "usage: blockrun pay <url> [--method GET] [--data '{}'] [--quote]", 400);
  const method = typeof flags.method === "string" ? flags.method.toUpperCase() : "GET";
  return x402Fetch(
    resolveUrl(target),
    { method, data: typeof flags.data === "string" ? flags.data : undefined },
    { quoteOnly: flags.quote === true },
  );
}
