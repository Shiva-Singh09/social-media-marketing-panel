import { Order } from "@/db";
import { handle, num, ok, parsePagination } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { asEnumValue, ORDER_STATUSES } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin(req);
    const url = new URL(req.url);
    const { page, limit, offset } = parsePagination(url, 12);
    const status = asEnumValue(url.searchParams.get("status"), ORDER_STATUSES);
    const search = url.searchParams.get("search")?.trim();

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { link: { $regex: search, $options: "i" } },
      ];
    }

    const rows = await Order.find(filter)
      .populate("serviceId", "name")
      .populate({ path: "serviceId", populate: { path: "categoryId", select: "name" } })
      .populate("userId", "name email")
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();

    const total = await Order.countDocuments(filter);

    return ok(
      {
        orders: rows.map((o: any) => {
          const service = o.serviceId as { name?: string; categoryId?: { name?: string } };
          const category = service?.categoryId as { name?: string } | undefined;
          const user = o.userId as { name?: string; email?: string } | undefined;
          return {
            id: o._id,
            link: o.link,
            quantity: o.quantity,
            totalCost: num(o.totalCost),
            status: o.status,
            startCount: o.startCount,
            remains: o.remains,
            adminNote: o.adminNote,
            createdAt: o.createdAt,
            serviceName: service?.name,
            categoryName: category?.name,
            userName: user?.name,
            userEmail: user?.email,
            userId: o.userId?._id ?? o.userId,
          };
        }),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      },
      "Orders loaded",
    );
  });
}