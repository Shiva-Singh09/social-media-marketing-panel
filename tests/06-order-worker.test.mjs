/**
 * Phase 2C-2 — order-worker unit tests (pure logic only).
 *
 * The existing suite runs WITHOUT a MongoDB connection (see 02/03 suites), so
 * the DB-backed worker paths (atomic claim, refund transactions, persistence)
 * are exercised by design review + live verification instead. These tests
 * cover the decision core that governs ALL financial safety:
 *
 *   1. transient provider failure  → "transient"  (retryable)
 *   2. permanent provider failure  → "permanent"  (no endless retry)
 *   3. ambiguous failure           → "ambiguous"  (NEVER blind-retried)
 *   4/5. provider status mapping   → correct local statuses
 *   7. unknown provider status     → null (local status left untouched,
 *      never silently promoted to completed)
 *
 * Cases 6/8/9/10 (refund idempotency, concurrent claim, restart recovery,
 * per-order error isolation) depend on live MongoDB semantics and are
 * verified against a real instance, not faked here.
 */
import test from "node:test";
import assert from "assert/strict";
import {
  classifySubmissionFailure,
  mapProviderStatus,
  MAX_SUBMISSION_ATTEMPTS,
  WORKER_BATCH_DEFAULT,
  WORKER_BATCH_MAX,
} from "@/lib/order-worker";
import { SmmApiError } from "@/lib/smm-client";

test("429 is classified transient (retryable)", () => {
  const { disposition } = classifySubmissionFailure(
    new SmmApiError("Provider request failed (HTTP 429).", "provider", { httpStatus: 429 }),
  );
  assert.equal(disposition, "transient");
});

for (const status of [500, 502, 503, 504]) {
  test(`HTTP ${status} is classified transient (retryable)`, () => {
    const { disposition } = classifySubmissionFailure(
      new SmmApiError(`HTTP ${status}`, "provider", { httpStatus: status }),
    );
    assert.equal(disposition, "transient");
  });
}

test("pure network failure before transmission is ambiguous (state unknown)", () => {
  const { disposition } = classifySubmissionFailure(
    new SmmApiError("getaddrinfo ENOTFOUND provider.example", "network"),
  );
  assert.equal(disposition, "ambiguous");
});

for (const status of [400, 401, 403, 422]) {
  test(`HTTP ${status} is classified permanent (not retried)`, () => {
    const { disposition } = classifySubmissionFailure(
      new SmmApiError(`Provider rejected the order (HTTP ${status}).`, "provider", {
        httpStatus: status,
      }),
    );
    assert.equal(disposition, "permanent");
  });
}

test("missing provider configuration is permanent", () => {
  const { disposition } = classifySubmissionFailure(
    new SmmApiError("SMM_API_KEY is not configured", "config"),
  );
  assert.equal(disposition, "permanent");
});

test("TIMEOUT is ambiguous — must NOT be blindly retried or refunded", () => {
  const { disposition, reason } = classifySubmissionFailure(
    new SmmApiError("Provider request timed out after 15000ms", "timeout"),
  );
  assert.equal(disposition, "ambiguous");
  assert.match(reason, /unknown state/i);
});

test("response PARSE failure is ambiguous — provider state unknown", () => {
  const { disposition } = classifySubmissionFailure(
    new SmmApiError("Provider returned an unparseable response.", "parse"),
  );
  assert.equal(disposition, "ambiguous");
});

test("unexpected non-SmmApiError errors are ambiguous (never auto-retried)", () => {
  assert.equal(classifySubmissionFailure(new Error("boom")).disposition, "ambiguous");
  assert.equal(classifySubmissionFailure(undefined).disposition, "ambiguous");
});

test("provider status mapping: completed → completed", () => {
  assert.equal(mapProviderStatus("Completed"), "completed");
});

test("provider status mapping: partial → partial", () => {
  assert.equal(mapProviderStatus("Partial"), "partial");
});

test("provider status mapping: in progress variants → in_progress", () => {
  assert.equal(mapProviderStatus("In progress"), "in_progress");
  assert.equal(mapProviderStatus("INPROGRESS"), "in_progress");
});

test("provider status mapping: processing stays in_progress (never completed)", () => {
  assert.equal(mapProviderStatus("Processing"), "in_progress");
});

test("provider status mapping: cancelled/canceled → cancelled; failed → failed", () => {
  assert.equal(mapProviderStatus("Canceled"), "cancelled");
  assert.equal(mapProviderStatus("cancelled"), "cancelled");
  assert.equal(mapProviderStatus("Failed"), "failed");
});

test("UNKNOWN provider status maps to null — local status is left unchanged", () => {
  assert.equal(mapProviderStatus("weird-new-status"), null);
  // An unknown status must never silently become a terminal one.
  assert.notEqual(mapProviderStatus("weird-new-status"), "completed");
});

test("retry bound is finite and batch size is capped", () => {
  assert.equal(typeof MAX_SUBMISSION_ATTEMPTS, "number");
  assert.ok(MAX_SUBMISSION_ATTEMPTS >= 1 && MAX_SUBMISSION_ATTEMPTS <= 20);
  assert.equal(WORKER_BATCH_DEFAULT, 25);
  assert.ok(WORKER_BATCH_MAX <= 50);
});
