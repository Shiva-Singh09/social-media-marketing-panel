import { AdminNotification, Order, Service, SupportTicket, Transaction, User } from "@/db";
import { handle, num, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const adminUser = await requireAdmin(req);

    const [
      userCount,
      blockedCount,
      newToday,
      totalBalance,
      totalOrders,
      pendingOrders,
      completedOrders,
      revenue,
      deposits,
      failedTxns,
      openTickets,
      ticketCount,
      unreadNotifications,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ status: "blocked" }),
      User.countDocuments({ createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
      User.aggregate([{ $group: { _id: null, total: { $sum: "$creditBalance" } } }]),
      Order.countDocuments(),
      Order.countDocuments({ status: "pending" }),
      Order.countDocuments({ status: "completed" }),
      Order.aggregate([{ $group: { _id: null, total: { $sum: "$totalCost" } } }]),
      Transaction.aggregate([
        { $match: { type: "credit", paymentStatus: "success" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Transaction.countDocuments({ paymentStatus: "failed" }),
      SupportTicket.countDocuments({ status: { $ne: "closed" } }),
      SupportTicket.countDocuments(),
      // Unread actionable operational notifications for the signed-in admin
      // (Phase 2C-6). Real state only — no derived/fabricated metric.
      AdminNotification.countDocuments({ userId: adminUser._id, read: false }),
    ]);

    const recentOrders = await Order.find()
      .populate("serviceId", "name")
      .populate("userId", "name")
      .sort({ createdAt: -1 })
      .limit(6)
      .lean();

    const revenueSeries = await Order.aggregate([
      {
        $match: { createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%d %b", date: "$createdAt" } },
          total: { $sum: "$totalCost" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const topServices = await Order.aggregate([
      {
        $group: { _id: "$serviceId", orderCount: { $sum: 1 }, revenue: { $sum: "$totalCost" } },
      },
      { $sort: { orderCount: -1 } },
      { $limit: 5 },
    ]);
    await Service.populate(topServices as any, { path: "_id", select: "name" });

    const balanceDoc = totalBalance[0] as { total?: number } | undefined;
    const revenueDoc = revenue[0] as { total?: number } | undefined;
    const depositsDoc = deposits[0] as { total?: number } | undefined;

    return ok(
      {
        users: {
          total: userCount,
          blocked: blockedCount,
          newToday,
          totalBalance: num(balanceDoc?.total),
        },
        orders: {
          total: totalOrders,
          pending: pendingOrders,
          completed: completedOrders,
          revenue: num(revenueDoc?.total),
        },
        payments: { deposits: num(depositsDoc?.total), failed: failedTxns },
        tickets: { open: openTickets, total: ticketCount },
        notifications: { unread: unreadNotifications },
        recentOrders: recentOrders.map((o: any) => ({
          id: o._id,
          status: o.status,
          totalCost: num(o.totalCost),
          quantity: o.quantity,
          createdAt: o.createdAt,
          serviceName: o.serviceId?.name,
          userName: o.userId?.name,
        })),
        revenueSeries: (revenueSeries as any[]).map((r: any) => ({
          day: r._id,
          total: num(r.total),
        })),
        topServices: (topServices as any[]).map((s: any) => ({
          name: s._id?.name,
          orderCount: s.orderCount,
          revenue: num(s.revenue),
        })),
      },
      "Admin dashboard loaded",
    );
  });
}