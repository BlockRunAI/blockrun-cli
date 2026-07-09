/**
 * `blockrun skills` — ship the CLI's bundled Agent Skills into the user's agent
 * (the Lark-CLI play: don't just be callable by agents, TEACH them how).
 *
 *   skills list        bundled skills + whether each is installed
 *   skills add [name]  copy bundled skill(s) into ~/.claude/skills/
 *
 * Target dir override for tests/other agents: BLOCKRUN_SKILLS_DIR.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, err, type Envelope } from "@blockrun/core";

/** skills/ ships next to dist/ in the published package. */
function bundledDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/commands → package root is two up; dist/commands → also two up.
  return path.resolve(here, "..", "..", "skills");
}

export function targetDir(): string {
  return process.env.BLOCKRUN_SKILLS_DIR || path.join(os.homedir(), ".claude", "skills");
}

function listBundled(): string[] {
  try {
    return fs
      .readdirSync(bundledDir(), { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(bundledDir(), e.name, "SKILL.md")))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function skillsCmd(rest: string[]): Envelope {
  const action = rest[0] ?? "list";
  const bundled = listBundled();

  if (action === "list") {
    const rows = bundled.map((name) => ({
      name,
      installed: fs.existsSync(path.join(targetDir(), name, "SKILL.md")),
    }));
    return ok(rows, { target: targetDir() });
  }

  if (action === "add") {
    const pick = rest[1] ? [rest[1]] : bundled;
    const unknown = pick.filter((n) => !bundled.includes(n));
    if (unknown.length) return err("skills", `unknown skill(s): ${unknown.join(", ")}`, 404);
    const installed: string[] = [];
    for (const name of pick) {
      const dst = path.join(targetDir(), name);
      fs.mkdirSync(dst, { recursive: true });
      fs.cpSync(path.join(bundledDir(), name), dst, { recursive: true });
      installed.push(name);
    }
    return ok({ installed, target: targetDir() });
  }

  return err("usage", "usage: blockrun skills [list|add [name]]", 400);
}
