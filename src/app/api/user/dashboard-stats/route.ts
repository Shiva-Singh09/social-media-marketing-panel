import { Order, Service, SupportTicket, Transaction } from "@/db";
import { handle, num, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const userId = user._id;
    const [allOrders, openTickets, transactions] = await Promise.all([
      Order.find({ userId }).sort({ createdAt: -1 }).lean(),
      SupportTicket.countDocuments({ userId, status: "open" }),
      Transaction.find({ userId }).sort({ createdAt: -1 }).limit(5).lean(),
    ]);
    const serviceIds = allOrders.map((order) => order.serviceId);
    const serviceRows = await Service.find({ _id: { $in: serviceIds } }).select({ name: 1 }).lean();
    const serviceNames = new Map(serviceRows.map((service) => [String(service._id), service.name]));
    const completedOrders = allOrders.filter((order) => order.status === "completed");
    const activeOrders = allOrders.filter((order) => ["pending", "processing", "in_progress"].includes(String(order.status)));
    // num() coerces legacy Decimal128 money values — Number(decimal128Object) is NaN.
    const totalSpent = allOrders.reduce((sum, order) => sum + num(order.totalCost), 0);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const days = new Map<string, number>();
    for (const order of allOrders) {
      if (order.createdAt.getTime() < sevenDaysAgo) continue;
      const day = order.createdAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      days.set(day, (days.get(day) ?? 0) + num(order.totalCost));
    }
    return ok({
      balance: num(user.creditBalance), totalOrders: allOrders.length, completedOrders: completedOrders.length,
      activeOrders: activeOrders.length, totalSpent, openTickets,
      recentOrders: allOrders.slice(0, 5).map((order) => ({ ...order, totalCost: num(order.totalCost), id: String(order._id), serviceId: String(order.serviceId), serviceName: serviceNames.get(String(order.serviceId)) ?? "Unknown service" })),
      recentTransactions: transactions.map((transaction) => ({ ...transaction, amount: num(transaction.amount), id: String(transaction._id), userId: String(transaction.userId) })),
      spendSeries: [...days.entries()].map(([day, total]) => ({ day, total })),
    }, "Dashboard stats loaded");
  });
}
