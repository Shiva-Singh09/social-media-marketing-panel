/**
 * Test orchestrator (Phase 2 regression-test foundation).
 * Zero new dependencies: Node's built-in `node:test` runner + the
 * strip-types loader (Node >= 22.6; project runs Node 24).
 *
 * Usage: npm test
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((f) => f.endsWith(".test.mjs"))
  .map((f) => path.join(here, f));

if (files.length === 0) {
  console.error("No test files found in tests/");
  process.exit(1);
}

// Enable the auth/headers stubs for every suite; suites that import real
// auth-adjacent modules get deterministic behavior, everything else is
// unaffected (stubs are opt-in and never active outside `npm test`).
// NODE_ENV is FORCED to "test": suites must never run under production
// configuration (the module hooks additionally refuse the auth stub when
// NODE_ENV === "production", so a leaked SMM_TEST_MOCK_AUTH can never
// substitute authentication in a production process).
const env = {
  ...process.env,
  SMM_TEST_MOCK_AUTH: "1",
  NODE_ENV: "test",
};

const result = spawnSync(
  process.execPath,
  [
    "--test",
    // Spaces in the Windows user path break bare-specifier resolution; a
    // file URL is always a valid --import target.
    "--import",
    pathToFileURL(path.join(here, "register-hooks.mjs")).href,
    ...files,
  ],
  { stdio: "inherit", env },
);
process.exit(result.status ?? 1);
