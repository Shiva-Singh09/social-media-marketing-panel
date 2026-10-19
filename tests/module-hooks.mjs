/**
 * Test-only module hooks (Phase 2 regression-test foundation).
 *
 * Two jobs, both gated so production code paths stay untouched:
 *   1. `@/*` path-alias resolution — the app's tsconfig paths work inside
 *      Next, but plain `node --test` does not read tsconfig, so these hooks
 *      map `@/x` to `src/x.ts` (with .ts / /index.ts probing).
 *   2. When `SMM_TEST_MOCK_AUTH=1`, `@/lib/auth` and `next/headers` are
 *      replaced by deterministic stubs driven via `globalThis.__SMM_TEST__`,
 *      so route handlers can be exercised without real sessions.
 *      Everything else (models, zod validators, api envelope) stays REAL.
 *
 * Registered from tests/run.mjs via `--import ./tests/register-hooks.mjs`.
 * Never enabled in the Next.js runtime (the flag is only set by tests).
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const VIRTUAL_PREFIX = "smm-test-virtual:";

// Bare specifiers cannot be resolved from a virtual-scheme module URL (Node's
// default resolver walks the parent URL for the package scope and throws
// ERR_INVALID_URL), so the in-memory DB stub imports mongoose through an
// absolute file URL computed on the real filesystem.
const MONGOOSE_URL = pathToFileURL(
  createRequire(import.meta.url).resolve("mongoose"),
).href;

const stubAuthSource = `
// Test stub for @/lib/auth (deterministic, no real JWT/session machinery).
// Role-aware so authorization suites can exercise the admin gate:
//   __SMM_TEST__.admin === undefined -> 401 (unauthenticated)
//   admin.role !== "admin"           -> 403 (non-admin)
//   admin.role === "admin"           -> passes the gate
export const SESSION_COOKIE = "smm_token";
export class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
function gate() {
  // No test state at all = no session = unauthenticated (401), matching the
  // real auth middleware. ( Suites deliberately exercise this path.)
  const state = globalThis.__SMM_TEST__ ?? null;
  const admin = state?.admin;
  if (!admin) throw new HttpError("Authentication required", 401);
  if (admin.role !== "admin") throw new HttpError("Admin access required", 403);
  return admin;
}
export async function requireAdmin() {
  return gate();
}
export async function requireUser() {
  const state = globalThis.__SMM_TEST__ ?? null;
  const user = state?.currentUser ?? state?.admin ?? null;
  if (!user) throw new HttpError("Authentication required", 401);
  return user;
}
export async function getCurrentUser() {
  return globalThis.__SMM_TEST__?.currentUser ?? null;
}
export async function hashPassword(p) { return "hashed:" + p; }
export async function comparePassword() { return false; }
export async function signToken() { return "test-token"; }
export async function verifyToken() { return null; }
export async function setSessionCookie() {}
export async function clearSessionCookie() {}
export async function getTokenFromRequest() { return null; }
export function toSafeUser(user) {
  // Mirror the real @/lib/auth toSafeUser contract: security-sensitive fields
  // must never leave the API, even through the stubbed auth module.
  const raw = user?.toObject?.() ?? user;
  if (!raw || typeof raw !== "object") return raw;
  const {
    password: _password,
    verificationToken: _verificationToken,
    verificationTokenExpires: _verificationTokenExpires,
    resetPasswordToken: _resetPasswordToken,
    resetPasswordExpires: _resetPasswordExpires,
    failedLoginAttempts: _failedLoginAttempts,
    loginLockUntil: _loginLockUntil,
    ...safe
  } = raw;
  return safe;
}
`;

const stubDbTransactionsSource = `
// In-memory @/db/transactions for the order-idempotency suite (opt-in via
// globalThis.__SMM_TEST_DB__). Mirrors the real module's standalone/dev
// fallback semantics: writes run sequentially with NO session and failures
// do NOT roll back earlier writes — exactly what the route's E11000
// compensation path must handle.
export async function supportsTransactions() {
  return false;
}
export function txOpts(_session) {
  return {};
}
export async function runInTransaction(fn) {
  try {
    const result = await fn(null);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error };
  }
}
`;

const stubDbSchemaSource = `
// In-memory stand-in for the two @/db/mongodb-schema consumers the exercised
// module graph actually touches (opt-in via globalThis.__SMM_TEST_DB__):
// RateLimitBucket (@/lib/rate-limit) and SiteSettings (@/lib/settings).
// The model layer (User/Service/Order/Transaction) lives in the @/db stub;
// re-export it so real modules that import models from @/db/mongodb-schema
// see the exact same in-memory stores. Both stubs activate together.
export { Category, Order, Service, Transaction, User, AdminNotification, AdminAuditLog, NotificationEventType, NotificationSeverity } from "@/db";

export const RateLimitBucket = {
  async findById(id) {
    return globalThis.__SMM_TEST_DB__.buckets?.get(String(id)) ?? null;
  },
  async findByIdAndUpdate(id, update, opts = {}) {
    const buckets = globalThis.__SMM_TEST_DB__.buckets ?? (globalThis.__SMM_TEST_DB__.buckets = new Map());
    const key = String(id);
    let bucket = buckets.get(key);
    if (!bucket || (bucket.resetAt && bucket.resetAt <= new Date())) {
      bucket = {
        _id: key,
        bucketKey: key,
        count: update.count ?? 1,
        resetAt: update.resetAt ?? new Date(Date.now() + 60000),
      };
      buckets.set(key, bucket);
      return bucket;
    }
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) bucket[k] = (bucket[k] ?? 0) + v;
    }
    return bucket;
  },
  // @/lib/seed opportunistically purges expired buckets at startup; model it
  // as a no-op so seeding under the in-memory stub never crashes.
  async deleteMany() {
    return { acknowledged: true, deletedCount: 0 };
  },
};

// SiteSettings singleton: @/lib/settings reads it on nearly every request
// (maintenance flag, default markup) and creates the row lazily when missing.
function cfgSettings() {
  const c = globalThis.__SMM_TEST_DB__;
  if (c.settings === undefined) c.settings = null;
  return c;
}
function mutable(row) {
  const doc = { ...row };
  doc.save = async () => {
    cfgSettings().settings = { ...doc, save: undefined };
    return doc;
  };
  return doc;
}
export const SiteSettings = {
  findOne() {
    const read = () => {
      const row = cfgSettings().settings;
      return row ? mutable(row) : null;
    };
    return {
      // Thenable query: both "await SiteSettings.findOne()" and
      // "await SiteSettings.findOne().select({ maintenanceMode: 1 })" work.
      select(projection = {}) {
        const doc = read();
        if (!doc) return null;
        const picked = {};
        for (const key of Object.keys(projection)) {
          if (key in doc) picked[key] = doc[key];
        }
        return picked;
      },
      then(resolve, reject) {
        return Promise.resolve(read()).then(resolve, reject);
      },
    };
  },
  async create(obj) {
    cfgSettings().settings = { _id: "site-settings-0001", ...obj, save: undefined };
    return mutable(cfgSettings().settings);
  },
};

export const OrderStatus = {
  PENDING: "pending",
  PROCESSING: "processing",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  PARTIAL: "partial",
  CANCELLED: "cancelled",
  FAILED: "failed",
};
`;

let stubDbSource = `
// In-memory replacement for @/db (opt-in: globalThis.__SMM_TEST_DB__ set at
// resolve time — see resolve()). Implements exactly the model surface used by
// the order route and the order worker, including the per-user partial-unique
// clientRequestId index with real E11000 duplicate-key semantics and the
// write-ordering of the standalone dev fallback (no rollback).
import mongoose from "${MONGOOSE_URL}";

function cfg() {
  const c = globalThis.__SMM_TEST_DB__;
  if (!c.stores) {
    c.stores = {
      users: new Map(),
      services: new Map(),
      categories: new Map(),
      orders: new Map(),
      transactions: new Map(),
      notifications: new Map(),
      auditLogs: new Map(),
    };
  }
  return c;
}
let seq = 0;
function nextId() {
  seq += 1;
  return new mongoose.Types.ObjectId(seq.toString(16).padStart(24, "0"));
}
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function matches(doc, filter) {
  if (!filter || Object.keys(filter).length === 0) return true;
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$and") return cond.every((f) => matches(doc, f));
    if (key === "$or") return cond.some((f) => matches(doc, f));
    const value = doc[key];
    if (cond === null) return value === null || value === undefined;
    if (cond === undefined) return value === undefined;
    if (cond instanceof RegExp) return value !== undefined && cond.test(String(value));
    const isOperatorObj =
      cond !== null && typeof cond === "object" && !Array.isArray(cond) &&
      !(cond instanceof Date) && !(cond instanceof RegExp) && !cond._bsontype;
    if (isOperatorObj) {
      return Object.entries(cond).every(([op, arg]) => {
        switch (op) {
          case "$exists": return arg ? value !== undefined : value === undefined;
          case "$ne": return !(String(value) === String(arg));
          case "$in": return arg.some((a) => String(value) === String(a));
          case "$nin": return !arg.some((a) => String(value) === String(a));
          case "$gt": return value !== undefined && value > arg;
          case "$gte": return value !== undefined && value >= arg;
          case "$lte": return value !== undefined && value <= arg;
          case "$lt": return value !== undefined && value < arg;
          case "$not": return !(value !== undefined && arg.test(String(value)));
          default: throw new Error("stub-db: unsupported operator " + op);
        }
      });
    }
    return String(value) === String(cond);
  });
}

function evalExpr(expr, doc) {
  if (typeof expr !== "object" || expr === null) {
    return typeof expr === "string" && expr.startsWith("$") ? doc[expr.slice(1)] : expr;
  }
  if (expr.$cond) {
    const [c, t, e] = expr.$cond;
    return evalCond(c, doc) ? evalExpr(t, doc) : evalExpr(e, doc);
  }
  if (expr.$round) {
    const [v, p] = expr.$round;
    const n = evalExpr(v, doc);
    const m = 10 ** p;
    return Math.round((n + Number.EPSILON) * m) / m;
  }
  if (expr.$subtract) {
    const [a, b] = expr.$subtract;
    return evalExpr(a, doc) - evalExpr(b, doc);
  }
  if (expr.$gte) {
    const [a, b] = expr.$gte;
    return evalExpr(a, doc) >= evalExpr(b, doc);
  }
  return expr;
}
function evalCond(cond, doc) {
  if (cond.$gte) {
    const [a, b] = cond.$gte;
    return evalExpr(a, doc) >= evalExpr(b, doc);
  }
  return false;
}

function applyUpdate(doc, update) {
  if (Array.isArray(update)) {
    const set = (update.find((p) => p.$set) ?? {}).$set ?? {};
    for (const [k, v] of Object.entries(set)) doc[k] = evalExpr(v, doc);
    return;
  }

  // Plain document update (e.g. { status: "cancelled", startCount: undefined,
  // remains: undefined }): these are the fields a MongoDB update document
  // normally sets directly. Keep the existing $set/$inc/$unset handling for
  // when those operators are present.
  if (update && typeof update === "object") {
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) doc[k] = v;
    }
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) doc[k] = round2((doc[k] ?? 0) + v);
    }
    if (update.$unset) {
      for (const [k] of Object.entries(update.$unset)) delete doc[k];
    }
    if (update.$set === undefined && update.$inc === undefined && update.$unset === undefined) {
      for (const [k, v] of Object.entries(update)) {
        if (k === "$set" || k === "$inc" || k === "$unset") continue;
        doc[k] = v !== undefined ? v : undefined;
      }
    }
  }

  doc.updatedAt = new Date();
}

function wrap(name, doc) {
  const rec = { ...doc };
  if (!rec._id) rec._id = nextId();
  cfg().stores[name].set(String(rec._id), rec);
  return rec;
}

function findChain(name, filter) {
  let sortSpec = null;
  let skipN = 0;
  let limitN = null;
  const docs = () => {
    let all = [...cfg().stores[name].values()].filter((d) => matches(d, filter));
    if (sortSpec) {
      const entries = Object.entries(sortSpec);
      all = [...all].sort((a, b) => {
        for (const [k, dir] of entries) {
          const av = a[k];
          const bv = b[k];
          if (av === bv) continue;
          const cmp = av > bv ? 1 : av < bv ? -1 : 0;
          if (cmp !== 0) return dir === -1 || dir === "desc" ? -cmp : cmp;
        }
        return 0;
      });
    }
    return all;
  };
  const chain = {
    sort(spec) { sortSpec = spec ?? null; return chain; },
    select() { return chain; },
    populate() { return chain; },
    // Mongoose chain method used by transactional workers (txOpts/session).
    session() { return chain; },
    skip(n) { skipN = n ?? 0; return chain; },
    limit(n) { limitN = n ?? null; return chain; },
    async lean() {
      let all = docs();
      if (skipN) all = all.slice(skipN);
      if (limitN !== null) all = all.slice(0, limitN);
      return all.map((d) => ({ ...d }));
    },
  };
  return chain;
}

/**
 * Mongoose-style query result: usable BOTH as a thenable (await findOne(...))
 * and as a chain (findOne(...).lean() / .select(...)), which app code relies on.
 * Non-lean results carry a save() that writes the mutation back to the store.
 */
