/**
 * Data & discovery commands — search / research / predict / crypto / price /
 * rpc / discover. All paid endpoints go through the SDK with the key resolved
 * by @blockrun/core; `discover` hits the free x402 discovery document.
 */

import { LLMClient, SearchClient, PriceClient, RpcClient, SurfClient } from "@blockrun/llm";
import { ok, err, resolvePrivateKey, type Envelope } from "@blockrun/core";
import { splitFlags } from "./media.js";

function key(): `0x${string}` | null {
  return resolvePrivateKey()?.privateKey ?? null;
}

const NO_WALLET = err("wallet", "No wallet found. Run `blockrun wallet create`.", 404);

/** blockrun search "<query>" — Grok live web/X search. */
export async function searchCmd(rest: string[]): Promise<Envelope> {
  const { words } = splitFlags(rest);
  const query = words.join(" ");
  if (!query) return err("usage", 'usage: blockrun search "<query>"', 400);
  const k = key();
  if (!k) return NO_WALLET;
  try {
    const r = await new SearchClient({ privateKey: k }).search(query);
    return ok(r as unknown as Record<string, unknown>, { kind: "search" });
  } catch (e) {
    return err("search", (e as Error).message);
  }
}

/** blockrun research "<query>" [--path answer|contents|…] — Exa neural search passthrough. */
export async function researchCmd(rest: string[]): Promise<Envelope> {
  const { words, flags } = splitFlags(rest);
  const query = words.join(" ");
  if (!query) return err("usage", 'usage: blockrun research "<query>" [--path search|answer]', 400);
  const k = key();
  if (!k) return NO_WALLET;
  const path = typeof flags.path === "string" ? flags.path : "search";
  try {
    // Same raw x402 passthrough the MCP exa tool uses (private but stable).
    const raw = new LLMClient({ privateKey: k }) as unknown as {
      requestWithPaymentRaw: (endpoint: string, body: unknown) => Promise<unknown>;
    };
    const result = await raw.requestWithPaymentRaw(`/v1/exa/${path}`, { query });
    return ok(result as Record<string, unknown>, { kind: "research", path });
  } catch (e) {
    return err("research", (e as Error).message);
  }
}

/** blockrun predict <path> [--k v ...] — Predexon prediction-market data (GET passthrough). */
export async function predictCmd(rest: string[]): Promise<Envelope> {
  const { words, flags } = splitFlags(rest);
  const path = words[0];
  if (!path) {
    return err("usage", "usage: blockrun predict <path> [--param value ...]  e.g. blockrun predict polymarket/events --limit 5", 400);
  }
  const k = key();
  if (!k) return NO_WALLET;
  try {
    const params: Record<string, string> = {};
    for (const [f, v] of Object.entries(flags)) if (typeof v === "string") params[f] = v;
    // llm.pm(path, params) — the SDK's prediction-market GET passthrough (used by blockrun-mcp).
    const raw = new LLMClient({ privateKey: k }) as unknown as {
      pm: (path: string, params?: Record<string, string>) => Promise<unknown>;
    };
    const result = await raw.pm(path, params);
    return ok(result as Record<string, unknown>, { kind: "predict", path });
  } catch (e) {
    return err("predict", (e as Error).message);
  }
}

/** blockrun crypto <surf-path> [--k v ...] — onchain intelligence (Surf GET). */
export async function cryptoCmd(rest: string[]): Promise<Envelope> {
  const { words, flags } = splitFlags(rest);
  const path = words.join("/");
  if (!path) return err("usage", "usage: blockrun crypto <surf-path>  e.g. blockrun crypto tokens/trending", 400);
  const k = key();
  if (!k) return NO_WALLET;
  try {
    const params: Record<string, string> = {};
    for (const [f, v] of Object.entries(flags)) if (typeof v === "string") params[f] = v;
    const result = await new SurfClient({ privateKey: k }).get(path, params);
    return ok(result as Record<string, unknown>, { kind: "crypto", path });
  } catch (e) {
    return err("crypto", (e as Error).message);
  }
}

/** blockrun price <symbol> [--category crypto|stock|fx] — Pyth price feed. */
export async function priceCmd(rest: string[]): Promise<Envelope> {
  const { words, flags } = splitFlags(rest);
  const symbol = words[0];
  if (!symbol) return err("usage", "usage: blockrun price <symbol> [--category crypto]", 400);
  const k = key();
  if (!k) return NO_WALLET;
  const category = (typeof flags.category === "string" ? flags.category : "crypto") as never;
  try {
    const r = await new PriceClient({ privateKey: k }).price(category, symbol.toUpperCase());
    return ok(r as unknown as Record<string, unknown>, { kind: "price" });
  } catch (e) {
    return err("price", (e as Error).message);
  }
}

/** blockrun rpc <network> <method> [json-params] — 40+ chain JSON-RPC ($0.002/call). */
export async function rpcCmd(rest: string[]): Promise<Envelope> {
  const [network, method, ...paramArgs] = rest;
  if (!network || !method) {
    return err("usage", 'usage: blockrun rpc <network> <method> [params-json]  e.g. blockrun rpc base eth_blockNumber', 400);
  }
  const k = key();
  if (!k) return NO_WALLET;
  let params: unknown[] = [];
  if (paramArgs.length) {
    try {
      const parsed: unknown = JSON.parse(paramArgs.join(" "));
      params = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      params = paramArgs;
    }
  }
  try {
    const r = await new RpcClient({ privateKey: k }).call(network as never, method, params);
    return ok(r as unknown as Record<string, unknown>, { kind: "rpc", network, method });
  } catch (e) {
    return err("rpc", (e as Error).message);
  }
}

/** blockrun discover — browse the gateway's x402 service catalog (free). */
export async function discoverCmd(): Promise<Envelope> {
  try {
    const res = await fetch("https://blockrun.ai/.well-known/x402");
    if (!res.ok) return err("discover", `discovery endpoint HTTP ${res.status}`, res.status);
    const doc = (await res.json()) as Record<string, unknown>;
    return ok(doc, { kind: "discover", source: "blockrun.ai/.well-known/x402" });
  } catch (e) {
    return err("discover", (e as Error).message);
  }
}
