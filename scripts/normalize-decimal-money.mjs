/**
 * One-time data normalization: convert legacy Decimal128 monetary values to
 * plain doubles so they match the Mongoose schema (`type: Number`).
 *
 * WHY THIS EXISTS
 * The Postgres→MongoDB migration stored money as BSON Decimal128. The current
 * schema declares these fields as plain Numbers, and every `.lean()` read
 * returns the raw BSON value — which JSON-serializes as {"$numberDecimal":"20.00"}.
 * Client code doing Number(service.pricePer1000) got NaN, rendered ₹0.00,
 * passed its own "insufficient balance" check, and then the server correctly
 * charged the real price — producing the misleading 402 "Insufficient balance"
 * popup for users who clearly had enough credits.
 *
 * This script is idempotent: it only touches documents where the field is
 * still a decimal ($type: "decimal"), converting via $toDouble.
 *
 * Usage:
 *   node scripts/normalize-decimal-money.mjs
 * (reads MONGODB_URI from .env; defaults to mongodb://127.0.0.1:27017/smm-panel)
 */

import mongoose from "mongoose";
import { config } from "dotenv";

config();

const uri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/smm-panel";

const TARGETS = [
  { collection: "users", field: "creditBalance" },
  { collection: "services", field: "pricePer1000" },
  { collection: "services", field: "providerCostPer1000" },
  { collection: "orders", field: "totalCost" },
  { collection: "transactions", field: "amount" },
  { collection: "siteSettings", field: "minCreditAmount" },
];

async function main() {
  await mongoose.connect(uri);
  console.log(`[normalize] connected to ${uri}`);

  let converted = 0;
  for (const { collection, field } of TARGETS) {
    const coll = mongoose.connection.collection(collection);
    const filter = { [field]: { $type: "decimal" } };
    const count = await coll.countDocuments(filter).catch(() => -1);
    if (count === -1) {
      console.log(`[normalize] skip ${collection}.${field} (collection missing)`);
      continue;
    }
    if (count === 0) {
      console.log(`[normalize] ok   ${collection}.${field} (no decimal values left)`);
      continue;
    }
    const result = await coll.updateMany(filter, [
      { $set: { [field]: { $toDouble: `$${field}` } } },
    ]);
    converted += result.modifiedCount ?? 0;
    console.log(
      `[normalize] fix  ${collection}.${field}: converted ${result.modifiedCount}/${count} document(s)`,
    );
  }

  // Final sanity sweep — nothing anywhere should still hold decimals.
  const existing = new Set(
    (await mongoose.connection.db.listCollections().toArray()).map((c) => c.name),
  );
  for (const name of ["users", "services", "orders", "transactions", "siteSettings"]) {
    if (!existing.has(name)) continue;
    for (const field of ["creditBalance", "pricePer1000", "providerCostPer1000", "totalCost", "amount", "minCreditAmount"]) {
      const left = await mongoose.connection.collection(name).countDocuments({ [field]: { $type: "decimal" } });
      if (left > 0) console.warn(`[normalize] WARN ${name}.${field}: ${left} decimal value(s) remain`);
    }
  }

  console.log(`[normalize] done — ${converted} field(s) converted.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("[normalize] FAILED:", error?.message ?? error);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => undefined);
});