function findOneQuery(name, filter) {
  const find = () => {
    const c = cfg();
    if (name === "orders" && c.bypassReplayOnce) {
      c.bypassReplayOnce = false;
      return null;
    }
    const all = [...c.stores[name].values()].filter((d) => matches(d, filter));
    return all.length > 0 ? all[0] : null;
  };
  const withSave = (row) => {
    const doc = { ...row };
    doc.save = async () => {
      cfg().stores[name].set(String(doc._id), { ...doc, save: undefined });
      return doc;
    };
    return doc;
  };
  const query = {
    select() { return query; },
    populate() { return query; },
    sort() { return query; },
    limit() { return query; },
    // Mongoose chain method used by transactional workers (txOpts/session).
    session() { return query; },
    async lean() {
      const row = find();
      return row ? { ...row } : null;
    },
    then(resolve, reject) {
      return Promise.resolve()
        .then(() => {
          const row = find();
          return row ? withSave(row) : null;
        })
        .then(resolve, reject);
    },
  };
  return query;
}
`;
stubDbSource += `
function enforceOrderIndexes(doc) {
  const orders = cfg().stores.orders;
  if (typeof doc.clientRequestId === "string" && doc.clientRequestId.length > 0) {
    for (const d of orders.values()) {
      if (d.clientRequestId === doc.clientRequestId && String(d.userId) === String(doc.userId)) {
        const err = new Error('E11000 duplicate key error collection: smm.orders index: userId_1_clientRequestId_1 dup key: { userId: "' + doc.userId + '", clientRequestId: "' + doc.clientRequestId + '" }');
        err.code = 11000;
        err.keyPattern = { userId: 1, clientRequestId: 1 };
        throw err;
      }
    }
  }
  if (typeof doc.smmOrderId === "number") {
    for (const d of orders.values()) {
      if (d.smmOrderId === doc.smmOrderId) {
        const err = new Error("E11000 duplicate key error collection: smm.orders index: smmOrderId_1 dup key: { smmOrderId: " + doc.smmOrderId + " }");
        err.code = 11000;
        throw err;
      }
    }
  }
}

