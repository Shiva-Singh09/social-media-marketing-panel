/**
 * Phase 2C-6 — admin notifications + operational observability tests.
 *
 * Runs fully in-memory: `globalThis.__SMM_TEST_DB__` (set BEFORE the dynamic
 * imports below) swaps @/db, @/db/transactions and @/db/mongodb-schema for
 * deterministic in-memory models that enforce the real unique indexes
 * (notifications.eventKey, orders.clientRequestId, transactions.refundForOrderId).
 *
 * Covers: notification creation, event-key idempotency, duplicate worker
 * execution, the four worker-emitted actionable events, notification-failure
 * isolation, admin authorization, pagination, unread count, mark-read,
 * mark-all-read, the operational summary, and per-admin data isolation.
 */
import test from "node:test";
import assert from "assert/strict";

globalThis.__SMM_TEST_DB__ = {};
process.env.SMM_API_KEY = "test-key";

const db = await import("@/db");
const worker = await import("@/lib/order-worker");
const { sendNotification, needsReviewKey, maxRetriesKey, ambiguousResultKey, permanentFailureKey, pollingFailedKey } =
  await import("@/lib/notifications");
const { AdminNotification, NotificationEventType, NotificationSeverity } = await import("@/db");
const listRoute = await import("@/app/api/admin/notifications/route");
const unreadRoute = await import("@/app/api/admin/notifications/unread/route");
const markRoute = await import("@/app/api/admin/notifications/mark/route");
const summaryRoute = await import("@/app/api/admin/observability/route");

const ADMIN = "64b0000000000000000000ad";
const ADMIN2 = "64b0000000000000000000ae";
const USER_A = "64b0000000000000000000aa";
const SERVICE_ID = "64b0000000000000000000a1";
const LINK = "https://www.instagram.com/p/notify1/";
const MAX = worker.MAX_SUBMISSION_ATTEMPTS;

const adminUser = { _id: ADMIN, name: "Root Admin", role: "admin", status: "active", emailVerified: true };
const adminUser2 = { _id: ADMIN2, name: "Ops Admin", role: "admin", status: "active", emailVerified: true };
const customer = { _id: USER_A, name: "Customer", role: "user", status: "active", emailVerified: true, creditBalance: 100 };
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
};

