/**
 * SDK-backed core commands. The umbrella owns these directly (via @blockrun/llm)
 * because they're the common surface every user needs before reaching for a
 * sub-product: run a model, list models, check balance, diagnose.
 *
 * Every handler returns a core Envelope so the output contract is uniform.
 */

import { LLMClient } from "@blockrun/llm";
import { ok, err, loadWallet, resolvePrivateKey, type Envelope, type Chain } from "@blockrun/core";

function mask(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/**
 * Build an LLMClient with the key resolved by @blockrun/core — the single source
 * of truth. The SDK constructor does not read ~/.blockrun itself, so core owns
 * resolution and hands the key over here (it never leaves the machine).
 */
function makeClient(): { client: LLMClient } | { error: Envelope } {
  const resolved = resolvePrivateKey();
  if (!resolved) {
    return { error: err("wallet", "No wallet found. Run `blockrun wallet create` or fund one.", 404) };
  }
  return { client: new LLMClient({ privateKey: resolved.privateKey }) };
}

function notOnBase(chain: Chain): Envelope | null {
  return chain === "sol"
    ? err("unsupported", "Solana support for this command lands next — use --chain base for now.", 400)
    : null;
}

/** `blockrun run <model> "<prompt>"` — one-shot LLM call. */
export async function runCmd(model: string, prompt: string, chain: Chain): Promise<Envelope> {
  const guard = notOnBase(chain);
  if (guard) return guard;
  if (!model || !prompt) return err("usage", 'usage: blockrun run <model> "<prompt>"', 400);
  const c = makeClient();
  if ("error" in c) return c.error;
  try {
    const output = await c.client.chat(model, prompt);
    // data is the raw completion so `pretty` prints just the text; `--json` wraps it.
    return ok(output, { model, chain });
  } catch (e) {
    return err("run", (e as Error).message);
  }
}

/** `blockrun models [--free]` — list the model catalog. */
export async function modelsCmd(opts: { free?: boolean }): Promise<Envelope> {
  const c = makeClient();
  if ("error" in c) return c.error;
  try {
    const raw = (await c.client.listModels()) as unknown as Array<Record<string, unknown>>;
    let list = raw.map((m) => ({
      id: (m.id ?? m.model ?? m.name) as string,
      pricing: (m.pricing ?? m.price ?? undefined) as unknown,
    }));
    if (opts.free) list = list.filter((m) => typeof m.id === "string" && m.id.startsWith("nvidia/"));
    return ok(list, { count: list.length });
  } catch (e) {
    return err("models", (e as Error).message);
  }
}

/** `blockrun balance` — USDC balance for the active wallet. */
export async function balanceCmd(chain: Chain): Promise<Envelope> {
  const guard = notOnBase(chain);
  if (guard) return guard;
  const c = makeClient();
  if ("error" in c) return c.error;
  try {
    const address = c.client.getWalletAddress();
    const balance = await c.client.getBalance();
    return ok({ address: address ? mask(address) : null, balance: `$${balance.toFixed(2)}`, chain: "base" });
  } catch (e) {
    return err("balance", (e as Error).message);
  }
}

/** `blockrun doctor` — one-shot health check across wallet + balance + chain. */
export async function doctorCmd(chain: Chain): Promise<Envelope> {
  const w = loadWallet();
  const checks: Record<string, string> = {
    wallet: w ? `${mask(w.address)} (${w.source})` : "missing — run `blockrun wallet create`",
    chain,
  };
  if (w && chain === "base") {
    const c = makeClient();
    if ("error" in c) {
      checks.balance = "unavailable";
    } else {
      try {
        checks.balance = `$${(await c.client.getBalance()).toFixed(2)}`;
      } catch {
        checks.balance = "unavailable";
      }
    }
  }
  return ok(checks);
}