export const Order = {
  find(filter = {}) { return findChain("orders", filter); },
  async countDocuments(filter = {}) {
    return [...cfg().stores.orders.values()].filter((d) => matches(d, filter)).length;
  },
  findOne(filter = {}) { return findOneQuery("orders", filter); },
  async create(docs) {
    const arr = Array.isArray(docs) ? docs : [docs];
    const out = [];
    for (const doc of arr) {
      if (cfg().createDelayMs) await new Promise((r) => setTimeout(r, cfg().createDelayMs));
      enforceOrderIndexes(doc);
      out.push(wrap("orders", { remains: doc.quantity, smmAttempts: 0, ...doc }));
    }
    return Array.isArray(docs) ? out : out[0];
  },
  async updateOne(filter, update) {
    for (const d of cfg().stores.orders.values()) {
      if (matches(d, filter)) {
        applyUpdate(d, update);
        return { acknowledged: true, modifiedCount: 1 };
      }
    }
    return { acknowledged: true, modifiedCount: 0 };
  },
  async findOneAndUpdate(filter, update, opts = {}) {
    for (const d of cfg().stores.orders.values()) {
      if (matches(d, filter)) {
        applyUpdate(d, update);
        // Snapshot (see User.findByIdAndUpdate) — never hand out the live record.
        return { ...d };
      }
    }
    return null;
  },

  findById(id) {
    return cfg().stores.orders.get(String(id)) ?? null;
  },

  findByIdAndUpdate(id, update) {
    const doc = cfg().stores.orders.get(String(id));
    if (!doc) return null;
    applyUpdate(doc, update);
    return { ...doc };
  },
};

