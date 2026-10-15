/**
 * Phase 2C-5 — controlled application-data reset (demo/seed cleanup follow-up).
 *
 * WHY THIS EXISTS
 * The panel used to be shipped with hardcoded demo credentials (a demo customer
 * plus a legacy `admin@smmpanel.com` login). Those credentials are gone from the
 * source (`src/lib/seed.ts`, `LoginForm.tsx`, landing page), but the documents
 * they created are still in an existing database. This tool removes that
 * application data without touching schema, indexes or bootstrap configuration.
 *
 * SAFETY MODEL
 *   - Dry-run by DEFAULT: running it with no flags is a read-only inspection
 *     (listCollections + countDocuments). Nothing is written.
 *   - Destructive work requires BOTH `--apply` AND a configured admin bootstrap
 *     (`ADMIN_EMAIL` + `ADMIN_PASSWORD`) whose account already exists, so the
 *     reset can never strand the deployment without a usable admin.
 *   - Only `deleteMany()` document removals are used. This file never calls
 *     dropDatabase / dropCollection / drop / dropIndexes, so the database,
 *     its collections and every index definition survive untouched.
 *   - Preserved collections: `categories`, `services`, `siteSettings` (platform
 *     bootstrap that the running application requires) and non-expired
 *     `rateLimitBuckets` (active abuse protection).
 *
 * Usage:
 *   node scripts/reset-app-data.mjs           # read-only inspection (safe)
 *   node scripts/reset-app-data.mjs --apply   # perform the reset
 *
 * (Reads MONGODB_URI / ADMIN_EMAIL from .env, matching the app's own bootstrap.)
 */

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { config } from "dotenv";

config();

const APPLY = process.argv.includes("--apply");

const URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/smm-panel";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

/** Never-printed account markers used only for yes/no presence checks. */
const DEMO_EMAILS = ["demo@smmpanel.com", "admin@smmpanel.com"];

/**
 * Removals in dependency order — children before the parents they reference
 * (see the model definitions in src/db/mongodb-schema.ts):
 *   orders.userId -> users, orders.serviceId -> services, orders.debitTransactionId -> transactions
 *   transactions.userId -> users, transactions.orderId -> orders
 *   supportTickets.userId / socialAccounts.userId / scheduledPosts.userId+accountId
 *   analyticsSnapshots.userId+accountId+postId+orderId / adminAuditLogs.adminId
 *   users (last)
 */
const RESET_STEPS = [
  { collection: "orders", describe: "order documents (all owners)" },
  { collection: "transactions", describe: "wallet/payment transactions (all owners)" },
  { collection: "analyticsSnapshots", describe: "analytics snapshots" },
  { collection: "scheduledPosts", describe: "scheduled posts" },
  { collection: "socialAccounts", describe: "connected social accounts (encrypted tokens)" },
  { collection: "supportTickets", describe: "support tickets and replies" },
];

const PRESERVED_COLLECTIONS = ["categories", "services", "siteSettings"];

