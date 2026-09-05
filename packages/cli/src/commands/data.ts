/**
 * Data & discovery commands — search / research / predict / crypto / price /
 * rpc / discover. All paid endpoints go through the SDK with the key resolved
 * by @blockrun/core; `discover` hits the free x402 discovery document.
 */

import { LLMClient, SearchClient, PriceClient, RpcClient, SurfClient } from "@blockrun/llm";
import { ok, err, type Envelope } from "@blockrun/core";
import { sdkOptions, commandError } from "./auth.js";
import { splitFlags } from "./media.js";



/** blockrun search "<query>" — Grok live web/X search. */
export async function searchCmd(rest: string[]): Promise<Envelope> {
  const { words } = splitFlags(rest);
  const query = words.join(" ");
  if (!query) return err("usage", 'usage: blockrun search "<query>"', 400);
  try {
    const r = await new SearchClient(sdkOptions()).search(query);
    return ok(r as unknown as Record<string, unknown>, { kind: "search" });
  } catch (e) {
    return commandError("search", e);
  }
}

/** blockrun research "<query>" [--path answer|contents|…] — Exa neural search passthrough. */
export async function researchCmd(rest: string[]): Promise<Envelope> {
  const { words, flags } = splitFlags(rest);
  const query = words.join(" ");
  if (!query) return err("usage", 'usage: blockrun research "<query>" [--path search|answer]', 400);
  const path = typeof flags.path === "string" ? flags.path : "search";
  try {
    const result = await new LLMClient(sdkOptions()).exa(path, { query });
    return ok(result as Record<string, unknown>, { kind: "research", path });
  } catch (e) {
    return commandError("research", e);
  }
}

/** blockrun predict <path> [--k v ...] — Predexon prediction-market data (GET passthrough). */
export async function predictCmd(rest: string[]): Promise<Envelope> {
  const { words, flags } = splitFlags(rest);
  const path = words[0];
  if (!path) {
    return err("usage", "usage: blockrun predict <path> [--param value ...]  e.g. blockrun predict polymarket/events --limit 5", 400);
  }
  try {
    const params: Record<string, string> = {};
    for (const [f, v] of Object.entries(flags)) if (typeof v === "string") params[f] = v;
    // llm.pm(path, params) — the SDK's prediction-market GET passthrough (used by blockrun-mcp).
    const raw = new LLMClient(sdkOptions()) as unknown as {
      pm: (path: string, params?: Record<string, string>) => Promise<unknown>;
    };
    const result = await raw.pm(path, params);
    return ok(result as Record<string, unknown>, { kind: "predict", path });
  } catch (e) {
    return commandError("predict", e);
  }
}

/** blockrun crypto <surf-path> [--k v ...] — onchain intelligence (Surf GET). */
export async function cryptoCmd(rest: string[]): Promise<Envelope> {
  const { words, flags } = splitFlags(rest);
  const path = words.join("/");
  if (!path) return err("usage", "usage: blockrun crypto <surf-path>  e.g. blockrun crypto tokens/trending", 400);
  try {
    const params: Record<string, string> = {};
    for (const [f, v] of Object.entries(flags)) if (typeof v === "string") params[f] = v;
    const result = await new SurfClient(sdkOptions()).get(path, params);
    return ok(result as Record<string, unknown>, { kind: "crypto", path });
  } catch (e) {
    return commandError("crypto", e);
  }
}

/** blockrun price <symbol> [--category crypto|stock|fx] — Pyth price feed. */
export async function priceCmd(rest: string[]): Promise<Envelope> {
  const { words, flags } = splitFlags(rest);
  const symbol = words[0];
  if (!symbol) return err("usage", "usage: blockrun price <symbol> [--category crypto]", 400);
  const category = (typeof flags.category === "string" ? flags.category : "crypto") as never;
  try {
    const r = await new PriceClient(sdkOptions()).price(category, symbol.toUpperCase());
    return ok(r as unknown as Record<string, unknown>, { kind: "price" });
  } catch (e) {
    return commandError("price", e);
  }
}

/** blockrun rpc <network> <method> [json-params] — 40+ chain JSON-RPC ($0.002/call). */
export async function rpcCmd(rest: string[]): Promise<Envelope> {
  const [network, method, ...paramArgs] = rest;
  if (!network || !method) {
    return err("usage", 'usage: blockrun rpc <network> <method> [params-json]  e.g. blockrun rpc base eth_blockNumber', 400);
  }
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
    const r = await new RpcClient(sdkOptions()).call(network as never, method, params);
    return ok(r as unknown as Record<string, unknown>, { kind: "rpc", network, method });
  } catch (e) {
    return commandError("rpc", e);
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
    return commandError("discover", e);
  }
}
