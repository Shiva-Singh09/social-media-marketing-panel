import mongoose from "mongoose";
import { Category, Service } from "@/db";
import { recordAudit } from "@/lib/audit";
import { fail, handle, num, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { userRatePer1000 } from "@/lib/pricing";
import { firstError, serviceSchema } from "@/lib/validators";
export const dynamic = "force-dynamic";
const dto = (service: any, categoryName: string | null = null) => ({ ...service, id: String(service._id), categoryId: String(service.categoryId), pricePer1000: num(service.pricePer1000), providerCostPer1000: service.providerCostPer1000 == null ? null : num(service.providerCostPer1000), markupPercent: num(service.markupPercent ?? 30), userPricePer1000: userRatePer1000({ ...service, pricePer1000: num(service.pricePer1000) }), ...(categoryName ? { categoryName } : {}) });
export async function GET(req: Request) { return handle(async () => { await requireAdmin(req); const [services, categories] = await Promise.all([Service.find().sort({ name: 1 }).lean(), Category.find().sort({ sortOrder: 1 }).lean()]); const names = new Map(categories.map((c) => [String(c._id), c.name])); return ok({ services: services.map((s) => dto(s, names.get(String(s.categoryId)) ?? null)), categories: categories.map((c) => ({ ...c, id: String(c._id) })) }, "Services loaded"); }); }
export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin(req);
    const parsed = serviceSchema.safeParse(await req.json());
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    const categoryId = String(parsed.data.categoryId);
    if (!mongoose.isValidObjectId(categoryId)) return fail("Invalid category id", 422);
    if (parsed.data.minQuantity > parsed.data.maxQuantity) return fail("Minimum quantity cannot be greater than maximum quantity", 422);
    const created = await Service.create({
      ...parsed.data,
      categoryId: new mongoose.Types.ObjectId(categoryId),
      description: parsed.data.description || null,
      pricePer1000: parsed.data.pricePer1000,
    });
    await recordAudit({ adminId: String(admin._id), action: "service.create", targetType: "service", targetId: String(created._id), details: parsed.data });
    return ok({ service: dto(created.toObject()) }, "Service created", 201);
  });
}
