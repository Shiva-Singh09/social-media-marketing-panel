import mongoose from "mongoose";
import { SupportTicket } from "@/db";
import { fail, handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { firstError, replySchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    if (!mongoose.isValidObjectId(id)) return fail("Invalid ticket id", 400);
    const parsed = replySchema.safeParse(await req.json());
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    const ticket = await SupportTicket.findOne({ _id: id, userId: user._id });
    if (!ticket) return fail("Ticket not found", 404);
    if (ticket.status === "closed") return fail("This ticket is closed", 400);
    const reply = { message: parsed.data.message, isAdmin: false, createdAt: new Date() };
    ticket.replies.push(reply);
    ticket.status = "open";
    await ticket.save();
    return ok({ reply }, "Reply sent", 201);
  });
}
