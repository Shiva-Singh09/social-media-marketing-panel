import { Order, Service, Category, Transaction, User } from "@/db";
import { runInTransaction, txOpts } from "@/db/transactions";
import { fail, handle, num, ok, parsePagination } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { limitOrFail } from "@/lib/rate-limit";
import { resolveServicePricing, userCostForQuantity } from "@/lib/pricing";
import {
  asEnumValue,
  createOrderSchema,
  firstError,
  isAllowedSocialLink,
  ORDER_STATUSES,
} from "@/lib/validators";

export const dynamic = "force-dynamic";

/** GET /api/orders?page=&limit=&status=&search= */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const { page, limit, offset } = parsePagination(url);
    const status = asEnumValue(url.searchParams.get("status"), ORDER_STATUSES);
    const search = url.searchParams.get("search")?.trim();

    const filter: Record<string, unknown> = { userId: user._id };
    if (status) filter.status = status;
    if (search) filter.link = { $regex: search, $options: "i" };

    const rows = await Order.find(filter)
      .populate("serviceId", "name")
      .populate({ path: "serviceId", populate: { path: "categoryId", select: "name" } })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();

    const total = await Order.countDocuments(filter);

    const orders = rows.map((o) => {
      const service = o.serviceId as unknown as {
        name?: string;
        categoryId?: { name?: string };
      };
      const category = service?.categoryId as { name?: string } | undefined;
      return {
        id: o._id,
        link: o.link,
        quantity: o.quantity,
        totalCost: num(o.totalCost),
        status: o.status,
        startCount: o.startCount,
        remains: o.remains,
        createdAt: o.createdAt,
        serviceName: service?.name,
        categoryName: category?.name,
      };
    });

    return ok(
      { orders, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } },
      "Orders loaded",
    );
  });
}

/** POST /api/orders — validates, prices server side and deducts credits atomically. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const limited = await limitOrFail(req, "order", `user-${user._id}`);
    if (limited) return fail(limited, 429);

    const parsed = createOrderSchema.safeParse(await req.json());
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    const { serviceId, link, quantity } = parsed.data;

    const service = await Service.findById(serviceId).populate("categoryId", "platformKey").lean();
    if (!service) return fail("Service not found", 404);
    const category = service.categoryId as unknown as { platformKey?: string } | undefined;
    const platformKey = category?.platformKey ?? undefined;

    if (service.status !== "active") return fail("This service is currently unavailable", 400);
    if (quantity < service.minQuantity || quantity > service.maxQuantity) {
      return fail(
        `Quantity must be between ${service.minQuantity} and ${service.maxQuantity}`,
        422,
      );
    }

    // Confirm the link actually points at the platform the service is for
    // (keyed by the category's immutable platformKey, not its editable
    // display name), and reject private/internal hosts outright.
    const linkCheck = isAllowedSocialLink(link, platformKey);
    if (!linkCheck.ok) return fail(linkCheck.reason ?? "Invalid link", 422);

    // Never trust the client — recompute the price on the server using the
    // SAME resolver as the service listings and /api/services/order, so the
    // displayed `userPricePer1000` and the deducted amount can never diverge
    // (previously this route charged the raw admin price while every listing
    // showed the marked-up price).
    const { providerCostPer1000, markupPercent } = resolveServicePricing(service);
    const totalCost = userCostForQuantity(quantity, providerCostPer1000, markupPercent);
    if (totalCost <= 0) return fail("Calculated order cost is invalid", 400);
    if (num(user.creditBalance) < totalCost) {
      // Same detailed wording as the in-transaction race branch so the user
      // always sees WHY they cannot order (and never just a bare popup).
      return fail(
        `Insufficient balance: this order costs ${totalCost.toFixed(2)} credits but your balance is ${num(
          user.creditBalance,
        ).toFixed(2)}. Please add funds first.`,
        402,
        { required: totalCost, balance: num(user.creditBalance) },
      );
    }

    // Real ACID transaction on replica sets; sequential fallback on
    // standalone MongoDB (see src/db/transactions.ts).
    const holder: { order: unknown; balance: number } = { order: null, balance: 0 };
    const { ok: succeeded, error: txError } = await runInTransaction(async (session) => {
      // Atomically deduct credits if the balance is sufficient.
      // `updatePipeline: true` is REQUIRED in Mongoose 9 when passing an
      // aggregation pipeline array as the update — without it every order
      // with sufficient balance died here as a confusing 500.
      const deducted = await User.findByIdAndUpdate(
        user._id,
        [
          {
            $set: {
              creditBalance: {
                $cond: [
                  { $gte: ["$creditBalance", totalCost] },
                  { $round: [{ $subtract: ["$creditBalance", totalCost] }, 2] },
                  "$creditBalance",
                ],
              },
            },
          },
        ],
        { returnDocument: "after", updatePipeline: true, ...txOpts(session) },
      );
      if (!deducted) throw new Error("User not found");

      // If the balance was insufficient, the $cond keeps it unchanged — detect this below.
      const newBalance = num(deducted.creditBalance);
      const expectedBalance = num(user.creditBalance) - totalCost;
      if (Math.abs(newBalance - expectedBalance) > 0.001) {
        throw new Error("Insufficient balance");
      }

      const [order] = await Order.create(
        [
          {
            userId: user._id,
            serviceId: service._id,
            link,
            quantity,
            totalCost,
            status: "pending",
            remains: quantity,
          },
        ],
        txOpts(session),
      );

      await Transaction.create(
        [
          {
            userId: user._id,
            type: "debit",
            amount: totalCost,
            description: `Order #${order._id} — ${service.name}`,
            paymentStatus: "success",
          },
        ],
        txOpts(session),
      );

      holder.order = order;
      holder.balance = newBalance;
    });

    if (!succeeded) {
      // Distinguish a genuine balance shortfall from unexpected failures —
      // both used to surface as the same misleading 402.
      const reason = txError instanceof Error ? txError.message : "";
      if (reason === "Insufficient balance") {
        return fail(
          `Insufficient balance: this order costs ${totalCost.toFixed(2)} credits but your balance is ${num(
            user.creditBalance,
          ).toFixed(2)}. Please add funds first.`,
          402,
          { required: totalCost, balance: num(user.creditBalance) },
        );
      }
      console.error("[orders] placement failed", { reason: reason.slice(0, 160) });
      return fail("Could not place the order right now. Please try again.", 500);
    }

    return ok(
      {
        order: { id: (holder.order as { _id: unknown })._id },
        balance: holder.balance,
        service: service.name,
      },
      "Order placed successfully",
      201,
    );
  });
}