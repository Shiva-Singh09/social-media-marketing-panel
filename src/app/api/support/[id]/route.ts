import mongoose from "mongoose";
import { SupportTicket } from "@/db";
import { fail, handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    if (!mongoose.isValidObjectId(id)) return fail("Invalid ticket id", 400);
    const ticket = await SupportTicket.findOne(user.role === "admin" ? { _id: id } : { _id: id, userId: user._id }).lean();
    if (!ticket) return fail("Ticket not found", 404);
    const replies = (ticket.replies ?? []).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return ok({ ticket: { ...ticket, id: String(ticket._id), userId: String(ticket.userId) }, replies }, "Ticket loaded");
  });
}
