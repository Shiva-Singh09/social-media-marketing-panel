import { Category, Service } from "@/db";
import { handle, num, ok } from "@/lib/api";
import { ensureSeeded } from "@/lib/seed";
import { resolveServicePricing } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    await ensureSeeded();
    const withServices = new URL(req.url).searchParams.get("withServices") === "1";
    const [categories, services] = await Promise.all([
      Category.find({ status: "active" }).sort({ sortOrder: 1, name: 1 }).lean(),
      Service.find({ status: "active" }).sort({ name: 1 }).lean(),
    ]);
    const rows = categories.map((category) => {
      const categoryServices = services.filter((service) => String(service.categoryId) === String(category._id));
      return {
        ...category,
        id: String(category._id),
        serviceCount: categoryServices.length,
        ...(withServices
          ? {
              // Same public projection as GET /api/services/[categoryId]:
              // internal pricing fields are stripped and money is coerced to
              // plain numbers so client math can never hit Decimal128/NaN.
              services: categoryServices.map((service) => {
                const { providerCostPer1000: _c, markupPercent: _m, providerServiceId: _p, ...publicService } =
                  service;
                const { providerCostPer1000, markupPercent } = resolveServicePricing(service);
                return {
                  ...publicService,
                  id: String(service._id),
                  categoryId: String(service.categoryId),
                  pricePer1000: num(service.pricePer1000),
                  userPricePer1000:
                    Math.round(
                      providerCostPer1000 * (1 + markupPercent / 100) * 100 + Number.EPSILON,
                    ) / 100,
                };
              }),
            }
          : {}),
      };
    });
    return ok({ categories: rows }, "Categories loaded");
  });
}
