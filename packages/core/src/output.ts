/**
 * The BlockRun output contract — one machine-readable envelope for every command,
 * across every product. This is the backbone of "agent-native": an AI agent
 * (Franklin, Claude Code) calling any BlockRun CLI can parse the result the same way.
 *
 * Success → stdout, exit 0:  {"ok":true,"data":...,"meta":{...}}
 * Failure → stderr, exit ≠0: {"ok":false,"error":{"type":..,"code":..,"message":..}}
 *
 * Rendering is pure (see `render`) so it is trivially testable; `emit` is the thin
 * side-effecting wrapper that writes to the right stream and sets the exit code.
 */

export type OutputFormat = "json" | "pretty" | "table" | "ndjson" | "csv";

export interface Meta {
  /** USD spent on this call, if it cost anything. */
  cost?: number;
  /** Payment chain the call settled on. */
  chain?: string;
  [key: string]: unknown;
}

export interface OkEnvelope<T = unknown> {
  ok: true;
  data: T;
  meta?: Meta;
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    /** Coarse category: "payment" | "wallet" | "network" | "usage" | "internal" | ... */
    type: string;
    /** Machine code where one exists (e.g. HTTP 402). */
    code?: number;
    message: string;
    retryAfter?: string;
  };
}

export type Envelope<T = unknown> = OkEnvelope<T> | ErrorEnvelope;

export function ok<T>(data: T, meta?: Meta): OkEnvelope<T> {
  return meta ? { ok: true, data, meta } : { ok: true, data };
}

export function err(type: string, message: string, code?: number): ErrorEnvelope {
  return { ok: false, error: code === undefined ? { type, message } : { type, code, message } };
}

/** Pure: turn an envelope into the string that would be printed for a given format. */
export function render(env: Envelope, format: OutputFormat): string {
  switch (format) {
    case "json":
      return JSON.stringify(env);
    case "ndjson":
      // One record per line — for `ok` arrays, stream each element.
      if (env.ok && Array.isArray(env.data)) {
        return env.data.map((row) => JSON.stringify(row)).join("\n");
      }
      return JSON.stringify(env);
    case "table":
    case "csv":
      return renderTabular(env, format);
    case "pretty":
    default:
      return renderPretty(env);
  }
}

function renderPretty(env: Envelope): string {
  if (!env.ok) {
    const c = env.error.code !== undefined ? ` [${env.error.code}]` : "";
    return `✗ ${escapeTerminalText(env.error.type)}${c}: ${escapeTerminalText(env.error.message)}`;
  }
  const lines: string[] = [];
  const { data } = env;
  if (data === null || data === undefined) {
    lines.push("(no output)");
  } else if (typeof data === "object" && !Array.isArray(data)) {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      lines.push(`${escapeTerminalText(k)}: ${escapeTerminalText(formatScalar(v))}`);
    }
  } else if (Array.isArray(data)) {
    for (const row of data) lines.push(`• ${escapeTerminalText(formatScalar(row))}`);
  } else {
    lines.push(escapeTerminalText(String(data)));
  }
  if (env.meta?.cost !== undefined) {
    lines.push(
      `\n  cost: $${env.meta.cost}${env.meta.chain ? ` on ${escapeTerminalText(env.meta.chain)}` : ""}`,
    );
  }
  return lines.join("\n");
}

function renderTabular(env: Envelope, format: OutputFormat): string {
  if (!env.ok) return renderPretty(env);
  const rows = Array.isArray(env.data) ? env.data : [env.data];
  const objs = rows.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
  if (objs.length === 0) return renderPretty(env);
  const cols = [...new Set(objs.flatMap((o) => Object.keys(o)))];
  if (format === "csv") {
    const header = cols.map(csvCell).join(",");
    const body = objs.map((o) => cols.map((c) => csvCell(formatScalar(o[c]))).join(",")).join("\n");
    return `${header}\n${body}`;
  }
  const header = cols.map(escapeTerminalText).join("  ");
  const body = objs
    .map((o) => cols.map((c) => escapeTerminalText(formatScalar(o[c]))).join("  "))
    .join("\n");
  return `${header}\n${body}`;
}

/** Make untrusted text inert when written to a terminal while preserving tabs/newlines. */
export function escapeTerminalText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, (char) => {
    const hex = char.codePointAt(0)!.toString(16).padStart(4, "0");
    return `\\u${hex}`;
  });
}

/** RFC 4180 quoting plus spreadsheet formula neutralization. */
function csvCell(value: string): string {
  const inert = /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${inert.replace(/"/g, '""')}"`;
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export interface EmitOptions {
  format?: OutputFormat;
  /** Injectable for tests; defaults to the real streams. */
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  setExitCode?: (n: number) => void;
}

/** Side-effecting: print the envelope to the correct stream and set the exit code. */
export function emit(env: Envelope, opts: EmitOptions = {}): void {
  const format = opts.format ?? "pretty";
  const out = opts.stdout ?? ((s) => process.stdout.write(s + "\n"));
  const errStream = opts.stderr ?? ((s) => process.stderr.write(s + "\n"));
  const setExit = opts.setExitCode ?? ((n) => (process.exitCode = n));
  const text = render(env, format);
  if (env.ok) {
    out(text);
    setExit(0);
  } else {
    errStream(text);
    setExit(1);
  }
}
