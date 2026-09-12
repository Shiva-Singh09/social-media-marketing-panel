/**
 * Transaction compatibility layer for MongoDB deployments WITHOUT multi-
 * document transaction support (e.g. a standalone local `mongod`, some
 * shared hosting plans).
 *
 * Background: `session.withTransaction(...)` throws
 *   "This MongoDB deployment does not support retryable writes…" /
 *   "Transaction numbers are only allowed on a replica set member or mongos"
 * on standalone servers. The correct long-term fix is running a replica set
 * (even a single-node one: `mongod --replSet rs0` + `rs.initiate()`), but the
 * panel must still WORK in development, so every credit-mutating code path
 * goes through {@link runInTransaction}:
 *
 *   - Replica set / Atlas → real ACID multi-document transactions (as before).
 *   - Standalone          → development/test runs sequentially without a
 *     session (single-document writes like the $cond balance deduction and
 *     $inc stay atomic per document; the cross-document steps become
 *     individually atomic instead of jointly atomic). PRODUCTION refuses to
 *     run at all (fail-closed): see runInTransaction below.
 */

import mongoose from "mongoose";

/** Cached capability flag (per process). */
let txSupport: boolean | null = null;

/**
 * True when the connected deployment can run multi-document transactions:
 * a replica-set member (`setName` present) or a mongos router (`isdbgrid`).
 */
export async function supportsTransactions(): Promise<boolean> {
  if (txSupport !== null) return txSupport;
  try {
    const db = mongoose.connection.db;
    // Not connected yet? Return false WITHOUT caching so a later call (after
    // connectDB resolves) can still detect a replica set correctly.
    if (!db) return false;
    const hello = await db.admin().command({ hello: 1 });
    txSupport = Boolean(hello && (hello.setName || hello.msg === "isdbgrid"));
  } catch {
    // If we cannot even probe the server, assume the safe/compatible path.
    txSupport = false;
  }

  if (!txSupport) {
     
    console.warn(
      "[db] MongoDB deployment does NOT support multi-document transactions " +
        "(standalone server?). Credit operations will run without session " +
        "atomicity. For production-grade safety run a single-node replica set:\n" +
        '    mongod --replSet rs0 --dbpath <path>   then   mongosh --eval "rs.initiate()"',
    );
  }
  return txSupport;
}

/** Callback receives a real session when transactions are supported, else null. */
type TxCallback<T> = (session: mongoose.ClientSession | null) => Promise<T>;

/**
 * Builds Mongoose options carrying the transaction session. Returns `{}` on
 * standalone deployments (no session) so call sites can simply spread it:
 *   `Model.findByIdAndUpdate(id, update, { returnDocument: "after", ...txOpts(session) })`
 * Keeps the strict Mongoose typings happy (they reject an explicit `null`
 * session while runtime happily ignores an absent one).
 */
export function txOpts(session: mongoose.ClientSession | null): { session?: mongoose.ClientSession } {
  return session ? { session } : {};
}

/**
 * Runs `fn` inside a multi-document transaction when the deployment supports
 * them; otherwise runs it directly with a null session. Resolves
 * `{ ok: true }` on success and `{ ok: false, error }` when the callback
 * threw (transaction aborted / operation failed).
 *
 * Callers should pass the received session into every write inside the
 * callback as `{ session }` — Mongoose ignores `{ session: null }`.
 */
export async function runInTransaction<T>(
  fn: TxCallback<T>,
): Promise<{ ok: boolean; result?: T; error?: unknown }> {
  if (await supportsTransactions()) {
    const session = await mongoose.startSession();
    try {
      let captured!: T;
      await session.withTransaction(async () => {
        captured = await fn(session);
      });
      return { ok: true, result: captured };
    } catch (error) {
      return { ok: false, error };
    } finally {
      await session.endSession();
    }
  }

  // Production: FAIL CLOSED. A financial operation that cannot run inside a
  // real multi-document transaction must never silently execute as separate
  // non-atomic writes (half-applied credits/refunds are money bugs). No write
  // is performed; callers translate `{ ok: false }` into their normal 5xx
  // error responses, so unrelated non-financial functionality is untouched.
  if (process.env.NODE_ENV === "production") {
    const error = new Error(
      "MongoDB deployment does not support multi-document transactions; " +
        "financial operation refused (fail-closed)",
    );
    console.error(
      "[db] Financial operation BLOCKED: the connected MongoDB deployment " +
        "does not support multi-document transactions (standalone server?). " +
        "Production requires a replica set (a single-node one is enough: " +
        'mongod --replSet rs0, URI "...?replicaSet=rs0") or Atlas. ' +
        "No financial write was performed.",
    );
    return { ok: false, error };
  }

  // Development/test fallback: execute sequentially without a session.
  // Single-document writes ($cond balance deduction, $inc) remain atomic per
  // document; the cross-document steps (Order + Transaction rows) become
  // individually atomic instead of jointly atomic — acceptable outside
  // production, and loudly detected above rather than silently trusted.
  try {
    const result = await fn(null);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error };
  }
}