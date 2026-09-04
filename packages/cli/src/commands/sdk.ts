/** SDK-backed commands use one credential resolver for account and wallet modes. */
import { ok, accountStatus, type Envelope, type Chain } from "@blockrun/core";
import { llmClient, commandError } from "./auth.js";
import { err } from "@blockrun/core";

export async function runCmd(model: string, prompt: string, chain: Chain): Promise<Envelope> {
  if (!model || !prompt) return err("usage", 'usage: blockrun run <model> "<prompt>"', 400);
  try {
    const client = llmClient(chain);
    return ok(await client.chat(model, prompt), { model, ...(accountStatus() ? { authMode: "api-key" } : { chain }) });
  } catch (e) { return commandError("run", e); }
}

export async function modelsCmd(opts: { free?: boolean }): Promise<Envelope> {
  try {
    const raw = await llmClient().listModels() as unknown as Array<Record<string, unknown>>;
    let list = raw.map(m => ({ id: String(m.id ?? m.model ?? m.name), pricing: m.pricing ?? m.price }));
    if (opts.free) list = list.filter(m => m.id.startsWith("nvidia/"));
    return ok(list, { count: list.length });
  } catch (e) { return commandError("models", e); }
}

export async function balanceCmd(chain: Chain): Promise<Envelope> {
  try {
    const account = accountStatus();
    if (account) return ok({ ...account, hint: "Account balance and charges are available in the credits portal." });
    const client = llmClient(chain);
    const address = await client.getWalletAddress();
    return ok({ address: `${address.slice(0,6)}…${address.slice(-4)}`, balance: `$${(await client.getBalance()).toFixed(2)}`, chain });
  } catch (e) { return commandError("balance", e); }
}

export async function doctorCmd(chain: Chain): Promise<Envelope> {
  try {
    const account = accountStatus();
    if (account) {
      const models = await llmClient().listModels();
      return ok({ ...account, connection: "ok", models: models.length });
    }
    return await balanceCmd(chain);
  } catch (e) { return commandError("doctor", e); }
}
