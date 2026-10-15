import { AdminNotification, Order } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/observability
 *
 * Minimal operational summary built ONLY from real database state:
 * pending / processing / retrying / needsReview / failed order counts,
 * unread admin notifications, the oldest actionable order's age, and recent
 * provider/worker error details (persisted `smmLastError`). No fabricated
 * metrics, no health percentages, no revenue figures.
 */

const RECENT_ERROR_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin(req);
    const now = new Date();
    const manualRe = /^manual-/;

    const [
      pendingAutomated,
      processing,
      retrying,
      needsReview,
      failed,
      unreadNotifications,
      oldestActionable,
      recentErrors,
    ] = await Promise.all([
      // Pending automated orders awaiting first submission (never attempted).
      Order.countDocuments({
        status: "pending",
        smmOrderId: { $exists: false },
        clientRequestId: { $not: manualRe },
        needsReview: { $ne: true },
        submissionInFlight: { $ne: true },
        smmAttempts: 0,
      }),
      // Orders actively being fulfilled by the provider.
      Order.countDocuments({ status: { $in: ["processing", "in_progress"] } }),
      // Orders mid-retry (transient failure, bounded backoff scheduled).
      Order.countDocuments({
        status: "pending",
        smmAttempts: { $gt: 0 },
        needsReview: { $ne: true },
        nextRetryAt: { $exists: true, $ne: null },
      }),
      // Orders parked for manual review.
      Order.countDocuments({ needsReview: true }),
      // Permanently failed orders (definitive provider rejection / failure).
      Order.countDocuments({ status: "failed" }),
      // Unread notifications for THIS admin only.
      AdminNotification.countDocuments({ userId: admin._id, read: false }),
      // Oldest actionable order (needsReview or unsubmitted automated).
      Order.find({
        $or: [
          { needsReview: true },
          {
            status: "pending",
            smmOrderId: { $exists: false },
            clientRequestId: { $not: manualRe },
            needsReview: { $ne: true },
          },
        ],
      })
        .sort({ createdAt: 1 })
        .limit(1)
        .lean(),
      // Recent provider/worker failure details (persisted smmLastError).
      Order.find({
        smmLastError: { $exists: true, $ne: null },
        updatedAt: { $gte: new Date(now.getTime() - RECENT_ERROR_WINDOW_MS) },
      })
        .sort({ updatedAt: -1 })
        .limit(5)
        .lean(),
    ]);

    const oldest = oldestActionable[0] ?? null;
    const oldestCreatedAt = oldest ? new Date(oldest.createdAt).getTime() : NaN;
    const oldestActionableOrder = oldest
      ? {
          orderId: String(oldest._id),
          status: oldest.status ?? null,
          needsReview: Boolean(oldest.needsReview),
          // Finite guard: legacy rows without a usable createdAt report 0 age
          // instead of NaN (which would serialize to null).
          ageMinutes: Number.isFinite(oldestCreatedAt)
            ? Math.max(0, Math.floor((now.getTime() - oldestCreatedAt) / 60_000))
            : 0,
        }
      : null;

    return ok(
      {
        orders: { pendingAutomated, processing, retrying, needsReview, failed },
        unreadNotifications,
        oldestActionableOrder,
        recentErrors: recentErrors.map((o) => ({
          orderId: String(o._id),
          error: String(o.smmLastError ?? "").slice(0, 200),
          updatedAt:
            o.updatedAt instanceof Date ? o.updatedAt.toISOString() : String(o.updatedAt),
        })),
        generatedAt: now.toISOString(),
      },
      "Operational summary loaded",
    );
  });
}

