/**
 * Phase 2 (customer order flow) — focused acceptance regression tests.
 *
 * Every test drives the REAL route handlers (no logic re-implementations):
 *   POST   /api/services/order          (automated ordering)
 *   POST   /api/orders                  (legacy manual-fulfilment ordering)
 *   GET    /api/orders                  (own-orders-only listing)
 *   GET    /api/orders/[id]             (own-orders-only detail, admin bypass)
 *   PUT    /api/admin/orders/[id]       (admin-only gate)
 *
 * Harness (see tests/module-hooks.mjs):
 *   - `globalThis.__SMM_TEST_DB__` (set BEFORE the dynamic imports below)
 *     swaps @/db / @/db/transactions / @/db/mongodb-schema for deterministic
 *     in-memory models — no real MongoDB.
 *   - `globalThis.fetch` is stubbed, so the SMM provider is never contacted;
 *     the response shape is scripted per test (200 order, 4xx, 5xx, non-JSON)
 *     so the REAL smm-client + classifySubmissionFailure logic runs against a
 *     controlled transport.
 *
 * Run standalone:
 *   SMM_TEST_MOCK_AUTH=1 node --import ./tests/register-hooks.mjs tests/11-phase2-order-flow.test.mjs
 * (or simply `npm test`, which auto-discovers this file).
 *
 * Declared limitation: concurrency (double-click races, replica-set
 * interleavings) is covered by suites 08 and 10 with simulated E11000
 * windows; this file covers single-request behavior and replay semantics.
 */
import test from "node:test";
import assert from "assert/strict";

globalThis.__SMM_TEST_DB__ = {};
process.env.SMM_API_KEY = "test-key";

const { POST: serviceOrderPost } = await import("@/app/api/services/order/route");
const { GET: ordersListGet, POST: legacyOrderPost } = await import("@/app/api/orders/route");
const { GET: orderDetailGet } = await import("@/app/api/orders/[id]/route");
const { PUT: adminOrdersPut } = await import("@/app/api/admin/orders/[id]/route");
const db = await import("@/db");

const LINK = "https://www.instagram.com/p/test123/";
const KEY = "phase2-key-0001";
const SERVICE_ID = "64b0000000000000000000a1";
const ORDER_A = "64b0000000000000000000b1";
const ORDER_B = "64b0000000000000000000b2";
const userA = { _id: "user-a", creditBalance: 100, role: "user", status: "active" };
const userB = { _id: "user-b", creditBalance: 100, role: "user", status: "active" };
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