export const User = {
  find(filter = {}) { return findChain("users", filter); },
  findOne(filter = {}) { return findOneQuery("users", filter); },
  // Mirrors the unique email index: a duplicate create throws with
  // \`code: 11000\` so callers (e.g. @/lib/seed) can detect and ignore it.
  async create(doc) {
    const email = typeof doc.email === "string" ? doc.email.toLowerCase() : null;
    if (email) {
      for (const d of cfg().stores.users.values()) {
        if (String(d.email ?? "").toLowerCase() === email) {
          const err = new Error('E11000 duplicate key error collection: smm.users index: email_1 dup key: { email: "' + email + '" }');
          err.code = 11000;
          throw err;
        }
      }
    }
    return wrap("users", doc);
  },
  // Thenable count with .session() so transactional readers (admin routes)
  // can await it exactly the way they await the Mongoose query.
  countDocuments(filter = {}) {
    const compute = () => [...cfg().stores.users.values()].filter((d) => matches(d, filter)).length;
    const chain = {
      session() { return chain; },
      select() { return chain; },
      then(resolve, reject) { return Promise.resolve().then(compute).then(resolve, reject); },
    };
    return chain;
  },
  async findByIdAndDelete(id) {
    const key = String(id);
    const doc = cfg().stores.users.get(key);
    if (!doc) return null;
    cfg().stores.users.delete(key);
    return { ...doc };
  },
  async findByIdAndUpdate(id, update) {
    const user = cfg().stores.users.get(String(id));
    if (!user) return null;
    applyUpdate(user, update);
    // Snapshot, not the live store object: a concurrent request must never see
    // its continuation resolved against a later write (real MongoDB returns the
    // document as of that statement).
    return { ...user };
  },

  // Required by the production admin-balance route: find one and apply the
  // conditional ($gte) debit guard inside the same transactional callback.
  findById(id) {
    const doc = cfg().stores.users.get(String(id));
    if (!doc) return null;
    // The real Mongoose document exposes .session() for transactional
    // callers; the in-memory stand-in mirrors that surface.
    const sessionable = { ...doc, session: () => sessionable };
    return sessionable;
  },

  findOneAndUpdate(filter, update, opts = {}) {
    for (const d of cfg().stores.users.values()) {
      if (matches(d, filter)) {
        applyUpdate(d, update);
        // Snapshot, not the live store object: a concurrent request must never
        // see its continuation resolved against a later write.
        return { ...d };
      }
    }
    return null;
  },
};

