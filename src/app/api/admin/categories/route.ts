import { Category, Service } from "@/db";
import { recordAudit } from "@/lib/audit";
import { fail, handle, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { categorySchema, firstError } from "@/lib/validators";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return handle(async () => { await requireAdmin(req); const [categories, services] = await Promise.all([Category.find().sort({ sortOrder: 1, name: 1 }).lean(), Service.find().select({ categoryId: 1 }).lean()]); return ok({ categories: categories.map((c) => ({ ...c, id: String(c._id), serviceCount: services.filter((s) => String(s.categoryId) === String(c._id)).length })) }, "Categories loaded"); }); }
export async function POST(req: Request) { return handle(async () => { const admin = await requireAdmin(req); const parsed = categorySchema.safeParse(await req.json()); if (!parsed.success) return fail(firstError(parsed.error), 422); const created = await Category.create({ ...parsed.data, platformKey: parsed.data.platformKey || null, icon: parsed.data.icon || null }); await recordAudit({ adminId: String(admin._id), action: "category.create", targetType: "category", targetId: String(created._id), details: parsed.data }); return ok({ category: { ...created.toObject(), id: String(created._id) } }, "Category created", 201); }); }
