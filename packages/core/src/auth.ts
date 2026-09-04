/** Shared account credentials. Never persist keys in general config or print them. */
import * as fs from "node:fs";
import * as path from "node:path";
import { blockrunDir } from "./config.js";
import { err, type ErrorEnvelope } from "./output.js";

export const PORTAL_URL = "https://user.blockrun.ai";
export const ACCOUNT_API_URL = "https://api.blockrun.ai";

export function validateApiKey(raw: string): string {
  const key = raw.trim();
  if (!/^brk_[A-Za-z0-9_-]+$/.test(key)) throw new Error(`Invalid BlockRun API key. Create one at ${PORTAL_URL}/dashboard/keys.`);
  return key;
}

export function resolveApiKey(): { key: string; source: "env" | "core" } | undefined {
  if (process.env.BLOCKRUN_API_KEY !== undefined) return { key: validateApiKey(process.env.BLOCKRUN_API_KEY), source: "env" };
  const file = path.join(blockrunDir(), ".api-key");
  if (!fs.existsSync(file)) return undefined;
  return { key: validateApiKey(fs.readFileSync(file, "utf8")), source: "core" };
}

export function saveApiKey(raw: string): void {
  const key = validateApiKey(raw);
  fs.mkdirSync(blockrunDir(), { recursive: true });
  const file = path.join(blockrunDir(), ".api-key");
  // Opening with no-follow avoids overwriting a linked credential file.
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.fchmodSync(fd, 0o600); fs.writeFileSync(fd, key + "\n"); } finally { fs.closeSync(fd); }
}

export function clearApiKey(): { envStillSet: boolean } {
  fs.rmSync(path.join(blockrunDir(), ".api-key"), { force: true });
  return { envStillSet: process.env.BLOCKRUN_API_KEY !== undefined };
}

export function accountBaseUrl(): string {
  const url = new URL(process.env.BLOCKRUN_API_BASE_URL || ACCOUNT_API_URL);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) || url.username || url.password || url.search || url.hash) {
    throw new Error("Account API URL requires HTTPS (localhost HTTP allowed), without credentials, query or fragment.");
  }
  return url.href.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** Bound to the configured account origin. No wallet fallback, redirects or retries. */
export async function accountFetch(target: string, init: RequestInit = {}): Promise<Response> {
  const auth = resolveApiKey();
  if (!auth) throw new Error("No account API key configured.");
  const base = accountBaseUrl();
  const url = new URL(target, base + "/");
  if (url.origin !== new URL(base).origin || url.username || url.password) throw new Error("Refusing to send an API key to another origin.");
  if (new URL(base).pathname === "/" && url.pathname.startsWith("/api/v1/")) url.pathname = url.pathname.slice(4);
  const headers = new Headers(init.headers);
  for (const name of [...headers.keys()]) if (name.toLowerCase().includes("payment") || name.toLowerCase() === "x-api-key") headers.delete(name);
  headers.set("authorization", `Bearer ${auth.key}`);
  return fetch(url, { ...init, headers, redirect: "error", signal: init.signal ?? AbortSignal.timeout(120_000) });
}

export function accountStatus() {
  const auth = resolveApiKey();
  return auth ? { authMode: "api-key", source: auth.source, apiUrl: accountBaseUrl(), account: PORTAL_URL, credits: `${PORTAL_URL}/dashboard/credits` } : undefined;
}

export function commandError(type: string, error: unknown): ErrorEnvelope {
  const e = error as { message?: string; statusCode?: number; retryAfter?: string };
  let key: string | undefined;
  try { key = resolveApiKey()?.key; } catch { key = undefined; }
  const message = String(e?.message ?? error);
  const result = err(type, key ? message.split(key).join("[REDACTED]") : message, e?.statusCode);
  if (e?.retryAfter !== undefined) result.error.retryAfter = e.retryAfter;
  return result;
}