export const Service = {
  // Used by @/lib/seed (catalogue bootstrap).
  async insertMany(docs) {
    return docs.map((doc) => wrap("services", doc));
  },
  findById(id) {
    return {
      populate() { return this; },
      async lean() {
        const d = cfg().stores.services.get(String(id));
        return d ? { ...d } : null;
      },
    };
  },
};

// Category: statically imported by @/lib/seed (catalogue bootstrap) and the
// legacy POST/GET /api/orders route — without this export those modules fail
// to link against the in-memory @/db stub.
export const Category = {
  find(filter = {}) { return findChain("categories", filter); },
  findOne(filter = {}) { return findOneQuery("categories", filter); },
  async insertMany(docs) {
    return docs.map((doc) => wrap("categories", doc));
  },
};

// Privacy-cascade deleteMany targets used by the admin user-delete route.
export const AnalyticsSnapshot = { async deleteMany() { return { acknowledged: true, deletedCount: 0 }; } };
export const ScheduledPost = { async deleteMany() { return { acknowledged: true, deletedCount: 0 }; } };
export const SocialAccount = { async deleteMany() { return { acknowledged: true, deletedCount: 0 }; } };
export const SupportTicket = { async deleteMany() { return { acknowledged: true, deletedCount: 0 }; } };

export const Transaction = {
  async create(docs) {
    const arr = Array.isArray(docs) ? docs : [docs];
    const out = arr.map((doc) => wrap("transactions", doc));
    return Array.isArray(docs) ? out : out[0];
  },
  find(filter = {}) { return findChain("transactions", filter); },
  findOne(filter = {}) { return findOneQuery("transactions", filter); },
  async deleteOne(filter) {
    for (const [key, d] of cfg().stores.transactions) {
      if (matches(d, filter)) {
        cfg().stores.transactions.delete(key);
        return { acknowledged: true, deletedCount: 1 };
      }
    }
    return { acknowledged: true, deletedCount: 0 };
  },
};
export function __resetDb(seed = {}) {
  const c = cfg();
  c.stores = {
    users: new Map(),
    services: new Map(),
    categories: new Map(),
    orders: new Map(),
    transactions: new Map(),
    notifications: new Map(),
    auditLogs: new Map(),
  };
  c.buckets = new Map();
  c.settings = null; // schema stub's SiteSettings singleton
  for (const [name, docs] of Object.entries(seed)) {
    for (const doc of docs) wrap(name, doc);
  }
  c.createDelayMs = 0;
  c.bypassReplayOnce = false;
  c.failNotifications = false; // Phase 2C-6: force notification writes to throw
}
export function __setCreateDelay(ms) { cfg().createDelayMs = ms; }
export function __bypassReplayOnce() { cfg().bypassReplayOnce = true; }
// Phase 2C-6: force every AdminNotification write to throw so suites can prove
// that notification failures never break order/worker/wallet processing.
export function __setFailNotifications(flag) { cfg().failNotifications = !!flag; }
export function __db() { return cfg().stores; }
`;

stubDbSource += `
// ---------------------------------------------------------------------------
// In-memory AdminNotification store (Phase 2C-6 tests).
// Enforces the GLOBAL eventKey UNIQUE index with real E11000 semantics so the
// idempotency behavior of sendNotification is exercised, not faked.
// cfg().failNotifications = true forces every notification write to throw,
// letting suites prove that notification failures never break the worker.
// ---------------------------------------------------------------------------

