import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const manifestPath = fileURLToPath(new URL("../package.json", import.meta.url));
const lockfilePath = fileURLToPath(new URL("../../../pnpm-lock.yaml", import.meta.url));

test("core CLI dependency tree does not reintroduce bundled undici", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    dependencies: Record<string, string>;
  };
  const lockfile = readFileSync(lockfilePath, "utf8");

  assert.equal(manifest.dependencies["@blockrun/llm"], "^3.9.0");
  assert.doesNotMatch(lockfile, /^  '@blockrun\/clawrouter@/m);
  assert.doesNotMatch(lockfile, /^  undici@/m);
});
