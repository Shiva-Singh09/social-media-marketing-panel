import test from "node:test";
import assert from "assert/strict";
import mongoose from "mongoose";
import { rateLimit, limitOrFail, isSensitiveRule } from "@/lib/rate-limit";

// NOTE: these tests run WITHOUT a MongoDB connection on purpose — the
// RateLimitBucket backing store is unreachable, which is exactly the
// "backing store unavailable" scenario. Sensitive rules must fail closed
// (503), non-sensitive rules must fail open (null). The 429-over-limit path
// requires a live store and was verified against a real MongoDB instance in
// the P1/P2 hardening runs.

const SENSITIVE = ["login", "register", "passwordReset", "payment", "order"];
const NON_SENSITIVE = ["general", "support", "schedule", "analytics", "accounts", "smmProcess"];
const RULE = { windowMs: 60_000, max: 5 };
const req = () => new Request("http://localhost/api/x");

test.before(async () => {
  // Store is intentionally unreachable; make buffered mongoose operations
  // fail fast instead of waiting out the default 10s buffering timeout.
  mongoose.set("bufferTimeoutMS", 1);
  await mongoose.disconnect().catch(() => {});
});

test("sensitive rules are classified as sensitive", () => {
  for (const name of SENSITIVE) assert.equal(isSensitiveRule(name), true, name);
});

test("non-sensitive rules are classified as non-sensitive", () => {
  for (const name of NON_SENSITIVE) assert.equal(isSensitiveRule(name), false, name);
});

test("sensitive rules fail CLOSED when the store is unavailable", async () => {
  for (const name of SENSITIVE) {
    await assert.rejects(
      rateLimit(`${name}:203.0.113.7`, RULE, { sensitive: true }),
      (err) => err && err.status === 503,
      `${name} must fail closed`,
    );
  }
});

test("limitOrFail maps sensitive rules to a generic 503", async () => {
  for (const name of SENSITIVE) {
    const err = await limitOrFail(req(), name).then(
      () => null,
      (e) => e,
    );
    assert.ok(err instanceof Error, `${name} limitOrFail must fail`);
    assert.equal(err.status, 503);
    assert.match(err.message, /temporarily unavailable/i);
    // No internal MongoDB details may leak in the generic message.
    assert.doesNotMatch(err.message, /mongo|ECONNREFUSED|mongodb(\+srv)?:\/\//i);
  }
});

test("non-sensitive rules fail OPEN when the store is unavailable", async () => {
  for (const name of NON_SENSITIVE) {
    assert.equal(
      await rateLimit(`${name}:203.0.113.7`, RULE, { sensitive: false }),
      null,
      `${name} must fail open`,
    );
    assert.equal(await limitOrFail(req(), name), null, `${name} limitOrFail must pass through`);
  }
});
