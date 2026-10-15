// Entry loaded via `node --import ./tests/register-hooks.mjs` — registers the
// resolve/load chain (new URL form; a bare relative string gets mangled).
//
// `registerHooks()` (synchronous, same thread) rather than `register()`: the
// async variant runs hooks in a dedicated worker thread where a suite's
// `globalThis` flags do NOT exist (only process.env crosses over at spawn
// time). Suites opt into the in-memory DB with `globalThis.__SMM_TEST_DB__`
// set immediately before their first dynamic import — that only works in the
// same-thread variant.
import { registerHooks } from "node:module";
import { load, resolve } from "./module-hooks.mjs";

registerHooks({ resolve, load });
