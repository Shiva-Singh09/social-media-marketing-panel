/**
 * Phase 2C-3 — /api/orders/process cron authentication tests.
 *
 * Runs WITHOUT MongoDB (project convention): rate limiting for "smmProcess"
 * fails open without the store, and an authenticated call surfaces the DB
 * error via handle() (500) — which proves the request PASSED authentication
 * and reached the worker (an auth failure would be 401/403/503 instead).
 */
import test from "node:test";
import assert from "assert/strict";
import mongoose from "mongoose";
import { POST } from "@/app/api/orders/process/route";

const secret = "cron-secret-0123456789abcdef0123456789abcdef"; // 40 chars
const post = (headers = {}) =>
  POST(new Request("http://localhost/api/orders/process", { method: "POST", headers }));

test.before(async () => {
  mongoose.set("bufferTimeoutMS", 1);
  await mongoose.disconnect().catch(() => {});
});

test("missing CRON_SECRET config is rejected with 503 (never unauthenticated access)", async () => {
  const prev = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try {
    const res = await post();
    assert.equal(res.status, 503);
  } finally {
    restore(prev);
  }
});

test("invalid cron secret is rejected with 401", async () => {
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = secret;
  try {
    const res = await post({ "x-cron-secret": "wrong-secret" });
    assert.equal(res.status, 401);
  } finally {
    restore(prev);
  }
});

test("missing header with configured secret is rejected with 401", async () => {
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = secret;
  try {
    const res = await post();
    assert.equal(res.status, 401);
  } finally {
    restore(prev);
  }
});

test("short secret is rejected in PRODUCTION (503, fail closed)", async () => {
  const prev = process.env.CRON_SECRET;
  const prevEnv = process.env.NODE_ENV;
  process.env.CRON_SECRET = "short";
  process.env.NODE_ENV = "production";
  try {
    const res = await post({ "x-cron-secret": "short" });
    assert.equal(res.status, 503);
  } finally {
    process.env.NODE_ENV = prevEnv;
    restore(prev);
  }
});

test("valid cron secret PASSES authentication and reaches the worker", async () => {
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = secret;
  try {
    const res = await post({ "x-cron-secret": secret });
    // No DB here: the worker's first query fails and handle() maps it to 500.
    // The critical assertion is that it is NOT 401/403/503 — i.e. the secret
    // was accepted and processDueOrders() was actually invoked.
    assert.ok([500].includes(res.status), `unexpected status ${res.status}`);
    const body = await res.json();
    assert.doesNotMatch(body.message ?? "", /invalid worker credentials|requires CRON_SECRET/i);
  } finally {
    restore(prev);
  }
});

function restore(prev) {
  if (prev === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = prev;
}
