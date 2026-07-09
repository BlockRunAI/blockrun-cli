/**
 * `blockrun ext` — manage sub-products (the gh-extension model).
 *
 *   ext list             what's discoverable/installed right now
 *   ext install <name>   npm i -g the mapped package (route/agent/mcp/codex/…)
 *   ext remove <name>    npm rm -g the mapped package
 *
 * Discovery stays prefix-based (`blockrun-<x>` on PATH); install/remove are
 * conveniences over the SUBPRODUCTS map so `blockrun route` "just works" after
 * `blockrun ext install route`.
 */

import { spawnSync } from "node:child_process";
import { ok, err, type Envelope } from "@blockrun/core";
import { SUBPRODUCTS, makeWhich, type WhichFn } from "../dispatch.js";

/** Resolve an ext name to its npm package: mapped alias first, else @blockrun/<name>. */
export function pkgFor(name: string): string {
  return SUBPRODUCTS[name]?.pkg ?? `@blockrun/${name}`;
}

export function extList(which: WhichFn = makeWhich()): Envelope {
  const rows: Array<{ command: string; pkg: string; installed: boolean; bin?: string }> = [];
  const seen = new Set<string>();
  for (const [command, { candidates, pkg }] of Object.entries(SUBPRODUCTS)) {
    if (seen.has(pkg + command)) continue;
    seen.add(pkg + command);
    let bin: string | null = null;
    for (const c of [`blockrun-${command}`, ...candidates]) {
      bin = which(c);
      if (bin) break;
    }
    rows.push({ command, pkg, installed: !!bin, ...(bin ? { bin } : {}) });
  }
  return ok(rows, { hint: "any `blockrun-<x>` on PATH is auto-discovered as `blockrun <x>`" });
}

function npmGlobal(args: string[]): { status: number; out: string } {
  const r = spawnSync("npm", args, { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout || "") + (r.stderr || "") };
}

/** Sub-product names are simple slugs — reject anything that could smuggle npm args/paths. */
const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function extInstall(name: string | undefined): Envelope {
  if (!name) return err("usage", "usage: blockrun ext install <route|agent|mcp|codex|phone|...>", 400);
  if (!SAFE_NAME.test(name)) return err("usage", `invalid extension name: ${name}`, 400);
  const pkg = pkgFor(name);
  const r = npmGlobal(["install", "-g", pkg]);
  if (r.status !== 0) return err("ext", `npm install -g ${pkg} failed:\n${r.out.slice(-400)}`, r.status);
  return ok({ installed: pkg, command: `blockrun ${name}` });
}

export function extRemove(name: string | undefined): Envelope {
  if (!name) return err("usage", "usage: blockrun ext remove <name>", 400);
  if (!SAFE_NAME.test(name)) return err("usage", `invalid extension name: ${name}`, 400);
  const pkg = pkgFor(name);
  const r = npmGlobal(["remove", "-g", pkg]);
  if (r.status !== 0) return err("ext", `npm remove -g ${pkg} failed:\n${r.out.slice(-400)}`, r.status);
  return ok({ removed: pkg });
}

/** blockrun upgrade — npm-update every installed sub-product (and report the shell). */
export function upgradeCmd(which: WhichFn = makeWhich()): Envelope {
  const rows: Array<{ pkg: string; status: string }> = [];
  const seen = new Set<string>();
  for (const [command, { candidates, pkg }] of Object.entries(SUBPRODUCTS)) {
    if (seen.has(pkg)) continue;
    seen.add(pkg);
    const installed = [`blockrun-${command}`, ...candidates].some((c) => which(c));
    if (!installed) continue;
    const r = npmGlobal(["install", "-g", `${pkg}@latest`]);
    rows.push({ pkg, status: r.status === 0 ? "upgraded" : `failed: ${r.out.slice(-120)}` });
  }
  return ok(rows, { note: "upgrade the shell itself with: npm i -g @blockrun/cli@latest" });
}

export function extCmd(rest: string[]): Envelope {
  const [action, name] = rest;
  if (!action || action === "list") return extList();
  if (action === "install") return extInstall(name);
  if (action === "remove" || action === "uninstall") return extRemove(name);
  return err("usage", `unknown ext action: ${action} (use list|install|remove)`, 400);
}
