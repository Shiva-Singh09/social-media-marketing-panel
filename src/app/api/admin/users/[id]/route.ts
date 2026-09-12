import mongoose from "mongoose";
import { Order, Service, Transaction, User } from "@/db";
import { runInTransaction, txOpts } from "@/db/transactions";
import { recordAudit } from "@/lib/audit";
import { fail, handle, num, ok } from "@/lib/api";
import { requireAdmin, toSafeUser } from "@/lib/auth";
import { firstError, updateUserSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

async function getId(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return mongoose.isValidObjectId(id) ? id : null;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin(req);
    const id = await getId(ctx);
    if (!id) return fail("Invalid user id", 400);

    const user = await User.findById(id);
    if (!user) return fail("User not found", 404);

    const userOrders = await Order.find({ userId: id })
      .populate("serviceId", "name")
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const userTransactions = await Transaction.find({ userId: id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const orderCount = await Order.countDocuments({ userId: id });
    const spentDoc = await Order.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: null, total: { $sum: "$totalCost" } } },
    ]);
    const spent = num((spentDoc[0] as { total?: number } | undefined)?.total);

    return ok(
      {
        user: toSafeUser(user),
        orders: userOrders.map((o: any) => ({
          id: o._id,
          status: o.status,
          quantity: o.quantity,
          totalCost: num(o.totalCost),
          createdAt: o.createdAt,
          serviceName: o.serviceId?.name,
        })),
        transactions: userTransactions.map((t: any) => ({
          ...t,
          amount: num(t.amount),
          id: String(t._id),
          userId: String(t.userId),
        })),
        totals: { orders: orderCount, spent },
      },
      "User loaded",
    );
  });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin(req);
    const id = await getId(ctx);
    if (!id) return fail("Invalid user id", 400);

    const parsed = updateUserSchema.safeParse(await req.json());
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    const { name, role, status, balanceAdjustment, adjustmentNote } = parsed.data;

    const target = await User.findById(id);
    if (!target) return fail("User not found", 404);
    if (String(target._id) === String(admin._id) && status === "blocked") {
      return fail("You cannot block your own admin account", 400);
    }

    // Real ACID transaction on replica sets; sequential fallback on
    // standalone MongoDB (see src/db/transactions.ts).
    const holder: { updated: unknown } = { updated: null };
    const { ok: succeeded } = await runInTransaction(async (session) => {
      // Ensure creditBalance never goes negative.
      const updated = await User.findByIdAndUpdate(
        id,
        [
          {
            $set: {
              ...(name && { name }),
              ...(role && { role }),
              ...(status && { status }),
              creditBalance: {
                $cond: [
                  { $gte: [{ $add: ["$creditBalance", balanceAdjustment ?? 0] }, 0] },
                  { $add: ["$creditBalance", balanceAdjustment ?? 0] },
                  0,
                ],
              },
            },
          },
        ],
        { returnDocument: "after", ...txOpts(session) },
      );
      holder.updated = updated;

      if (balanceAdjustment && balanceAdjustment !== 0) {
        await Transaction.create(
          [
            {
              userId: new mongoose.Types.ObjectId(id),
              type: balanceAdjustment > 0 ? "credit" : "debit",
              amount: Math.abs(balanceAdjustment),
              description: adjustmentNote?.trim()
                ? `Admin adjustment — ${adjustmentNote.trim()}`
                : `Manual balance adjustment by admin`,
              paymentStatus: "success",
            },
          ],
          txOpts(session),
        );
      }
    });

    const updated = holder.updated as InstanceType<typeof User> | null;
    if (!succeeded || !updated) return fail("User update failed", 500);

    await recordAudit({
      adminId: String(admin._id),
      action: "user.update",
      targetType: "user",
      targetId: String(id),
      details: { name, role, status, balanceAdjustment, adjustmentNote },
    });

    return ok({ user: toSafeUser(updated) }, "User updated");
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin(req);
    const id = await getId(ctx);
    if (!id) return fail("Invalid user id", 400);
    if (String(id) === String(admin._id)) return fail("You cannot delete your own account", 400);

    const deleted = await User.findByIdAndDelete(id);
    if (!deleted) return fail("User not found", 404);

    await recordAudit({
      adminId: String(admin._id),
      action: "user.delete",
      targetType: "user",
      targetId: String(id),
    });

    return ok({ id }, "User deleted");
  });
}