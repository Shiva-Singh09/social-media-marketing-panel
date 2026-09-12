import mongoose from "mongoose";
import { Category } from "@/db";
import { recordAudit } from "@/lib/audit";
import { fail, handle, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { categorySchema, firstError } from "@/lib/validators";
export const dynamic = "force-dynamic";
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) { return handle(async () => { const admin = await requireAdmin(req); const { id } = await ctx.params; if (!mongoose.isValidObjectId(id)) return fail("Invalid category id", 400); const parsed = categorySchema.safeParse(await req.json()); if (!parsed.success) return fail(firstError(parsed.error), 422); const updated = await Category.findByIdAndUpdate(id, { ...parsed.data, platformKey: parsed.data.platformKey || null, icon: parsed.data.icon || null }, { returnDocument: "after" }); if (!updated) return fail("Category not found", 404); await recordAudit({ adminId: String(admin._id), action: "category.update", targetType: "category", targetId: id, details: parsed.data }); return ok({ category: { ...updated.toObject(), id } }, "Category updated"); }); }
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) { return handle(async () => { const admin = await requireAdmin(req); const { id } = await ctx.params; if (!mongoose.isValidObjectId(id)) return fail("Invalid category id", 400); const deleted = await Category.findByIdAndDelete(id); if (!deleted) return fail("Category not found", 404); await recordAudit({ adminId: String(admin._id), action: "category.delete", targetType: "category", targetId: id }); return ok({ id }, "Category deleted"); }); }