/* ---------------- provider transport scripting ---------------- */
let providerSeq = 777000;
let fetchCalls = 0;
let providerBehavior = "ok"; // ok | http400 | http500 | nonjson
globalThis.fetch = async () => {
  fetchCalls += 1;
  if (providerBehavior === "http400") return new Response("bad request", { status: 400 });
  if (providerBehavior === "http500") return new Response("oops", { status: 500 });
  if (providerBehavior === "nonjson") {
    return new Response("<html>gateway?</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  providerSeq += 1;
  return new Response(JSON.stringify({ order: providerSeq }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

/* ---------------- helpers ---------------- */
function freshSeed(extra = {}) {
  return {
    users: [{ ...userA }, { ...userB }],
    services: [{ ...service }],
    orders: extra.orders ?? [],
    transactions: extra.transactions ?? [],
  };
}

function asUser(user) {
  globalThis.__SMM_TEST__ = { currentUser: { ...user } };
}

async function orderReq(body, user = userA) {
  asUser(user);
  const res = await serviceOrderPost(
    new Request("http://localhost/api/services/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

const orderBody = (overrides = {}) => ({
  serviceId: SERVICE_ID,
  link: LINK,
  quantity: 100,
  clientRequestId: KEY,
  ...overrides,
});

function balanceOf(id = "user-a") {
  return Number(db.__db().users.get(id).creditBalance ?? 0);
}

function debitRows() {
  return [...db.__db().transactions.values()].filter((t) => t.type === "debit");
}

function creditRows() {
  return [...db.__db().transactions.values()].filter((t) => t.type === "credit");
}

function assertNoWrites() {
  assert.equal(db.__db().orders.size, 0, "rejected requests must not create orders");
  assert.equal(db.__db().transactions.size, 0, "rejected requests must not write ledger rows");
  assert.equal(fetchCalls, 0, "rejected requests must never reach the provider");
}

test.beforeEach(() => {
  db.__resetDb(freshSeed());
  asUser(userA);
  fetchCalls = 0;
  providerBehavior = "ok";
});

/* ---------------- request validation & authorization ---------------- */

test("unauthenticated order submission is rejected with 401 and writes nothing", async () => {
  delete globalThis.__SMM_TEST__;
  const res = await serviceOrderPost(
    new Request("http://localhost/api/services/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(orderBody()),
    }),
  );
  assert.equal(res.status, 401);
  assert.equal((await res.json()).success, false);
  assertNoWrites();
  assert.equal(balanceOf(), 100, "balance must be untouched");
});

test("unknown service id → 404 before any write", async () => {
  const res = await orderReq(orderBody({ serviceId: "64b0000000000000000000ff" }));
  assert.equal(res.status, 404);
  assert.equal(res.body.message, "Service not found");
  assertNoWrites();
});

test("inactive service → 400 before any write", async () => {
  db.__resetDb({
    users: [{ ...userA }],
    services: [{ ...service, status: "inactive" }],
    orders: [],
    transactions: [],
  });
  const res = await orderReq(orderBody());
  assert.equal(res.status, 400);
  assert.match(res.body.message, /currently unavailable/i);
  assertNoWrites();
});

test("quantity boundaries: below minimum and above maximum are rejected with 422", async () => {
  for (const quantity of [5, 100001]) {
    const res = await orderReq(orderBody({ quantity }));
    assert.equal(res.status, 422, `quantity ${quantity} must be rejected`);
    assert.match(res.body.message, /Quantity must be between/);
  }
  assertNoWrites();
});

test("insufficient balance → 402 before any write", async () => {
  // (a) Ordinary pre-check: the request principal and the stored row both say
  // the wallet cannot cover the server-side price.
  db.__resetDb({
    users: [{ ...userA, creditBalance: 5 }],
    services: [{ ...service }],
    orders: [],
    transactions: [],
  });
  const direct = await orderReq(orderBody(), { ...userA, creditBalance: 5 });
  assert.equal(direct.status, 402);
  assert.match(direct.body.message, /Insufficient balance/);
  assertNoWrites();
  assert.equal(balanceOf(), 5, "balance must be untouched");

  // (b) Defensive shortfall path: the request-start snapshot (100) fools the
  // pre-check, but the stored row (5) fails the $gte-guarded debit — the
  // transaction must refuse, report required vs the snapshot, and write nothing.
  db.__resetDb({
    users: [{ ...userA, creditBalance: 5 }],
    services: [{ ...service }],
    orders: [],
    transactions: [],
  });
  const raced = await orderReq(orderBody()); // session principal = userA (snapshot 100)
  assert.equal(raced.status, 402);
  assert.match(raced.body.message, /Insufficient balance/);
  assert.equal(raced.body.data.required, 13);
  assert.equal(
    raced.body.data.balance,
    100,
    "the payload echoes the request-start snapshot; the stored row is the authority the guard enforced",
  );
  assertNoWrites();
  assert.equal(balanceOf(), 5, "the guarded debit must leave the stored balance untouched");
});

test("provider not configured → 503 before any write", async () => {
  const saved = process.env.SMM_API_KEY;
  delete process.env.SMM_API_KEY;
  try {
    const res = await orderReq(orderBody());
    assert.equal(res.status, 503);
    assert.match(res.body.message, /provider not configured/i);
  } finally {
    process.env.SMM_API_KEY = saved;
  }
  assertNoWrites();
});

test("client tampering: price/charge/status/provider fields are ignored — server-side pricing wins", async () => {
  const res = await orderReq(
    orderBody({
      // hostile extras — the zod schema is non-strict so these are stripped
      price: 1,
      totalCost: 0,
      charge: 0,
      cost: 0,
      status: "completed",
      smmOrderId: 12345,
      providerServiceId: 999,
      userId: "user-b",
      role: "admin",
    }),
  );

  assert.equal(res.status, 201);
  assert.equal(res.body.data.chargedCredits, 13, "server-computed price (100/1000 × 130) must be charged");
  assert.equal(res.body.data.balance, 87);

  const order = [...db.__db().orders.values()][0];
  assert.equal(Number(order.totalCost), 13, "stored totalCost must be the server price");
  assert.notEqual(order.status, "completed", "client must not choose the order status");
  assert.equal(order.status, "processing");
  assert.notEqual(String(order.smmOrderId), "12345", "provider order id is server-assigned");
  assert.equal(order.userId, "user-a", "client must not re-assign ownership");
  assert.equal(order.price, undefined, "stripped client field must not persist");
  assert.equal(order.charge, undefined, "stripped client field must not persist");
  assert.equal(order.providerServiceId, undefined, "stripped client field must not persist");
  assert.equal(balanceOf("user-b"), 100, "another user's wallet must be untouched");
});

/* ---------------- idempotency (replay semantics beyond suite 08) ---------------- */

test("duplicate clientRequestId with a DIFFERENT payload replays the original order — no second debit, order or provider call", async () => {
  const first = await orderReq(orderBody({ quantity: 100 }));
  assert.equal(first.status, 201);
  assert.equal(first.body.data.chargedCredits, 13);
  assert.equal(fetchCalls, 1);

  // Same key, materially different (more expensive) payload.
  const replay = await orderReq(orderBody({ quantity: 500 }));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.duplicate, true);
  assert.equal(replay.body.data.chargedCredits, 13, "replay must return the ORIGINAL charge");
  assert.equal(replay.body.data.status, "processing");
  assert.equal(replay.body.data.orderId, first.body.data.orderId);

  assert.equal(db.__db().orders.size, 1, "no second order for a replayed key");
  assert.equal(debitRows().length, 1, "no second debit for a replayed key");
  assert.equal(fetchCalls, 1, "no second provider submission");
  assert.equal(balanceOf(), 87, "wallet debited exactly once");
});

/* ---------------- order ↔ ledger ↔ balance consistency ---------------- */

test("successful order keeps order, debit ledger and wallet balance consistent", async () => {
  const res = await orderReq(orderBody());
  assert.equal(res.status, 201);

  const order = [...db.__db().orders.values()][0];
  const debits = debitRows();
  assert.equal(debits.length, 1);
  const debit = debits[0];
  assert.equal(debit.userId, "user-a");
  assert.equal(Number(debit.amount), 13);
  assert.equal(debit.paymentStatus, "success");
  assert.equal(Number(order.totalCost), Number(debit.amount), "ledger amount must equal the order total");
  assert.equal(String(order.debitTransactionId), String(debit._id), "order must link its wallet debit");
  assert.equal(balanceOf(), 100 - 13, "balance must equal start − totalCost");
  assert.equal(res.body.data.balance, 87);
});

/* ---------------- provider outcomes: reject vs ambiguous vs transient ---------------- */

test("provider permanent rejection (HTTP 400) → 502 with a full refund and failed order", async () => {
  providerBehavior = "http400";
  const res = await orderReq(orderBody());

  assert.equal(res.status, 502);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /refunded/i);
  assert.equal(res.body.data.refunded, 13);

  const order = [...db.__db().orders.values()][0];
  assert.equal(order.status, "failed");
  assert.match(order.adminNote, /HTTP 400/);

  const credits = creditRows();
  assert.equal(credits.length, 1, "exactly one refund ledger row");
  assert.equal(Number(credits[0].amount), 13);
  assert.equal(balanceOf(), 100, "wallet must be restored to its starting balance");
});

test("provider ambiguous outcome (200 with non-JSON body) → 202 parked for review, NO refund, credits held", async () => {
  providerBehavior = "nonjson";
  const res = await orderReq(orderBody());

  assert.equal(res.status, 202);
  assert.equal(res.body.data.review, true);
  assert.equal(res.body.data.chargedCredits, 13);

  const order = [...db.__db().orders.values()][0];
  assert.equal(order.status, "pending", "ambiguous order must stay pending (never refunded, never promoted)");
  assert.equal(order.needsReview, true, "admin must be able to see the parked order");

  assert.equal(creditRows().length, 0, "ambiguous outcomes must NOT auto-refund (provider state unknown)");
  assert.equal(balanceOf(), 87, "credits stay held while the state is unknown");
});

test("provider transient failure (HTTP 500) → 202 queued for worker retry, NO refund", async () => {
  providerBehavior = "http500";
  const res = await orderReq(orderBody());

  assert.equal(res.status, 202);
  assert.equal(res.body.data.retry, true);
  assert.equal(res.body.data.status, "pending");

  const order = [...db.__db().orders.values()][0];
  assert.equal(order.status, "pending");
  assert.equal(order.smmAttempts, 1);
  assert.ok(order.nextRetryAt, "retry backoff timestamp must be persisted for the worker");
  assert.match(order.smmLastError, /HTTP 500/);

  assert.equal(creditRows().length, 0, "transient failures must NOT refund — the worker retries");
  assert.equal(balanceOf(), 87);
});

test("retry after a transient failure: replaying the key returns the queued order without a new debit or resubmission", async () => {
  providerBehavior = "http500";
  const first = await orderReq(orderBody());
  assert.equal(first.status, 202);

  providerBehavior = "ok"; // provider recovered — the replay must still not resubmit
  const replay = await orderReq(orderBody());
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.duplicate, true);
  assert.equal(replay.body.data.status, "pending");

  assert.equal(db.__db().orders.size, 1);
  assert.equal(debitRows().length, 1, "no duplicate debit on retry");
  assert.equal(creditRows().length, 0, "no refund on retry");
  assert.equal(fetchCalls, 1, "replay must never re-submit to the provider");
  assert.equal(balanceOf(), 87, "exactly one hold on the wallet");
});

/* ---------------- own-orders-only visibility & admin-only operations ---------------- */

test("GET /api/orders returns only the caller's own orders", async () => {
  db.__resetDb({
    users: [{ ...userA }, { ...userB }],
    services: [{ ...service }],
    orders: [
      { _id: ORDER_A, userId: "user-a", serviceId: SERVICE_ID, link: LINK, quantity: 100, totalCost: 13, status: "processing" },
      { _id: ORDER_B, userId: "user-b", serviceId: SERVICE_ID, link: LINK, quantity: 200, totalCost: 26, status: "processing" },
    ],
    transactions: [],
  });
  asUser(userA);

  const res = await ordersListGet(new Request("http://localhost/api/orders"));
  assert.equal(res.status, 200);
  const { orders, pagination } = (await res.json()).data;
  assert.equal(orders.length, 1, "another customer's order must never be listed");
  assert.equal(pagination.total, 1);
  assert.equal(String(orders[0].id), ORDER_A);
});

test("GET /api/orders/[id] hides other customers' orders (404) but serves the owner and admins", async () => {
  db.__resetDb({
    users: [{ ...userA }, { ...userB }, { _id: "admin-1", role: "admin", status: "active", creditBalance: 0 }],
    services: [{ ...service }],
    orders: [
      { _id: ORDER_A, userId: "user-a", serviceId: SERVICE_ID, link: LINK, quantity: 100, totalCost: 13, status: "processing" },
      { _id: ORDER_B, userId: "user-b", serviceId: SERVICE_ID, link: LINK, quantity: 200, totalCost: 26, status: "processing" },
    ],
    transactions: [],
  });
  const detail = (id) =>
    orderDetailGet(new Request(`http://localhost/api/orders/${id}`), { params: Promise.resolve({ id }) });

  asUser(userA);
  assert.equal((await detail(ORDER_A)).status, 200, "owner can read their own order");
  const foreign = await detail(ORDER_B);
  assert.equal(foreign.status, 404, "a customer must not read another customer's order");

  asUser({ _id: "admin-1", role: "admin" });
  assert.equal((await detail(ORDER_B)).status, 200, "admins can read any order");
});

test("admin-only operations: order updates reject anonymous (401) and ordinary (403) callers", async () => {
  db.__resetDb({
    users: [{ ...userA }],
    services: [{ ...service }],
    orders: [{ _id: ORDER_A, userId: "user-a", serviceId: SERVICE_ID, link: LINK, quantity: 100, totalCost: 13, status: "processing" }],
    transactions: [],
  });
  const put = async () => {
    const res = await adminOrdersPut(
      new Request(`http://localhost/api/admin/orders/${ORDER_A}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      }),
      { params: Promise.resolve({ id: ORDER_A }) },
    );
    return { status: res.status, body: await res.json() };
  };

  delete globalThis.__SMM_TEST__;
  const anon = await put();
  assert.equal(anon.status, 401);
  assert.equal(anon.body.success, false);

  globalThis.__SMM_TEST__ = { admin: { _id: "user-a", role: "user" } };
  const customer = await put();
  assert.equal(customer.status, 403);
  assert.equal(customer.body.success, false);

  assert.equal(db.__db().orders.get(ORDER_A).status, "processing", "rejected callers must not mutate the order");
  assert.equal(balanceOf("user-a"), 100, "rejected callers must not trigger refunds");
});

/* ---------------- legacy manual-fulfilment route ---------------- */

test("legacy POST /api/orders strips client money fields and prices server-side", async () => {
  asUser(userA);
  const res = await legacyOrderPost(
    new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serviceId: SERVICE_ID, link: LINK, quantity: 100, price: 1, totalCost: 0 }),
    }),
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.data.balance, 87, "server-side price is charged, not the client's");

  const order = [...db.__db().orders.values()][0];
  assert.equal(Number(order.totalCost), 13);
  assert.ok(order.clientRequestId.startsWith("manual-"), "legacy orders are tagged manual- for the worker");
  assert.equal(debitRows().length, 1);
  assert.equal(fetchCalls, 0, "manual orders are never submitted by this route");
});
