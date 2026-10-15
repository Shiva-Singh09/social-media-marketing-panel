import test from "node:test";
import assert from "assert/strict";
import mongoose from "mongoose";
import { runInTransaction, txOpts, supportsTransactions } from "@/db/transactions";

// NOTE: no MongoDB connection is opened here, so supportsTransactions() is
// false (mongoose.connection.db is undefined and NOT cached — a later call
// after connectDB still re-detects a replica set). That makes this the
// deterministic "standalone deployment" scenario for both behaviors.

test("standalone (no tx support) is detected without a connection", async () => {
  assert.equal(await supportsTransactions(), false);
});

test("PRODUCTION refuses to run financial work non-atomically (fail-closed)", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    let callbackRan = false;
    const { ok, error } = await runInTransaction(async () => {
      callbackRan = true;
      return 1;
    });
    assert.equal(ok, false);
    assert.equal(callbackRan, false, "no financial write may execute in prod without transactions");
    assert.ok(error instanceof Error);
    assert.match(error.message, /transactions/i);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("DEVELOPMENT/TEST fallback still executes the callback safely", async () => {
  const { ok, result } = await runInTransaction(async (session) => {
    assert.equal(session, null, "fallback runs without a session");
    return "done";
  });
  assert.equal(ok, true);
  assert.equal(result, "done");
});

test("callback failures are captured as { ok:false, error }", async () => {
  const boom = new Error("credit write failed");
  const { ok, error } = await runInTransaction(async () => {
    throw boom;
  });
  assert.equal(ok, false);
  assert.equal(error, boom);
});

test("txOpts maps sessions for Mongoose options objects", () => {
  assert.deepEqual(txOpts(null), {});
  const fake = /** @type {any} */ ({});
  assert.deepEqual(txOpts(fake), { session: fake });
});

test("sanity: mongoose import intact (schema layer loadable)", () => {
  assert.equal(typeof mongoose.model, "function");
});
