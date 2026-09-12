import mongoose from "mongoose";
import { Order, Transaction, User } from "@/db";
import { runInTransaction, txOpts } from "@/db/transactions";
import { recordAudit } from "@/lib/audit";
import { fail, handle, num, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { firstError, updateOrderSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

const REFUND_STATUSES = new Set(["cancelled", "failed"]);

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

    // Real ACID transaction on replica sets; sequential fallback on
    // standalone MongoDB (see src/db/transactions.ts).
    const holder: { updated: unknown } = { updated: null };
    const { ok: succeeded } = await runInTransaction(async (session) => {
      const updated = await Order.findByIdAndUpdate(
        rawId,
        {
          status: parsed.data.status,
          startCount: parsed.data.startCount ?? order.startCount,
          remains: parsed.data.remains ?? order.remains,
          adminNote: parsed.data.adminNote ?? order.adminNote,
        },
        { returnDocument: "after", ...txOpts(session) },
      );
      holder.updated = updated;

      if (shouldRefund) {
        const existingRefund = await Transaction.findOne({
          userId: order.userId,
          description: `Refund for Order #${order._id}`,
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
                paymentStatus: "success",
              },
            ],
            txOpts(session),
          );
        }
      }
    });

    const updated = holder.updated as InstanceType<typeof Order> | null;
    if (!succeeded || !updated) return fail("Order update failed", 500);

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