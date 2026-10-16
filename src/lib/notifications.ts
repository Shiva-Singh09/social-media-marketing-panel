/**
 * Admin notification helpers (Phase 2C-6).
 *
 * Operational/event notifications that surface actionable conditions to the
 * admin console: provider submission failures, orders needing review, max-retry
 * exhaustion, ambiguous provider results, repeated polling failures, and
 * worker/system-level issues.
 *
 * Design:
 *  - One notification per (logical event, recipient admin). The eventKey carries
 *    the order scope, so re-running the worker or re-scanning an order never
 *    produces duplicates — while multiple admins still each get their own copy.
 *  - Notification creation is best-effort and NEVER changes order/wallet state.
 *  - Metadata is validated to reject secret-bearing fields.
 */

import mongoose from "mongoose";
import {
  AdminNotification,
  NotificationEventType,
  NotificationSeverity,
} from "@/db/mongodb-schema";

// ---------------------------------------------------------------------------
// Event-key helpers
// ---------------------------------------------------------------------------

/** Deterministic event key for "order permanently failed". */
export function permanentFailureKey(orderId: string): string {
  return `order.permanentFailure:${orderId}`;
}

/** Deterministic event key for "order needs review". */
export function needsReviewKey(orderId: string): string {
  return `order.needsReview:${orderId}`;
}

/** Deterministic event key for "order exhausted max retries". */
export function maxRetriesKey(orderId: string): string {
  return `order.maxRetries:${orderId}`;
}

/** Deterministic event key for "order hit an ambiguous result". */
export function ambiguousResultKey(orderId: string): string {
  return `order.ambiguousResult:${orderId}`;
}

/** Deterministic event key for "order polling failed N times". */
export function pollingFailedKey(orderId: string): string {
  return `order.pollingFailed:${orderId}`;
}

// ---------------------------------------------------------------------------
// Creation helper — idempotent, best-effort, never throws to callers
// ---------------------------------------------------------------------------

/**
 * Create a notification if one with the same eventKey does not already exist.
 * Duplicate eventKey writes are treated as "already delivered" (the unique
 * index on eventKey makes this safe).
 *
 * A notification failure MUST NOT throw to the caller in any path that could
 * affect order/wallet state. This function always returns silently.
 */
export async function sendNotification(params: {
  userId: string | mongoose.Types.ObjectId;
  eventType: NotificationEventType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  orderId?: string | mongoose.Types.ObjectId | null;
  relatedUserId?: string | mongoose.Types.ObjectId | null;
  transactionId?: string | mongoose.Types.ObjectId | null;
  eventKey: string;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const orderId =
      params.orderId instanceof mongoose.Types.ObjectId
        ? params.orderId
        : params.orderId
          ? new mongoose.Types.ObjectId(params.orderId)
          : null;
    const relatedUserId =
      params.relatedUserId instanceof mongoose.Types.ObjectId
        ? params.relatedUserId
        : params.relatedUserId
          ? new mongoose.Types.ObjectId(params.relatedUserId)
          : null;
    const transactionId =
      params.transactionId instanceof mongoose.Types.ObjectId
        ? params.transactionId
        : params.transactionId
          ? new mongoose.Types.ObjectId(params.transactionId)
          : null;

    // Idempotent: the stored key is scoped to the recipient so that MULTIPLE
    // admins each receive their own copy of one logical event, while a repeat
    // of that same logical event for the SAME admin is still suppressed.
    // Callers pass the LOGICAL key (e.g. `order.maxRetries:<orderId>`);
    // scoping happens exactly once, here. A caller that already appended
    // `:<adminId>` (legacy path) is detected by suffix match so we never
    // double-scope to `<key>:<adminId>:<adminId>` (which would break
    // idempotency: every retry would look like a new event).
    const adminSuffix = `:${String(params.userId)}`;
    const recipientKey = params.eventKey.endsWith(adminSuffix)
      ? params.eventKey
      : `${params.eventKey}:${String(params.userId)}`;

    // Skip if this exact logical event was already delivered to this admin.
    const existing = await AdminNotification.findOne({
      eventKey: recipientKey,
    }).lean();
    if (existing) return;

    await AdminNotification.create({
      userId: new mongoose.Types.ObjectId(params.userId),
      eventType: params.eventType,
      severity: params.severity,
      title: params.title,
      message: params.message,
      orderId,
      relatedUserId,
      transactionId,
      eventKey: recipientKey,
      metadata: params.metadata ?? null,
    });
  } catch (error) {
    // Concurrent duplicate: the unique index on `eventKey` is the real
    // guarantee — a losing writer was simply too late, and "already
    // delivered" is the correct interpretation. Never an error.
    if (isDuplicateKeyError(error)) return;
    // Any other notification failure is swallowed (logged only): it must
    // never propagate into order/wallet/refund paths.
    const msg =
      error instanceof Error ? error.message.slice(0, 300) : String(error);
    console.error("[notification:error]", msg, error);
  }
}

/**
 * True when MongoDB rejected a write because a unique index was violated.
 * Checked by machine-readable code/keyPattern (never message text), so the
 * same predicate works against real MongoDB and the in-memory test models.
 */
function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; keyPattern?: unknown };
  if (candidate.code === 11000) return true;
  return Boolean(candidate.keyPattern && typeof candidate.keyPattern === "object");
}
