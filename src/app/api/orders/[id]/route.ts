import mongoose from "mongoose";
import { Order } from "@/db";
import { fail, handle, num, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    if (!mongoose.isValidObjectId(id)) return fail("Invalid order id", 400);

    const query: Record<string, unknown> = { _id: id };
    if (user.role !== "admin") query.userId = user._id;

    const row = await Order.findOne(query)
      .populate("serviceId", "name description pricePer1000")
      .populate({ path: "serviceId", populate: { path: "categoryId", select: "name" } })
      .lean();

    if (!row) return fail("Order not found", 404);

    const service = row.serviceId as unknown as {
      name?: string;
      description?: string | null;
      pricePer1000?: number;
      categoryId?: { name?: string };
    };
    const category = service?.categoryId as { name?: string } | undefined;

    // Money fields must leave the API as plain numbers — legacy Decimal128
    // rows serialize as {"$numberDecimal":...} objects and rendered as ₹0.00.
    const totalCost = num(row.totalCost);
    // Derive the effective rate from what was ACTUALLY charged so the detail
    // page's "Rate / 1000" always multiplies out to the stored totalCost.
    const effectiveRatePer1000 =
      row.quantity > 0 ? Math.round((totalCost / row.quantity) * 1000 * 100 + Number.EPSILON) / 100 : 0;

    return ok(
      {
        _id: row._id,
        link: row.link,
        quantity: row.quantity,
        totalCost,
        status: row.status,
        startCount: row.startCount,
        remains: row.remains,
        adminNote: row.adminNote,
        createdAt: row.createdAt,
        serviceName: service?.name,
        serviceDescription: service?.description,
        pricePer1000: num(service?.pricePer1000),
        effectiveRatePer1000,
        categoryName: category?.name,
      },
      "Order loaded",
    );
  });
}