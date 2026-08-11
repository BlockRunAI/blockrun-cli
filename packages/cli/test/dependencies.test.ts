import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const manifestPath = fileURLToPath(new URL("../package.json", import.meta.url));
const lockfilePath = fileURLToPath(new URL("../../../pnpm-lock.yaml", import.meta.url));

/**
 * Lowest @blockrun/llm that is free of the bundled-undici chain. The guard used
 * to assert the spec equalled "^3.9.0" exactly, which pinned the property to one
 * string: every legitimate bump failed this test for the wrong reason, and the
 * failure ("expected ^3.9.0, got ^3.10.0") named the version rather than the
 * hazard. A floor says what we actually require — do not go below this — and the
 * two lockfile assertions below are what verify the tree really is clean.
 */
const MIN_LLM_MAJOR_MINOR = [3, 9] as const;

test("core CLI dependency tree does not reintroduce bundled undici", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    dependencies: Record<string, string>;
  };
  const lockfile = readFileSync(lockfilePath, "utf8");

  const spec = manifest.dependencies["@blockrun/llm"];
  const m = /^\^(\d+)\.(\d+)\./.exec(spec ?? "");
  assert.ok(m, `@blockrun/llm spec should be a caret range, got ${spec}`);
  const [major, minor] = [Number(m[1]), Number(m[2])];
  assert.equal(major, MIN_LLM_MAJOR_MINOR[0], `@blockrun/llm must stay on v${MIN_LLM_MAJOR_MINOR[0]}`);
  assert.ok(
    minor >= MIN_LLM_MAJOR_MINOR[1],
    `@blockrun/llm floor is ^${MIN_LLM_MAJOR_MINOR.join(".")}.0 (the first release without the bundled-undici chain), got ${spec}`
  );

  // The actual property. Both of these were reintroduced once by a transitive
  // bump, which is why they are asserted against the lockfile rather than the
  // manifest — a manifest can look clean while the resolved tree is not.
  assert.doesNotMatch(lockfile, /^  '@blockrun\/clawrouter@/m);
  assert.doesNotMatch(lockfile, /^  undici@/m);
});

/**
 * Deliberately NOT asserted: bigint-buffer's absence.
 *
 * It is present in this lockfile, and that is a pnpm behaviour rather than a
 * regression. @blockrun/llm 3.10.0 moved @solana/spl-token and @solana/web3.js
 * from optionalDependencies to optional PEER dependencies specifically to keep
 * bigint-buffer — unpatched toBigIntLE overflow, GHSA-3gc7-fjrx-p6mg, no fixed
 * release anywhere — out of dependency trees. npm honours that: a clean
 * `npm install @blockrun/llm` pulls neither package. **pnpm auto-installs
 * optional peers**, so this workspace gets them back regardless of the floor.
 *
 * Verified: the lockfile carries the same two bigint-buffer entries at ^3.9.0
 * and at ^3.10.0, so the bump neither introduced nor removed it here.
 *
 * The consequence worth remembering: that fix protects npm consumers of the
 * SDK, not pnpm ones. Asserting absence here would fail for a reason nobody in
 * this repo can act on, so the hazard is documented instead of guarded.
 */
