import mongoose from "mongoose";
import { z } from "zod";
import { SupportTicket } from "@/db";
import { fail, handle, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { firstError, replySchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

const statusSchema = z.object({ status: z.enum(["open", "replied", "closed"]) });

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin(req);
    const id = (await ctx.params).id;
    if (!mongoose.isValidObjectId(id)) return fail("Invalid ticket id", 400);

    const ticket = await SupportTicket.findById(id).populate("userId", "name email").lean();
    if (!ticket) return fail("Ticket not found", 404);

    const user = ticket.userId as { name?: string; email?: string } | undefined;

    return ok(
      {
        ticket: {
          id: ticket._id,
          subject: ticket.subject,
          message: ticket.message,
          status: ticket.status,
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt,
          userName: user?.name,
          userEmail: user?.email,
        },
        replies: ticket.replies ?? [],
      },
      "Ticket loaded",
    );
  });
}

/** Admin reply */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin(req);
    const id = (await ctx.params).id;
    if (!mongoose.isValidObjectId(id)) return fail("Invalid ticket id", 400);

    const parsed = replySchema.safeParse(await req.json());
    if (!parsed.success) return fail(firstError(parsed.error), 422);

    const ticket = await SupportTicket.findById(id);
    if (!ticket) return fail("Ticket not found", 404);

    ticket.replies.push({
      _id: new mongoose.Types.ObjectId(),
      message: parsed.data.message,
      isAdmin: true,
      createdAt: new Date(),
    });
    ticket.status = "replied";
    await ticket.save();

    const reply = ticket.replies[ticket.replies.length - 1];

    return ok({ reply }, "Reply sent", 201);
  });
}

/** Update ticket status */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin(req);
    const id = (await ctx.params).id;
    if (!mongoose.isValidObjectId(id)) return fail("Invalid ticket id", 400);

    const parsed = statusSchema.safeParse(await req.json());
    if (!parsed.success) return fail(firstError(parsed.error), 422);

    const updated = await SupportTicket.findByIdAndUpdate(
      id,
      { status: parsed.data.status },
      { returnDocument: "after" },
    );

    if (!updated) return fail("Ticket not found", 404);
    return ok({ ticket: updated }, "Ticket status updated");
  });
}