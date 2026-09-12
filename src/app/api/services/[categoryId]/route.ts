/**
 * GET /api/services/[categoryId] — public listing of active services.
 *
 * SECURITY: internal pricing fields (`providerCostPer1000`, `markupPercent`,
 * `providerServiceId`) are STRIPPED before responding — users must never see
 * what the panel pays its provider. They only receive `userPricePer1000`,
 * the final marked-up price they will be charged (cost × (1 + margin)).
 */

import mongoose from "mongoose";
import { Service } from "@/db";
import { fail, handle, num, ok } from "@/lib/api";
import { applyMarkup, resolveServicePricing } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ categoryId: string }> }) {
  return handle(async () => {
    const { categoryId } = await ctx.params;
    if (!mongoose.isValidObjectId(categoryId)) return fail("Invalid category id", 400);
    const rows = await Service.find({ categoryId, status: "active" }).sort({ name: 1 }).lean();

    const services = rows.map((row) => {
      // Compute the marked-up price server-side from the same source of
      // truth used by /api/services/order so displayed and charged prices
      // can never diverge.
      const { providerCostPer1000, markupPercent } = resolveServicePricing(row);
      const {
        providerCostPer1000: _providerCost,
        markupPercent: _markup,
        providerServiceId: _providerServiceId,
        ...publicRow
      } = row;
      return {
        ...publicRow,
        id: String(row._id),
        categoryId: String(row.categoryId),
        // Legacy migrated rows can still hold Decimal128 — expose plain
        // numbers so client-side `Number(pricePer1000)` can never produce NaN
        // (NaN previews rendered ₹0.00 and hid the real cost from users).
        pricePer1000: num(row.pricePer1000),
        userPricePer1000: applyMarkup(providerCostPer1000, markupPercent),
      };
    });

    return ok({ services }, "Services loaded");
  });
}