import mongoose from "mongoose";
import {
  AnalyticsSnapshot,
  Order,
  ScheduledPost,
  Service,
  SocialAccount,
  SupportTicket,
  Transaction,
  User,
} from "@/db";
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

/**
 * Thrown inside the admin-balance transaction when a debit would drive the
 * balance below zero. Caught after the transaction and mapped to a 402
 * response — never a 500 — so callers can distinguish insufficient funds
 * from a genuine system failure.
 */
class InsufficientBalanceError extends Error {
  readonly balance: number;
  readonly required: number;
  constructor(balance: number, required: number) {
    super(
      `Insufficient balance: current ₹${balance.toFixed(2)}, required ₹${required.toFixed(2)}`,
    );
    this.name = "InsufficientBalanceError";
    this.balance = balance;
    this.required = required;
  }
}

class LastAdminError extends Error {
  constructor() {
    super("The last active administrator cannot be removed or disabled");
    this.name = "LastAdminError";
  }
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
    const { ok: succeeded, error } = await runInTransaction(async (session) => {
      // Re-fetch inside the transaction so we see any concurrent debit.
      const current = await User.findById(id).session(session);
      if (!current) return;

      const removesActiveAdmin =
        current.role === "admin" &&
        current.status === "active" &&
        ((role !== undefined && role !== "admin") ||
          (status !== undefined && status !== "active"));
      if (removesActiveAdmin) {
        const activeAdminCount = await User.countDocuments({
          role: "admin",
          status: "active",
        }).session(session ?? null);
        if (activeAdminCount <= 1) throw new LastAdminError();
      }

      // Reject insufficient-balance adjustments inside the transaction,
      // protected against concurrent debits. A clamped debit would record the
      // full amount in the ledger while only partially deducting the wallet —
      // a balance/ledger mismatch.
      if (balanceAdjustment && balanceAdjustment < 0) {
        const currentBalance = num(current.creditBalance);
        if (currentBalance + balanceAdjustment < 0) {
          throw new InsufficientBalanceError(currentBalance, Math.abs(balanceAdjustment));
        }
      }

      const setFields: Record<string, unknown> = {};
      if (name) setFields.name = name;
      if (role) setFields.role = role;
      if (status) setFields.status = status;

      const update: Record<string, unknown> = {};
      if (Object.keys(setFields).length > 0) update.$set = setFields;
      if (balanceAdjustment && balanceAdjustment !== 0) {
        update.$inc = { creditBalance: balanceAdjustment };
      }

      // Conditional atomic debit (P0): the write itself only applies when the
      // balance still covers the debit AT WRITE TIME. A concurrent debit
      // that committed first leaves too little balance, so this update
      // matches 0 documents instead of driving the wallet negative — the
      // server-side guard that serializes debits even under races.
      const updated =
        balanceAdjustment !== undefined && balanceAdjustment < 0
          ? await User.findOneAndUpdate(
              { _id: id, creditBalance: { $gte: Math.abs(balanceAdjustment) } },
              update,
              { returnDocument: "after", ...txOpts(session) },
            )
          : await User.findByIdAndUpdate(id, update, {
              returnDocument: "after",
              ...txOpts(session),
            });
      if (balanceAdjustment !== undefined && balanceAdjustment < 0 && !updated) {
        const fresh = session
          ? await User.findById(id).session(session)
          : await User.findById(id);
        throw new InsufficientBalanceError(
          num(fresh?.creditBalance),
          Math.abs(balanceAdjustment),
        );
      }
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

    if (!succeeded) {
      if (error instanceof InsufficientBalanceError) {
        return fail(
          `Insufficient balance: adjusting by ₹${balanceAdjustment!.toFixed(2)} would drive the balance below zero (current: ₹${error.balance.toFixed(2)}).`,
          402,
          { required: error.required, balance: error.balance },
        );
      }
      if (error instanceof LastAdminError) return fail(error.message, 409);
      return fail("User update failed", 500);
    }

    const updated = holder.updated as InstanceType<typeof User> | null;
    if (!updated) return fail("User update failed", 500);

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

    const target = await User.findById(id);
    if (!target) return fail("User not found", 404);

    // Privacy cascade (production-hardening): a deleted user must not leave
    // behind records holding private or security-sensitive material — most
    // importantly SocialAccount documents with AES-256-GCM encrypted OAuth
    // tokens, plus support conversations, scheduled post content and
    // analytics snapshots. Orders/transactions are deliberately KEPT: they
    // are the financial ledger/audit trail for the deleted userId and must
    // survive account deletion for compliance.
    const { ok: succeeded, error } = await runInTransaction(async (session) => {
      const current = await User.findById(id).session(session);
      if (!current) return;
      if (current.role === "admin" && current.status === "active") {
        const activeAdminCount = await User.countDocuments({
          role: "admin",
          status: "active",
        }).session(session ?? null);
        if (activeAdminCount <= 1) throw new LastAdminError();
      }
      await Promise.all([
        SocialAccount.deleteMany({ userId: id }, txOpts(session)),
        SupportTicket.deleteMany({ userId: id }, txOpts(session)),
        ScheduledPost.deleteMany({ userId: id }, txOpts(session)),
        AnalyticsSnapshot.deleteMany({ userId: id }, txOpts(session)),
      ]);
      await User.findByIdAndDelete(id, txOpts(session));
    });
    if (!succeeded) {
      if (error instanceof LastAdminError) return fail(error.message, 409);
      return fail("User deletion failed", 500);
    }

    await recordAudit({
      adminId: String(admin._id),
      action: "user.delete",
      targetType: "user",
      targetId: String(id),
      details: {
        cascaded: ["socialAccounts", "supportTickets", "scheduledPosts", "analyticsSnapshots"],
        financialRecordsRetained: ["orders", "transactions"],
      },
    });

    return ok({ id }, "User deleted");
  });
}