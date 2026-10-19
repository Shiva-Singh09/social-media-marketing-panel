/** Financial race-regression tests (Phase 1).
 *
 * Run under the project's established harness:
 *   node tests/run.mjs        (auto-discovers this file)
 *   node --import ./tests/register-hooks.mjs tests/10-financial-race-regression.test.mjs
 *
 * The test-only environment is fully in-memory: setting
 * `globalThis.__SMM_TEST_DB__` (before the dynamic imports below) makes the
 * registered hooks (`tests/module-hooks.mjs`) substitute the real @/db models
 * with deterministic in-memory stores. No real MongoDB, no live Razorpay
 * calls, no destructive database operations.
 *
 * Concurrency limitation (declared, not hidden):
 *   This environment runs the state-mutating route calls sequentially inside a
 *   single event loop and cannot simulate an OS-level / replica-set pipe race.
 *   What the tests exercise is the production write-time guard itself:
 *     * a `$gte` conditional user debit that refuses the unaffordable write,
 *     * a claim/conditional-status guard on the order refund path, and
 *     * the production `refundForOrderId` idempotency contract at the
 *       application/transaction level.
 *   The lower-level unique-index `E11000` safety net on
 *   `Transaction.refundForOrderId` is not enforceable in the in-memory stub,
 *   so that specific index-level duplicate-key path is not asserted here.
 */
import test from "node:test";
import assert from "assert/strict";

const USER_ID = "600000000000000000000001";
const ADMIN_ID = "600000000000000000000002";
const BASE_URL = "http://localhost";
const ADMIN = { _id: ADMIN_ID, role: "admin" };

globalThis.__SMM_TEST_DB__ = {};
process.env.SMM_API_KEY = "test-key";
globalThis.__SMM_TEST__ = { admin: { ...ADMIN } };

const { PUT: adminUsersPut } = await import("@/app/api/admin/users/[id]/route");
const { PUT: adminOrdersPut } = await import("@/app/api/admin/orders/[id]/route");
const db = await import("@/db");

/**
 * Balance (debit/debit-reply test helper).
 */
function freshBalanceSeed(balanceForA = 10) {
  return {
    users: [
      { _id: USER_ID, creditBalance: balanceForA, role: "user", status: "active", name: "BalanceUser" },
      { _id: ADMIN_ID, creditBalance: 999, role: "admin", status: "active", name: "BalanceAdmin" },
    ],
    services: [],
    orders: [],
    transactions: [],
  };
}

function debitCount() {
  return [...db.__db().transactions.values()].filter((t) => t.type === "debit").length;
}

test("concurrentDebitsInsufficientFunds: at most the affordable debit succeeds", async () => {
  await db.__resetDb(freshBalanceSeed(10));
  const USER = { _id: USER_ID };

  async function putBalance(balanceAdjustment) {
    const res = await adminUsersPut(
      new Request(`${BASE_URL}/api/admin/users/${USER_ID}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ balanceAdjustment }),
      }),
      { params: Promise.resolve({ id: USER_ID }) },
    );
    return { status: res.status, body: await res.json() };
  }

  // Only the first, affordable request is accepted. The second must fail at the
  // write-time guard. For this deterministic harness: Node processes the
  // state-mutating route calls sequentially inside one event loop; real OS/pipe
  // races cannot be reproduced in this environment (see file note). The guard
  // itself is the $gte conditional database write, which is executed here.
  const affordable = await putBalance(-10);
  assert.equal(affordable.status, 200, "affordable debit must succeed");
  assert.equal(affordable.body.success, true);
  assert.equal(Number(affordable.body.data.user.creditBalance), 0, "affordable debit must consume exactly the available balance");
  assert.equal(debitCount(), 1, "exactly one debit ledger entry for the successful debit");

  const unaffordable = await putBalance(-5);
  assert.equal(
    unaffordable.status,
    402,
    "insufficient balance must be an application error (402), not an HTTP 500",
  );
  assert.equal(unaffordable.body.success, false);
  assert.ok(
    String(unaffordable.body.message).toLowerCase().includes("insufficient balance"),
    "error message must identify insufficient balance",
  );
  assert.equal(
    Number(unaffordable.body.data?.balance),
    0,
    "response balance must be the current balance, not the requested debit amount",
  );
  assert.equal(unaffordable.body.data?.required, 5, "response required must be the requested debit amount");
  assert.equal(unaffordable.body.data?.balance, unaffordable.body.data?.balance);

  // No failed debit may create a successful debit ledger entry, and the
  // successful debit/balance change stays consistent.
  assert.equal(debitCount(), 1, "a failed debit must not create a debit ledger entry");
  assert.equal(
    Number(db.__db().users.get(USER_ID).creditBalance),
    0,
    "wallet balance must never go negative",
  );
});

/**
 * Repeated-refund test helper.
 */
function freshRefundSeed(user, admin) {
  return {
    users: [user, admin],
    services: [],
    orders: [
      {
        _id: "600000000000000000000003",
        userId: user._id,
        serviceId: "600000000000000000000003",
        link: "https://www.instagram.com/p/test123/",
        quantity: 100,
        totalCost: 10,
        status: "processing",
      },
    ],
    transactions: [],
  };
}

test("repeatedRefundDoesNotDoubleCredit: the same eligible order is refunded exactly once", async () => {
  const owner = { _id: USER_ID, creditBalance: 20, role: "user", status: "active", name: "RefundOwner" };
  const adminUser = { _id: ADMIN_ID, creditBalance: 999, role: "admin", status: "active", name: "RefundAdmin" };
  await db.__resetDb(freshRefundSeed(owner, adminUser));

  async function putOrder(status) {
    const res = await adminOrdersPut(
      new Request(`${BASE_URL}/api/admin/orders/600000000000000000000003`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      }),
      { params: Promise.resolve({ id: "600000000000000000000003" }) },
    );
    return { status: res.status, body: await res.json() };
  }

  // First eligible transition: processing -> cancelled triggers the refund lock.
  const first = await putOrder("cancelled");
  assert.equal(first.status, 200, "first refund transition must succeed");
  assert.equal(first.body.success, true);
  assert.equal(first.body.data.refunded, true, "first call must claim and perform the refund");
  assert.equal(
    Number(db.__db().users.get(USER_ID).creditBalance),
    30,
    "wallet must receive the exact refunded amount on top of its starting balance",
  );

  const creditRows = [...db.__db().transactions.values()].filter(
    (t) => t.type === "credit" && t.refundForOrderId === "600000000000000000000003",
  );
  assert.equal(creditRows.length, 1, "exactly one refund ledger record for the order");

  // Repeated execution on an already-terminal refund state must not double the
  // credit or append a second refund ledger row. Future writes target the same
  // order after the claim has been taken, so the idempotent guard stays intact.
  const second = await putOrder("cancelled");
  assert.equal(second.status, 200, "repeated refund attempt must not error");
  assert.equal(second.body.success, true);
  assert.equal(second.body.data.refunded, false, "repeated attempt must not re-run the refund path");
  assert.equal(
    Number(db.__db().users.get(USER_ID).creditBalance),
    30,
    "duplicate attempt must not add another credit to the wallet",
  );
  assert.equal(
    [...db.__db().transactions.values()].filter((t) => t.type === "credit").length,
    1,
    "duplicate attempt must not append a second credit ledger row",
  );
});

