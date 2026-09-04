/**
 * Multimodal generation commands — image / video / music / speech / realface.
 *
 * All are paid x402 calls through the SDK's dedicated clients; every response
 * carries hosted URLs, so the CLI prints URLs by default and only downloads
 * when `--out <file>` is given. Key resolution stays in @blockrun/core.
 */

import { ImageClient, VideoClient, MusicClient, SpeechClient, PortraitClient } from "@blockrun/llm";
import { ok, err, type Envelope } from "@blockrun/core";
import { fetchWithTimeout, MEDIA_TIMEOUT_MS, writeResponseToFile } from "../http.js";

import { sdkOptions, commandError } from "./auth.js";

type Flags = Record<string, string | boolean>;

/** Split rest args into positional words and --flag [value] pairs. */
export function splitFlags(rest: string[]): { words: string[]; flags: Flags } {
  const words: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq > 0) flags[tok.slice(2, eq)] = tok.slice(eq + 1);
      else if (i + 1 < rest.length && !rest[i + 1].startsWith("--")) flags[tok.slice(2)] = rest[++i];
      else flags[tok.slice(2)] = true;
    } else {
      words.push(tok);
    }
  }
  return { words, flags };
}



async function download(url: string, out: string): Promise<string> {
  const res = await fetchWithTimeout(url, {}, MEDIA_TIMEOUT_MS);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  await writeResponseToFile(res, out);
  return out;
}

/** Common tail: print URLs, optionally save the first asset to --out. */
async function finish(urls: string[], flags: Flags, meta: Record<string, unknown>): Promise<Envelope> {
  const extra: Record<string, unknown> = {};
  if (typeof flags.out === "string" && urls[0]) extra.saved = await download(urls[0], flags.out);
  return ok({ urls, ...extra }, meta);
}

/** blockrun image "<prompt>" [--model][--size][--out f.png] · image edit <img-url> "<prompt>" */
export async function imageCmd(rest: string[]): Promise<Envelope> {
  const { words, flags } = splitFlags(rest);
  if (words[0] === "edit" && (!words[1] || !words[2])) return err("usage", 'usage: blockrun image edit <image-url> "<prompt>"', 400);
  if (!words.length) return err("usage", 'usage: blockrun image "<prompt>" [--model m] [--size WxH] [--out f.png]', 400);
  try {
    const client = new ImageClient(sdkOptions());
    if (words[0] === "edit") {
      const [, image, prompt] = words;
      if (!image || !prompt) return err("usage", 'usage: blockrun image edit <image-url> "<prompt>"', 400);
      const r = await client.edit(prompt, image, flags.model ? { model: String(flags.model) } : undefined);
      return finish(r.data.map((d) => d.url), flags, { model: flags.model, kind: "image-edit" });
    }
    const prompt = words.join(" ");
    if (!prompt) return err("usage", 'usage: blockrun image "<prompt>" [--model m] [--size WxH] [--out f.png]', 400);
    const opts: Record<string, unknown> = {};
    if (flags.model) opts.model = String(flags.model);
    if (flags.size) opts.size = String(flags.size);
    const r = await client.generate(prompt, opts);
    return finish(r.data.map((d) => d.url), flags, { kind: "image" });
  } catch (e) {
    return commandError("image", e);
  }
}

/** blockrun video "<prompt>" [--model][--duration s][--out f.mp4] */
export async function videoCmd(rest: string[]): Promise<Envelope> {
  const { words, flags } = splitFlags(rest);
  const prompt = words.join(" ");
  if (!prompt) return err("usage", 'usage: blockrun video "<prompt>" [--model m] [--duration s] [--out f.mp4]', 400);
  try {
    const opts: Record<string, unknown> = {};
    if (flags.model) opts.model = String(flags.model);
    if (flags.duration) opts.durationSeconds = Number(flags.duration);
    const r = await new VideoClient(sdkOptions()).generate(prompt, opts);
    const urls = (r.data as Array<{ url: string }>).map((d) => d.url);
    return finish(urls, flags, { model: r.model, kind: "video" });
  } catch (e) {
    return commandError("video", e);
  }
}

/** blockrun music "<prompt>" [--out f.mp3] */
export async function musicCmd(rest: string[]): Promise<Envelope> {
  const { words, flags } = splitFlags(rest);
  const prompt = words.join(" ");
  if (!prompt) return err("usage", 'usage: blockrun music "<prompt>" [--out f.mp3]', 400);
  try {
    const r = await new MusicClient(sdkOptions()).generate(
      prompt,
      flags.model ? ({ model: String(flags.model) } as never) : undefined,
    );
    return finish(r.data.map((d) => d.url), flags, { model: r.model, kind: "music" });
  } catch (e) {
    return commandError("music", e);
  }
}

/** blockrun speech "<text>" [--voice v][--out f.mp3] · speech voices */
export async function speechCmd(rest: string[]): Promise<Envelope> {
  const { words, flags } = splitFlags(rest);
  if (!words.length) return err("usage", 'usage: blockrun speech "<text>" [--voice v] [--out f.mp3] | speech voices', 400);
  try {
    const client = new SpeechClient(sdkOptions());
    if (words[0] === "voices") {
      const voices = await client.listVoices();
      return ok(voices as unknown as unknown[], { count: (voices as unknown[]).length });
    }
    const text = words.join(" ");
    if (!text) return err("usage", 'usage: blockrun speech "<text>" [--voice v] [--out f.mp3] | speech voices', 400);
    const opts: Record<string, unknown> = {};
    if (flags.voice) opts.voice = String(flags.voice);
    if (flags.model) opts.model = String(flags.model);
    const r = await client.generate(text, opts);
    return finish(r.data.map((d) => d.url), flags, { model: r.model, kind: "speech" });
  } catch (e) {
    return commandError("speech", e);
  }
}

/** blockrun realface enroll <image-url> --name <n> — enroll a consistent AI character. */
export async function realfaceCmd(rest: string[]): Promise<Envelope> {
  const { words, flags } = splitFlags(rest);
  if (words[0] !== "enroll" || !words[1]) {
    return err("usage", "usage: blockrun realface enroll <image-https-url> --name <name>", 400);
  }
  const name = typeof flags.name === "string" ? flags.name : "cli-portrait";
  try {
    const r = await new PortraitClient(sdkOptions()).enroll({ name, imageUrl: words[1] });
    return ok(r as unknown as Record<string, unknown>, { kind: "realface-enroll" });
  } catch (e) {
    return commandError("realface", e);
  }
}
