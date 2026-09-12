/**
 * GET /api/services/detail/[id] — public single-service detail.
 *
 * SECURITY: internal pricing fields (`providerCostPer1000`, `markupPercent`,
 * `providerServiceId`) are STRIPPED — users only receive `userPricePer1000`,
 * the final marked-up price they will be charged.
 */

import mongoose from "mongoose";
import { Category, Service } from "@/db";
import { fail, handle, num, ok } from "@/lib/api";
import { applyMarkup, resolveServicePricing } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!mongoose.isValidObjectId(id)) return fail("Invalid service id", 400);
    const service = await Service.findById(id).lean();
    if (!service) return fail("Service not found", 404);
    const category = await Category.findById(service.categoryId).select({ name: 1 }).lean();

    const { providerCostPer1000, markupPercent } = resolveServicePricing(service);
    const {
      providerCostPer1000: _providerCost,
      markupPercent: _markup,
      providerServiceId: _providerServiceId,
      ...publicService
    } = service;

    return ok(
      {
        ...publicService,
        id: String(service._id),
        categoryId: String(service.categoryId),
        categoryName: category?.name ?? null,
        userPricePer1000: applyMarkup(providerCostPer1000, markupPercent),
      },
      "Service loaded",
    );
  });
}