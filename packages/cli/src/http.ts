import * as fs from "node:fs";
import * as path from "node:path";

export const HTTP_TIMEOUT_MS = 30_000;
export const MEDIA_TIMEOUT_MS = 10 * 60_000;
export const MAX_API_RESPONSE_BYTES = 1024 * 1024;
export const MAX_MEDIA_RESPONSE_BYTES = 512 * 1024 * 1024;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = HTTP_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
}

function enforceDeclaredLength(res: Response, maxBytes: number): void {
  const raw = res.headers.get("content-length");
  if (!raw) return;
  const length = Number(raw);
  if (Number.isFinite(length) && length > maxBytes) {
    throw new Error(`response exceeds ${maxBytes} byte limit`);
  }
}

export async function readResponseBytes(res: Response, maxBytes: number): Promise<Uint8Array> {
  enforceDeclaredLength(res, maxBytes);
  if (!res.body) return new Uint8Array();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`response exceeds ${maxBytes} byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function readResponseText(res: Response, maxBytes = MAX_API_RESPONSE_BYTES): Promise<string> {
  return new TextDecoder().decode(await readResponseBytes(res, maxBytes));
}

/** Stream a bounded response to a private temporary file, then atomically replace the target. */
export async function writeResponseToFile(
  res: Response,
  out: string,
  maxBytes = MAX_MEDIA_RESPONSE_BYTES,
): Promise<void> {
  enforceDeclaredLength(res, maxBytes);
  const dir = path.dirname(out);
  const temp = path.join(dir, `.${path.basename(out)}.${process.pid}.${Date.now()}.part`);
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(temp, "wx", 0o600);
    if (res.body) {
      const reader = res.body.getReader();
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel();
            throw new Error(`response exceeds ${maxBytes} byte limit`);
          }
          await handle.write(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.promises.rename(temp, out);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.promises.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}
