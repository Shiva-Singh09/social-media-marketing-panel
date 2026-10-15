/**
 * Phase 2C-4 — order-creation idempotency & integrity tests.
 *
 * Runs fully in-memory: `globalThis.__SMM_TEST_DB__` (set BEFORE the dynamic
 * imports below) makes tests/module-hooks.mjs swap @/db, @/db/transactions and
 * @/db/mongodb-schema for deterministic in-memory models that enforce the
 * per-user partial-unique clientRequestId index with real E11000 semantics.
 *
 * Race simulation: `Order.create` honours a configurable delay so two
 * concurrent requests truly interleave, and `__bypassReplayOnce()` hides the
 * winning order from exactly one replay lookup — reproducing the
 * "loser reaches the unique index" window deterministically.
 */
import test from "node:test";
import assert from "assert/strict";

globalThis.__SMM_TEST_DB__ = {};
process.env.SMM_API_KEY = "test-key";

const { POST } = await import("@/app/api/services/order/route");
const db = await import("@/db");
const { processDueOrders } = await import("@/lib/order-worker");

const LINK = "https://www.instagram.com/p/test123/";
const KEY = "order-key-0001";
const SERVICE_ID = "64b0000000000000000000a1";
const userA = { _id: "user-a", creditBalance: 100 };
const userB = { _id: "user-b", creditBalance: 100 };
const service = {
  _id: SERVICE_ID,
  name: "Instagram Followers",
  status: "active",
  minQuantity: 10,
  maxQuantity: 100000,
  providerServiceId: 421,
  providerCostPer1000: 100,
  markupPercent: 30,
  pricePer1000: 130,
  categoryId: { platformKey: "instagram", name: "Instagram" },
};

let providerSeq = 777000;
let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  providerSeq += 1;
  return new Response(JSON.stringify({ order: providerSeq }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

function freshSeed(extraOrders = []) {
  return {
    users: [{ ...userA }, { ...userB }],
    services: [{ ...service }],
    orders: [...extraOrders],
    transactions: [],
  };
}

function asUser(user) {
  globalThis.__SMM_TEST__ = { currentUser: { ...user } };
}

async function post(body) {
  const res = await POST(
    new Request("http://localhost/api/services/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

const orderBody = (clientRequestId) => ({
  serviceId: SERVICE_ID,
  link: LINK,
  quantity: 100,
  ...(clientRequestId ? { clientRequestId } : {}),
});

function debitCount() {
  return [...db.__db().transactions.values()].filter((t) => t.type === "debit").length;
}

test.beforeEach(() => {
  db.__resetDb(freshSeed());
  fetchCalls = 0;
});

test("first request creates exactly one order + one debit and links debitTransactionId", async () => {
  asUser(userA);
  const res = await post(orderBody(KEY));

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, "processing");
  assert.ok(res.body.data.smmOrderId > 0);
  assert.equal(res.body.data.chargedCredits, 13);

  const orders = [...db.__db().orders.values()];
  const txs = [...db.__db().transactions.values()];
  assert.equal(orders.length, 1);
  assert.equal(debitCount(), 1);

  const order = orders[0];
  assert.equal(order.clientRequestId, KEY);
  assert.equal(order.status, "processing");
  assert.equal(order.totalCost, 13);
  // The order points at the REAL debit transaction, not just a description.
  assert.ok(order.debitTransactionId);
  assert.equal(String(order.debitTransactionId), String(txs.find((t) => t.type === "debit")._id));
  assert.equal(txs.length, 1);

  // Wallet debited exactly once.
  assert.equal(db.__db().users.get("user-a").creditBalance, 87);
});

test("repeated same clientRequestId replays the original order without a second debit", async () => {
  asUser(userA);
  const first = await post(orderBody(KEY));
  assert.equal(first.status, 201);
  const balanceAfterFirst = db.__db().users.get("user-a").creditBalance;
  const callsAfterFirst = fetchCalls;

  asUser(userA);
  const retry = await post(orderBody(KEY));

  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.duplicate, true);
  assert.equal(retry.body.data.orderId, first.body.data.orderId);
  assert.equal(retry.body.data.status, "processing");

  // No new order, no new debit, no provider call, no balance change.
  assert.equal(db.__db().orders.size, 1);
  assert.equal(debitCount(), 1);
  assert.equal(fetchCalls, callsAfterFirst);
  assert.equal(db.__db().users.get("user-a").creditBalance, balanceAfterFirst);
});

test("same clientRequestId from a DIFFERENT user is isolated — both get their own order", async () => {
  asUser(userA);
  const a = await post(orderBody(KEY));
  assert.equal(a.status, 201);

  asUser(userB);
  const b = await post(orderBody(KEY)); // same key, different user
  assert.equal(b.status, 201);
  assert.notEqual(b.body.data.orderId, a.body.data.orderId);
  assert.ok(!b.body.data.duplicate);

  const orders = [...db.__db().orders.values()];
  assert.equal(orders.length, 2);
  assert.ok(orders.every((o) => o.clientRequestId === KEY));
  assert.equal(debitCount(), 2);
  assert.equal(db.__db().users.get("user-a").creditBalance, 87);
  assert.equal(db.__db().users.get("user-b").creditBalance, 87);
});

test("duplicate-key race: recovery returns the winner's order and compensates the stray debit", async () => {
  // Seed the "winner" order, then hide it from exactly ONE replay lookup —
  // simulating a concurrent request that commits between the loser's replay
  // check and the loser's insert. The unique index must then fire.
  db.__resetDb(
    freshSeed([
      {
        _id: "o-winner",
        userId: "user-a",
        serviceId: SERVICE_ID,
        link: LINK,
        quantity: 100,
        totalCost: 13,
        status: "processing",
        smmOrderId: 42,
        clientRequestId: KEY,
      },
    ]),
  );
  asUser(userA);
  db.__bypassReplayOnce();

  const res = await post(orderBody(KEY));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.duplicate, true);
  assert.equal(res.body.data.orderId, "o-winner");

  // Exactly one order, exactly one debit (the loser's stray writes were
  // compensated — no double charge), balance restored.
  assert.equal(db.__db().orders.size, 1);
  assert.equal(debitCount(), 0); // stray debit deleted; winner's debit pre-dates this request
  assert.equal(db.__db().users.get("user-a").creditBalance, 100);
});

test("concurrent identical requests create exactly one order and one debit", async () => {
  asUser(userA);
  db.__setCreateDelay(10); // both requests interleave inside Order.create

  const [r1, r2] = await Promise.all([
    post(orderBody(KEY)),
    post(orderBody(KEY)),
  ]);
  db.__setCreateDelay(0);

  // Winner gets 201; the loser is refused safely (standalone dev fallback has
  // no rollback, so the insufficient-balance guard fires first — either way
  // the loser is NEVER a second 201 and never a second debit).
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [201, 402]);

  assert.equal(db.__db().orders.size, 1);
  assert.equal(debitCount(), 1);
});

test("existing processing order (submission in flight) is returned safely without re-submitting", async () => {
  db.__resetDb(
    freshSeed([
      {
        _id: "o-proc",
        userId: "user-a",
        serviceId: SERVICE_ID,
        link: LINK,
        quantity: 100,
        totalCost: 13,
        status: "processing",
        smmOrderId: 555,
        submissionInFlight: true,
        clientRequestId: "proc-key-0001",
      },
    ]),
  );
  asUser(userA);

  const res = await post(orderBody("proc-key-0001"));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.duplicate, true);
  assert.equal(res.body.data.orderId, "o-proc");
  assert.equal(res.body.data.status, "processing");
  assert.equal(res.body.data.smmOrderId, 555);

  assert.equal(fetchCalls, 0); // never re-submitted to the provider
  assert.equal(db.__db().orders.size, 1);
  assert.equal(debitCount(), 0);
});

