import { LLMClient, SolanaLLMClient } from "@blockrun/llm";
import { accountBaseUrl, resolveApiKey, resolvePrivateKey, resolveChain, paths, commandError, type Chain } from "@blockrun/core";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export { commandError };
export function sdkOptions() {
  const auth = resolveApiKey();
  if (auth) {
    if (!Object.getOwnPropertyDescriptor(LLMClient.prototype, "authMode")) throw new Error("Account API mode requires TypeScript SDK PR #36; install the preview SDK described in README before use.");
    return { apiKey: auth.key, apiUrl: accountBaseUrl() };
  }
  if (resolveChain() === "sol") throw new Error("This media/data client currently requires an account API key or a Base wallet (--chain base). Solana chat is available.");
  const wallet = resolvePrivateKey();
  if (!wallet) throw new Error("No wallet found. Set BLOCKRUN_API_KEY or run `blockrun wallet create`.");
  return { privateKey: wallet.privateKey };
}

export function llmClient(chain: Chain = resolveChain()) {
  if (resolveApiKey()) return new LLMClient(sdkOptions());
  if (chain === "base") {
    const wallet = resolvePrivateKey();
    if (!wallet) throw new Error("No wallet found. Set BLOCKRUN_API_KEY or run `blockrun wallet create`.");
    return new LLMClient({ privateKey: wallet.privateKey });
  }
  let privateKey = process.env.SOLANA_WALLET_KEY;
  if (!privateKey) {
    for (const name of [".solana-session", ".solana"]) {
      const file = join(paths().dir, name);
      if (existsSync(file)) { privateKey = readFileSync(file, "utf8").trim(); break; }
    }
  }
  if (!privateKey) throw new Error("No Solana wallet found. Set SOLANA_WALLET_KEY or use BLOCKRUN_API_KEY.");
  return new SolanaLLMClient({ privateKey });
}
