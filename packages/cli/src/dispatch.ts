/**
 * Sub-product discovery & forwarding — the gh / Docker model.
 *
 * Any `blockrun-<x>` executable on PATH automatically becomes `blockrun <x>`,
 * with all args forwarded verbatim. Sub-products stay independently installable;
 * the umbrella never bundles them and never overrides a core command.
 *
 * Discovery is pure and injectable (`which`, `pathEnv`) so it is fully unit-testable
 * without spawning anything or depending on what happens to be installed.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Commands the umbrella owns itself — a sub-product can never shadow these. */
export const CORE_COMMANDS = new Set([
  "status",
  "wallet",
  "balance",
  "fund",
  "chain",
  "run",
  "chat",
  "models",
  "image",
  "video",
  "music",
  "speech",
  "realface",
  "search",
  "research",
  "predict",
  "crypto",
  "price",
  "rpc",
  "discover",
  "api",
  "pay",
  "limits",
  "policy",
  "spend",
  "doctor",
  "config",
  "version",
  "help",
  "ext",
  "skills",
  "upgrade",
]);

/**
 * Known sub-product aliases: a friendly umbrella verb → candidate executables,
 * tried in order. `blockrun-*` is always tried first (generic discovery) so this
 * map is only the curated fallbacks + which npm package installs each.
 */
export const SUBPRODUCTS: Record<string, { candidates: string[]; pkg: string }> = {
  route: { candidates: ["blockrun-clawrouter", "clawrouter"], pkg: "@blockrun/clawrouter" },
  agent: { candidates: ["blockrun-franklin", "franklin"], pkg: "@blockrun/franklin" },
  mcp: { candidates: ["blockrun-mcp"], pkg: "@blockrun/mcp" },
  codex: { candidates: ["blockrun-codex", "clawrouter-codex"], pkg: "@blockrun/clawrouter-codex" },
  phone: { candidates: ["blockrun-clawrouter", "clawrouter"], pkg: "@blockrun/clawrouter" },
  share: { candidates: ["blockrun-clawrouter", "clawrouter"], pkg: "@blockrun/clawrouter" },
  partners: { candidates: ["blockrun-clawrouter", "clawrouter"], pkg: "@blockrun/clawrouter" },
  social: { candidates: ["blockrun-franklin", "franklin"], pkg: "@blockrun/franklin" },
  slack: { candidates: ["blockrun-franklin", "franklin"], pkg: "@blockrun/franklin" },
  telegram: { candidates: ["blockrun-franklin", "franklin"], pkg: "@blockrun/franklin" },
};

export type WhichFn = (name: string) => string | null;

/** Default PATH scanner: returns the absolute path of an executable, or null. */
export function makeWhich(pathEnv = process.env.PATH ?? "", existsFn = isExecutable): WhichFn {
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  return (name: string) => {
    for (const dir of dirs) {
      const full = path.join(dir, name);
      if (existsFn(full)) return full;
    }
    return null;
  };
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export type DispatchPlan =
  | { kind: "core"; command: string }
  | { kind: "run"; command: string; bin: string; args: string[] }
  | { kind: "invalid"; command: string }
  | { kind: "missing"; command: string; candidates: string[]; pkg: string | null };

/** Extension commands are single slugs, never paths or package-manager flags. */
export const SAFE_COMMAND = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Decide what to do with `blockrun <command> ...rest`, without side effects.
 *  - core command  → the umbrella handles it
 *  - found binary  → run it (bin + forwarded args)
 *  - known but not installed → missing (with install hint)
 */
export function planDispatch(command: string, rest: string[], which: WhichFn): DispatchPlan {
  if (CORE_COMMANDS.has(command)) return { kind: "core", command };
  if (!SAFE_COMMAND.test(command)) return { kind: "invalid", command };

  const generic = `blockrun-${command}`;
  const known = SUBPRODUCTS[command];
  const candidates = [generic, ...(known?.candidates ?? [])];
  // De-dup while preserving order (generic may equal a known candidate).
  const ordered = [...new Set(candidates)];

  for (const name of ordered) {
    const bin = which(name);
    if (bin) return { kind: "run", command, bin, args: rest };
  }
  return { kind: "missing", command, candidates: ordered, pkg: known?.pkg ?? null };
}
