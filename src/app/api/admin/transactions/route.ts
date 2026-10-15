import { Transaction, User } from "@/db";
import { handle, literalSearchTerm, num, ok, parsePagination } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin(req);
    const url = new URL(req.url);
    const { page, limit, offset } = parsePagination(url, 12);
    const type = url.searchParams.get("type");
    // Literal, length-bounded search — user input can never act as a regex.
    const search = literalSearchTerm(url.searchParams.get("search"));

    const filter: Record<string, unknown> = {};
    if (type === "credit" || type === "debit") filter.type = type;
    if (search) {
      filter.$or = [
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const rows = await Transaction.find(filter)
      .populate("userId", "name email")
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();

    const [total, credited, debited] = await Promise.all([
      Transaction.countDocuments(filter),
      Transaction.aggregate([
        { $match: { type: "credit", paymentStatus: "success" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Transaction.aggregate([
        { $match: { type: "debit" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

    return ok(
      {
        transactions: rows.map((t: any) => ({
          id: t._id,
          type: t.type,
          amount: num(t.amount),
          description: t.description,
          paymentStatus: t.paymentStatus,
          razorpayOrderId: t.razorpayOrderId,
          razorpayPaymentId: t.razorpayPaymentId,
          createdAt: t.createdAt,
          userName: t.userId?.name,
          userEmail: t.userId?.email,
        })),
        totals: {
          credited: num((credited[0] as { total?: number } | undefined)?.total),
          debited: num((debited[0] as { total?: number } | undefined)?.total),
        },
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      },
      "Transactions loaded",
    );
  });
}