function enforceNotificationIndexes(doc) {
  if (typeof doc.eventKey === "string" && doc.eventKey.length > 0) {
    for (const d of cfg().stores.notifications.values()) {
      if (d.eventKey === doc.eventKey) {
        const err = new Error('E11000 duplicate key error collection: smm.adminnotifications index: eventKey_1 dup key: { eventKey: "' + doc.eventKey + '" }');
        err.code = 11000;
        err.keyPattern = { eventKey: 1 };
        throw err;
      }
    }
  }
}

function withTimestamps(doc) {
  const now = new Date();
  const base = {
    read: false,
    orderId: null,
    relatedUserId: null,
    transactionId: null,
    metadata: null,
  };
  return { ...base, ...doc, createdAt: doc.createdAt ?? now, updatedAt: now };
}

export const AdminNotification = {
  find(filter = {}) { return findChain("notifications", filter); },
  findOne(filter = {}) { return findOneQuery("notifications", filter); },
  async create(docs) {
    if (cfg().failNotifications) {
      throw new Error("stub-db: notification write forced to fail (failNotifications)");
    }
    const arr = Array.isArray(docs) ? docs : [docs];
    const out = [];
    for (const doc of arr) {
      enforceNotificationIndexes(doc);
      out.push(wrap("notifications", withTimestamps(doc)));
    }
    return Array.isArray(docs) ? out : out[0];
  },
  async updateOne(filter, update) {
    for (const d of cfg().stores.notifications.values()) {
      if (matches(d, filter)) {
        applyUpdate(d, update);
        return { acknowledged: true, modifiedCount: 1, matchedCount: 1 };
      }
    }
    return { acknowledged: true, modifiedCount: 0, matchedCount: 0 };
  },
  async updateMany(filter, update) {
    let modified = 0;
    for (const d of cfg().stores.notifications.values()) {
      if (matches(d, filter)) {
        applyUpdate(d, update);
        modified += 1;
      }
    }
    return { acknowledged: true, modifiedCount: modified };
  },
  async countDocuments(filter = {}) {
    return [...cfg().stores.notifications.values()].filter((d) => matches(d, filter)).length;
  },
};

