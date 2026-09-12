import mongoose from "mongoose";
import { Order, Transaction, User } from "@/db";
import { OrderStatus } from "@/db/mongodb-schema";
import { runInTransaction, txOpts } from "@/db/transactions";
import { recordAudit } from "@/lib/audit";
import { fail, handle, num, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { firstError, updateOrderSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

const REFUND_STATUSES = new Set<OrderStatus>([OrderStatus.CANCELLED, OrderStatus.FAILED]);

/** Thrown when another writer already claimed the refund status transition. */
class RefundConflictError extends Error {
  constructor() {
    super("refund transition already claimed by another update");
    this.name = "RefundConflictError";
  }
}

/** Matches MongoDB duplicate-key errors (E11000), including wrapped ones. */
function isDuplicateKeyError(error: unknown): boolean {
  const err = error as
    | { code?: number; writeErrors?: { code?: number }[]; message?: string }
    | undefined;
  return (
    err?.code === 11000 ||
    (Array.isArray(err?.writeErrors) && err.writeErrors.some((w) => w.code === 11000)) ||
    (typeof err?.message === "string" && err.message.includes("E11000"))
  );
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin(req);
    const rawId = (await ctx.params).id;
    if (!mongoose.isValidObjectId(rawId)) return fail("Invalid order id", 400);

    const parsed = updateOrderSchema.safeParse(await req.json());
    if (!parsed.success) return fail(firstError(parsed.error), 422);

    const order = await Order.findById(rawId);
    if (!order) return fail("Order not found", 404);

    const shouldRefund = REFUND_STATUSES.has(parsed.data.status) && !REFUND_STATUSES.has(order.status);

    // Real ACID transaction on replica sets. On standalone MongoDB this runs
    // sequentially in development and FAILS CLOSED in production (see
    // src/db/transactions.ts) instead of silently writing non-atomically.
    const orderUpdate = {
      status: parsed.data.status,
      startCount: parsed.data.startCount ?? order.startCount,
      remains: parsed.data.remains ?? order.remains,
      adminNote: parsed.data.adminNote ?? order.adminNote,
    };
    const holder: { updated: unknown } = { updated: null };
    const { ok: succeeded, error: txError } = await runInTransaction(async (session) => {
      // Refund idempotency latch (P2): when the transition enters a refund
      // state, claim it with a conditional update. The status filter is
      // evaluated server-side per document, so only the FIRST writer wins —
      // in both transactional and sequential-fallback modes. A concurrent
      // duplicate gets null and aborts before any credit is moved.
      const updated = shouldRefund
        ? await Order.findOneAndUpdate(
            { _id: order._id, status: { $nin: [...REFUND_STATUSES] } },
            orderUpdate,
            { returnDocument: "after", ...txOpts(session) },
          )
        : await Order.findByIdAndUpdate(rawId, orderUpdate, {
            returnDocument: "after",
            ...txOpts(session),
          });
      if (shouldRefund && !updated) throw new RefundConflictError();
      holder.updated = updated;

      if (shouldRefund) {
        // Dedup keys on the dedicated refundForOrderId reference (enforced by
        // a sparse-unique index) — never on the mutable description string.
        const existingRefund = await Transaction.findOne({
          refundForOrderId: order._id,
        }).session(session ?? null);

        if (!existingRefund) {
          const refund = num(order.totalCost);
          await User.findByIdAndUpdate(
            order.userId,
            { $inc: { creditBalance: refund } },
            txOpts(session),
          );
          await Transaction.create(
            [
              {
                userId: order.userId,
                type: "credit",
                amount: refund,
                description: `Refund for Order #${order._id}`,
                refundForOrderId: order._id,
                paymentStatus: "success",
              },
            ],
            txOpts(session),
          );
        }
      }
    });

    const updated = holder.updated as InstanceType<typeof Order> | null;
    if (!succeeded || !updated) {
      // A concurrent duplicate refund was claimed first (or, as a last
      // resort, the unique refundForOrderId index rejected a second refund
      // transaction). Report the conflict instead of double-crediting.
      if (txError instanceof RefundConflictError) {
        return fail("Order was already refunded by another update", 409);
      }
      if (isDuplicateKeyError(txError)) {
        return fail("Refund already processed for this order", 409);
      }
      return fail("Order update failed", 500);
    }

    await recordAudit({
      adminId: String(admin._id),
      action: "order.update_status",
      targetType: "order",
      targetId: String(order._id),
      details: { from: order.status, to: parsed.data.status, refunded: shouldRefund },
    });

    return ok(
      { order: updated, refunded: shouldRefund },
      shouldRefund ? "Order updated and customer refunded" : "Order updated",
    );
  });
}