test("completed order replay returns the terminal state without a new charge", async () => {
  db.__resetDb(
    freshSeed([
      {
        _id: "o-done",
        userId: "user-a",
        serviceId: SERVICE_ID,
        link: LINK,
        quantity: 100,
        totalCost: 13,
        status: "completed",
        smmOrderId: 556,
        clientRequestId: "done-key-0001",
      },
    ]),
  );
  asUser(userA);

  const res = await post(orderBody("done-key-0001"));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.duplicate, true);
  assert.equal(res.body.data.status, "completed");
  assert.equal(db.__db().orders.size, 1);
  assert.equal(debitCount(), 0);
  assert.equal(fetchCalls, 0);
});

test("invalid clientRequestId is rejected before any write", async () => {
  asUser(userA);
  for (const bad of ["short", "has spaces!!", "manual-reserved"]) {
    const res = await post(orderBody(bad));
    assert.equal(res.status, 422, `expected 422 for ${bad}`);
  }
  assert.equal(db.__db().orders.size, 0);
  assert.equal(debitCount(), 0);
  assert.equal(fetchCalls, 0);
});

test("omitted clientRequestId gets a server-generated auto- key", async () => {
  asUser(userA);
  const res = await post(orderBody(null));
  assert.equal(res.status, 201);
  const order = [...db.__db().orders.values()][0];
  assert.ok(order.clientRequestId.startsWith("auto-"));
});

test("worker compatibility: automated orders (auto- key, client key, or no key) are processed; manual- orders are not", async () => {
  db.__resetDb(
    freshSeed([
      {
        _id: "o-auto",
        userId: "user-a",
        serviceId: SERVICE_ID,
        link: LINK,
        quantity: 100,
        totalCost: 13,
        status: "pending",
        clientRequestId: "auto-abc123",
      },
      {
        _id: "o-legacy",
        userId: "user-a",
        serviceId: SERVICE_ID,
        link: LINK,
        quantity: 100,
        totalCost: 13,
        status: "pending",
      },
      {
        _id: "o-manual",
        userId: "user-b",
        serviceId: SERVICE_ID,
        link: LINK,
        quantity: 100,
        totalCost: 13,
        status: "pending",
        clientRequestId: "manual-1234abcd",
      },
    ]),
  );

  const summary = await processDueOrders();

  // Only the two automated orders are picked up and submitted.
  assert.equal(summary.due, 2);
  assert.equal(summary.submitted, 2);
  assert.equal(summary.errors.length, 0);

  const orders = db.__db().orders;
  assert.equal(orders.get("o-auto").status, "processing");
  assert.ok(orders.get("o-auto").smmOrderId > 0);
  assert.equal(orders.get("o-legacy").status, "processing");
  assert.ok(orders.get("o-legacy").smmOrderId > 0);
  assert.equal(orders.get("o-auto").submissionInFlight, false);

  // Manual-fulfilment order untouched by the worker: never selected (due == 2
  // above), never claimed, never submitted.
  assert.equal(orders.get("o-manual").status, "pending");
  assert.equal(orders.get("o-manual").workerClaimUntil, undefined);
  assert.equal(orders.get("o-manual").smmOrderId, undefined);
});