export const AdminAuditLog = {
  async create(doc) {
    return wrap("auditLogs", { createdAt: new Date(), ...doc });
  },
  find(filter = {}) { return findChain("auditLogs", filter); },
  async countDocuments(filter = {}) {
    return [...cfg().stores.auditLogs.values()].filter((d) => matches(d, filter)).length;
  },
};

// Mirrors src/db/mongodb-schema.ts enum values exactly (stub/real parity).
export const NotificationEventType = {
  OrderPermanentFailure: "order.permanentFailure",
  OrderNeedsReview: "order.needsReview",
  OrderMaxRetries: "order.maxRetries",
  OrderAmbiguousResult: "order.ambiguousResult",
  OrderPollingFailed: "order.pollingFailed",
};
export const NotificationSeverity = {
  Info: "info",
  Warning: "warning",
  Critical: "critical",
};
`;

const stubNextHeadersSource = `
// Test stub for next/headers (route handlers read cookies() in some flows).
export async function cookies() {
  return globalThis.__SMM_TEST_COOKIES__ ?? {
    get: () => undefined,
    set: () => {},
    delete: () => {},
  };
}
export async function headers() {
  return new Headers();
}
`;

function readStub(url) {
  if (url === VIRTUAL_PREFIX + "auth") return { format: "module", source: stubAuthSource, shortCircuit: true };
  if (url === VIRTUAL_PREFIX + "next-headers") return { format: "module", source: stubNextHeadersSource, shortCircuit: true };
  if (url === VIRTUAL_PREFIX + "db") return { format: "module", source: stubDbSource, shortCircuit: true };
  if (url === VIRTUAL_PREFIX + "db-transactions") return { format: "module", source: stubDbTransactionsSource, shortCircuit: true };
  if (url === VIRTUAL_PREFIX + "db-schema") return { format: "module", source: stubDbSchemaSource, shortCircuit: true };
  return null;
}

/**
 * Same-thread hooks (registered through `module.registerHooks` in
 * register-hooks.mjs), so `globalThis` here IS the test process's globalThis —
 * which is what lets a suite opt into the in-memory DB by setting
 * `globalThis.__SMM_TEST_DB__` right before its first dynamic import.
 */
export function resolve(specifier, context, nextResolve) {
  // 1) Test-only stubs. `next/headers` is ALWAYS stubbed (tests never have a
  //    real request context; real auth.ts imports it transitively). The auth
  //    stub itself stays opt-in via SMM_TEST_MOCK_AUTH=1.
  // The auth stub itself stays opt-in via SMM_TEST_MOCK_AUTH=1, and is
  // REFUSED under production NODE_ENV: even if the flag leaked into a
  // production process, authentication must never be replaced by the stub.
  if (specifier === "next/headers") {
    return { url: VIRTUAL_PREFIX + "next-headers", shortCircuit: true };
  }
  if (process.env.SMM_TEST_MOCK_AUTH === "1" && process.env.NODE_ENV !== "production") {
    if (specifier === "@/lib/auth") {
      return { url: VIRTUAL_PREFIX + "auth", shortCircuit: true };
    }
  }

  // 1b) In-memory DB stubs for the order-idempotency suite. Opt-in PER TEST
  // FILE: the test sets globalThis.__SMM_TEST_DB__ before its first dynamic
  // import (SMM_TEST_MOCK_DB=1 also works for odd invocation paths), so suites
  // that never opt in keep loading the real models.
  if (dbStubEnabled()) {
    if (specifier === "@/db") return { url: VIRTUAL_PREFIX + "db", shortCircuit: true };
    if (specifier === "@/db/transactions") return { url: VIRTUAL_PREFIX + "db-transactions", shortCircuit: true };
    if (specifier === "@/db/mongodb-schema") return { url: VIRTUAL_PREFIX + "db-schema", shortCircuit: true };
  }

  // 2) tsconfig path alias: "@/x" -> "<project>/src/x(.ts|/index.ts)".
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    const base = new URL(`../src/${rel}`, import.meta.url);
    const candidates = [base, new URL(`${base.href}.ts`), new URL(`${base.href}/index.ts`)];
    for (const candidate of candidates) {
      if (isFile(candidate)) {
        return { url: candidate.href, shortCircuit: true };
      }
    }
    return { url: base.href, shortCircuit: true };
  }

  // 3) Extensionless relative imports (Node strip-types requires exact
  //    extensions; the app relies on TS-style extensionless imports).
  //    Exact-existing specifiers fall through to nextResolve untouched.
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
    const probed = probeWithExtensions(specifier, context.parentURL);
    if (probed) return { url: probed, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}

/** Try specifier, specifier+.ts, specifier+/index.ts against the filesystem. */
function probeWithExtensions(specifier, parentURL) {
  const base = new URL(specifier, parentURL);
  const candidates = [base, new URL(`${base.href}.ts`), new URL(`${base.href}/index.ts`)];
  for (const candidate of candidates) {
    if (isFile(candidate)) return candidate.href;
  }
  return null;
}

export function load(url, context, nextLoad) {
  if (url.startsWith(VIRTUAL_PREFIX)) {
    const stub = readStub(url);
    if (stub) return stub;
  }
  return nextLoad(url, context);
}

/** Suites opt in via globalThis (same thread) or SMM_TEST_MOCK_DB=1 (spawn env). */
function dbStubEnabled() {
  return Boolean(globalThis.__SMM_TEST_DB__) || process.env.SMM_TEST_MOCK_DB === "1";
}

import { existsSync, statSync } from "node:fs";

/** existsSync also matches directories; module loading needs real files only. */
function isFile(url) {
  try {
    return statSync(url).isFile();
  } catch {
    return false;
  }
}