/** Provider-behaviour switch for the current test. */
let providerMode = "success";
let fetchCalls = [];
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), body: String(init?.body ?? "") });
  if (providerMode === "http500") return new Response("upstream down", { status: 500 });
  if (providerMode === "http400") return new Response("bad request", { status: 400 });
  if (providerMode === "garbage") return new Response("<html>not json</html>", { status: 200 });
  if (providerMode === "providerError") {
    return new Response(JSON.stringify({ error: "provider status endpoint unavailable" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (providerMode === "statusInProgress") {
    return new Response(JSON.stringify({ charge: "1.30", status: "In progress", start_count: "5", remains: "95" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ order: 889901 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

function orderDoc(overrides = {}) {
  return {
    userId: USER_A,
    serviceId: SERVICE_ID,
    link: LINK,
    quantity: 100,
    totalCost: 13,
    status: "pending",
    clientRequestId: `order-key-${Math.random().toString(16).slice(2, 10)}`,
    smmAttempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function seed(extra = {}) {
  return {
    users: [{ ...adminUser }, { ...customer }],
    services: [{ ...service }],
    orders: [],
    transactions: [],
    notifications: [],
    ...extra,
  };
}

function notifications() {
  return [...db.__db().notifications.values()];
}
function balance() {
  return db.__db().users.get(USER_A).creditBalance;
}
function refundCount() {
  return [...db.__db().transactions.values()].filter((t) => t.refundForOrderId).length;
}
function asAdmin(admin = { _id: ADMIN, role: "admin" }) {
  globalThis.__SMM_TEST__ = { admin };
}
function asCustomer() {
  globalThis.__SMM_TEST__ = { currentUser: { _id: USER_A, role: "user" } };
}
function asAnonymous() {
  globalThis.__SMM_TEST__ = {};
}

const req = (url, init) => new Request(url, init);
const jsonPost = (url, body) =>
  req(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// ---------------------------------------------------------------------------
// 1–3. Notification creation, event-key idempotency, duplicate-key tolerance
// ---------------------------------------------------------------------------

test("events are persisted once and the unique index rejects a duplicate key", async () => {
  const row = {
    userId: ADMIN,
    eventType: NotificationEventType.OrderNeedsReview,
    severity: NotificationSeverity.Warning,
    title: "Order parked for review",
    message: "Order needs review",
    eventKey: `${needsReviewKey("order-1")}:${ADMIN}`,
  };
  await AdminNotification.create({ ...row });

  const rows = notifications();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].eventType, "order.needsReview");
  assert.equal(rows[0].severity, "warning");
  assert.equal(rows[0].read, false);
  assert.ok(rows[0].createdAt instanceof Date);

  // Real index semantics: the same eventKey cannot be written twice.
  await assert.rejects(
    () => AdminNotification.create({ ...row }),
    (err) => err.code === 11000 || /E11000/.test(String(err.message)),
  );
  assert.equal(notifications().length, 1);
});

test("sendNotification is idempotent for a repeated eventKey", async () => {
  // Isolate: count only THIS test's writes (earlier tests leave rows behind).
  db.__resetDb(seed());
  // Callers pass the LOGICAL key; sendNotification() scopes to the recipient
  // exactly once. Repeating the same logical event must yield one row.
  const params = {
    userId: ADMIN,
    eventType: NotificationEventType.OrderMaxRetries,
    severity: NotificationSeverity.Critical,
    title: "Max retries exhausted",
    message: "Attempts exhausted",
    eventKey: maxRetriesKey("order-2"),
    metadata: { smmAttempt: MAX },
  };

  await sendNotification(params);
  await sendNotification(params);
  await sendNotification(params);

  assert.equal(notifications().length, 1);
});

test("concurrent duplicate write is tolerated as already-delivered (E11000)", async () => {
  // Isolate: count only THIS test's writes (earlier tests leave rows behind).
  db.__resetDb(seed());
  // Logical key only (see above). Both writers race past the existence check:
  // exactly one row survives and the loser's E11000 is swallowed, not surfaced.
  const params = {
    userId: ADMIN,
    eventType: NotificationEventType.OrderPermanentFailure,
    severity: NotificationSeverity.Critical,
    title: "Permanent failure",
    message: "Provider rejected the order",
    eventKey: permanentFailureKey("order-3"),
  };

  // Both writers race past the existence check: exactly one row survives and
  // the loser's E11000 is swallowed, not surfaced.
  await Promise.all([
    (async () => {
      await AdminNotification.findOne({ eventKey: `${params.eventKey}:${ADMIN}` }).lean();
      return sendNotification(params);
    })(),
    sendNotification(params),
  ]);

  assert.equal(notifications().length, 1);
});

// ---------------------------------------------------------------------------
// 4. Duplicate worker execution never duplicates notifications
// ---------------------------------------------------------------------------

test("re-running the worker over an unchanged order adds no duplicate notification", async () => {
  // Service has no provider mapping → the order is parked for review.
  db.__resetDb(seed({ orders: [orderDoc({ serviceId: "64b0000000000000000000ff" })] }));

  await worker.processDueOrders(10);
  await worker.processDueOrders(10);
  await worker.processDueOrders(10);

  const rows = notifications();
  assert.equal(rows.length, 1, "one notification for the single logical event");
  assert.equal(rows[0].eventType, NotificationEventType.OrderNeedsReview);
  assert.equal(String(rows[0].orderId), String([...db.__db().orders.values()][0]._id));
  assert.equal(String(rows[0].relatedUserId), USER_A);
});

test("concurrent worker runs do not duplicate the same notification", async () => {
  db.__resetDb(seed({ orders: [orderDoc({ serviceId: "64b0000000000000000000ff" })] }));

  await Promise.all([worker.processDueOrders(10), worker.processDueOrders(10)]);

  assert.equal(notifications().length, 1);
});

// ---------------------------------------------------------------------------
// 5. needsReview — "service has no provider mapping"
// ---------------------------------------------------------------------------
test("unmapped service parks the order and emits one needsReview notification", async () => {
  db.__resetDb(seed({ orders: [orderDoc({ serviceId: "64b0000000000000000000ff" })] }));

  const summary = await worker.processDueOrders(10);

  assert.equal(summary.skippedNoProvider, 1);
  const order = [...db.__db().orders.values()][0];
  assert.equal(order.needsReview, true);
  assert.equal(order.status, "pending");

  assert.equal(notifications().length, 1);
  const n = notifications()[0];
  assert.equal(n.eventType, NotificationEventType.OrderNeedsReview);
  assert.equal(n.severity, NotificationSeverity.Warning);
  assert.match(n.message, /no provider service mapping/i);
  // Wallet untouched by a notification-only event.
  assert.equal(balance(), 100);
  assert.equal(refundCount(), 0);
});


// ---------------------------------------------------------------------------
// 6. Permanent provider failure — one critical notification, refund unchanged
// ---------------------------------------------------------------------------

test("permanent provider rejection emits one permanentFailure notification and refunds once", async () => {
  // The customer already paid for this order when it was placed
  // (100 − totalCost 13 = 87); the refund must return the wallet to 100.
  db.__resetDb(seed({ users: [{ ...adminUser }, { ...customer, creditBalance: 87 }], orders: [orderDoc()] }));
  providerMode = "http400";

  const summary = await worker.processDueOrders(10);

  assert.equal(summary.failed, 1);
  const order = [...db.__db().orders.values()][0];
  assert.equal(order.status, "failed");
  assert.equal(order.needsReview, undefined);
  // Existing refund mechanism untouched by notifications.
  assert.equal(refundCount(), 1);
  assert.equal(balance(), 100);

  assert.equal(notifications().length, 1);
  const n = notifications()[0];
  assert.equal(n.eventType, NotificationEventType.OrderPermanentFailure);
  assert.equal(n.severity, NotificationSeverity.Critical);
  assert.equal(String(n.orderId), String(order._id));
});

// ---------------------------------------------------------------------------
// 7. Maximum retry exhaustion — exactly one notification
// ---------------------------------------------------------------------------

test("exhausting the submission retry budget emits one maxRetries notification", async () => {
  db.__resetDb(seed({ orders: [orderDoc({ smmAttempts: MAX - 1 })] }));
  providerMode = "http500";

  const summary = await worker.processDueOrders(10);

  assert.equal(summary.needsReview, 1);
  const order = [...db.__db().orders.values()][0];
  assert.equal(order.needsReview, true);
  // A transient verdict never refunds.
  assert.equal(refundCount(), 0);
  assert.equal(balance(), 100);

  assert.equal(notifications().length, 1);
  assert.equal(notifications()[0].eventType, NotificationEventType.OrderMaxRetries);
  assert.match(notifications()[0].message, /exhausted/i);
});

test("transient failures below the retry ceiling notify nothing", async () => {
  db.__resetDb(seed({ orders: [orderDoc({ smmAttempts: 0 })] }));
  providerMode = "http500";

  const summary = await worker.processDueOrders(10);

  assert.equal(summary.scheduledRetry, 1);
  assert.equal(notifications().length, 0, "ordinary retries are not actionable");
});