/** Host/database identity with any credentials stripped — safe to log. */
function targetLabel() {
  const withoutScheme = URI.replace(/^mongodb(\+srv)?:\/\//i, "");
  const afterAt = withoutScheme.includes("@") ? withoutScheme.split("@").pop() : withoutScheme;
  const [hostPart, ...rest] = afterAt.split("/");
  const dbName = (rest.join("/").split("?")[0] || "").trim() || "(default)";
  return { host: hostPart, dbName };
}

async function count(collection) {
  const names = (await mongoose.connection.db.listCollections().toArray()).map((c) => c.name);
  if (!names.includes(collection)) return null; // collection not created yet
  return mongoose.connection.db.collection(collection).countDocuments();
}

async function inspect() {
  const { host, dbName } = targetLabel();
  console.log(`[reset] mode          : ${APPLY ? "APPLY (writes)" : "DRY-RUN (read-only)"}`);
  console.log(`[reset] target host   : ${host}`);
  console.log(`[reset] target db     : ${dbName}`);
  console.log(`[reset] admin email   : ${ADMIN_EMAIL ? "configured" : "MISSING"} (value never printed)`);
  console.log(`[reset] admin password: ${ADMIN_PASSWORD ? `configured (${ADMIN_PASSWORD.length} chars)` : "MISSING"}`);

  console.log("\n[reset] collection counts");
  const known = [
    ...RESET_STEPS.map((s) => s.collection),
    "adminAuditLogs",
    "users",
    ...PRESERVED_COLLECTIONS,
    "rateLimitBuckets",
  ];
  for (const name of known) {
    const n = await count(name);
    console.log(`  ${name.padEnd(20)} ${n === null ? "(not created)" : n}`);
  }

  const users = mongoose.connection.db.collection("users");
  const admins = await users.countDocuments({ role: "admin" });
  const customers = await users.countDocuments({ role: "user" });
  console.log(`\n[reset] users: ${admins} admin(s), ${customers} customer(s)`);

  const intendedAdmin = ADMIN_EMAIL ? await users.findOne({ email: ADMIN_EMAIL }) : null;
  console.log(`  intended admin account exists : ${intendedAdmin ? "yes" : "no"}`);
  if (intendedAdmin) {
    const hash = typeof intendedAdmin.password === "string" ? intendedAdmin.password : "";
    const matches = hash && ADMIN_PASSWORD ? await bcrypt.compare(ADMIN_PASSWORD, hash) : false;
    console.log(`  intended admin password check : ${hash ? (matches ? "MATCHES ADMIN_PASSWORD" : "does NOT match ADMIN_PASSWORD") : "no password hash stored"}`);
  }
  for (const email of DEMO_EMAILS) {
    const found = await users.countDocuments({ email });
    console.log(`  demo/legacy account present   : ${email === DEMO_EMAILS[0] ? "demo customer" : "legacy admin"} -> ${found ? "yes" : "no"}`);
  }
  if (ADMIN_EMAIL === "admin@yourpanel.com") {
    console.log("  WARNING: ADMIN_EMAIL is still the .env.example placeholder — configure the real admin identity before applying.");
  }

  // Ownership breakdown of order/wallet history: confirms (before anyone runs
  // --apply) that the documents queued for deletion are test/demo data.
  for (const name of ["orders", "transactions"]) {
    const rows = await mongoose.connection.db
      .collection(name)
      .aggregate([{ $group: { _id: "$userId", n: { $sum: 1 } } }])
      .toArray();
    const byRole = {};
    for (const row of rows) {
      const owner = await users.findOne({ _id: row._id }, { projection: { role: 1 } });
      const role = owner?.role ?? "unknown/legacy";
      byRole[role] = (byRole[role] ?? 0) + row.n;
    }
    const text = Object.entries(byRole).map(([role, n]) => `${role}=${n}`).join(", ");
    console.log(`  ${name} by owner role  : ${text || "none"}`);
  }

  const services = mongoose.connection.db.collection("services");
  console.log(`  catalogue: ${await services.countDocuments({ providerServiceId: { $ne: null } })} service(s) mapped to a live provider`);

  const expired = mongoose.connection.db.collection("rateLimitBuckets");
  const expiredCount = await expired.countDocuments({ resetAt: { $lt: new Date() } });
  console.log(`  expired rate-limit buckets    : ${expiredCount} (removeable)`);

  return { intendedAdmin, expiredCount };
}

async function apply(intendedAdmin) {
  const db = mongoose.connection.db;
  const summary = [];

  for (const step of RESET_STEPS) {
    const result = await db.collection(step.collection).deleteMany({});
    summary.push([step.collection, result.deletedCount, step.describe]);
  }

  // Audit trail of deleted accounts would dangle on users that no longer exist;
  // the preserved admin's own audit history is kept.
  const audit = await db.collection("adminAuditLogs").deleteMany({ adminId: { $ne: intendedAdmin._id } });
  summary.push(["adminAuditLogs", audit.deletedCount, "audit entries of removed accounts"]);

  // Last: every account except the bootstrap admin.
  const users = await db.collection("users").deleteMany({ _id: { $ne: intendedAdmin._id } });
  summary.push(["users", users.deletedCount, "accounts other than the bootstrap admin"]);

  // Transient login-throttle state only (self-expiring fields, never credentials).
  await db.collection("users").updateOne(
    { _id: intendedAdmin._id },
    { $set: { failedLoginAttempts: 0, loginLockUntil: null } },
  );

  const buckets = await db
    .collection("rateLimitBuckets")
    .deleteMany({ resetAt: { $lt: new Date() } });
  summary.push(["rateLimitBuckets", buckets.deletedCount, "expired buckets only (active limits kept)"]);

  return summary;
}

async function main() {
  await mongoose.connect(URI);
  try {
    const state = await inspect();

    if (!APPLY) {
      console.log("\n[reset] dry-run complete — no documents were modified.");
      if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        console.log("[reset] NOTE: ADMIN_EMAIL/ADMIN_PASSWORD are not both configured — --apply would refuse to run.");
      } else if (!state.intendedAdmin) {
        console.log("[reset] NOTE: the ADMIN_EMAIL account does not exist yet — --apply would refuse to run.");
      }
      return;
    }

    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      throw new Error(
        "refusing to apply: ADMIN_EMAIL and ADMIN_PASSWORD must both be configured so the bootstrap admin survives the reset.",
      );
    }
    if (!state.intendedAdmin) {
      throw new Error(
        "refusing to apply: the ADMIN_EMAIL account does not exist yet. Start the app once so src/lib/seed.ts bootstraps it from the configured ADMIN_EMAIL/ADMIN_PASSWORD, then re-run this script.",
      );
    }
    if (state.intendedAdmin.role !== "admin") {
      throw new Error("refusing to apply: the ADMIN_EMAIL account is not an admin. Fix the bootstrap configuration first.");
    }

    console.log("\n[reset] applying — document deletes only (no dropDatabase/dropCollection/dropIndexes)");
    const summary = await apply(state.intendedAdmin);
    for (const [collection, deleted, describe] of summary) {
      console.log(`  ${collection.padEnd(20)} deleted ${String(deleted).padStart(5)}  (${describe})`);
    }

    const remaining = await mongoose.connection.db.collection("users").countDocuments();
    const survivors = await mongoose.connection.db
      .collection("users")
      .findOne({ email: ADMIN_EMAIL });
    const authenticated =
      survivors && typeof survivors.password === "string"
        ? await bcrypt.compare(ADMIN_PASSWORD, survivors.password)
        : false;

    console.log("\n[reset] verification");
    console.log(`  users remaining          : ${remaining}`);
    console.log(`  bootstrap admin survives: ${survivors ? "yes" : "no"}`);
    console.log(`  admin authentication     : ${authenticated ? "PASS" : "FAIL"}`);
    for (const name of PRESERVED_COLLECTIONS) {
      console.log(`  preserved ${name.padEnd(14)}: ${await count(name)} document(s)`);
    }
    if (!authenticated) {
      console.log("  WARNING: the admin hash did not verify against ADMIN_PASSWORD — check the configured value.");
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(`[reset] ABORTED: ${error.message}`);
  process.exitCode = 1;
});


